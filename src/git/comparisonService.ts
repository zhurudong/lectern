import { CommitGraph } from './commitGraph'
import { GitReadError, gitError, type PublicGitError, type RepoUnavailableReason } from './errors'
import { ReadOnlyFsa } from './fsa'
import { MAX_BLOB_BODY_BYTES } from './looseObject'
import { GitObjectStore } from './objectStore'
import type {
  ChangedFile,
  CompareRequest,
  GitCompareState,
  GitTreeSide,
  LoadedFilePair,
  LoadedFileSide,
} from './protocol'
import { probeRepository } from './repository'
import { peelToCommit, readGitRefs, resolveCommitInput, type GitRefsSnapshot } from './refs'
import { gitObjectOid } from './sha1'
import { compareTrees, type TreeFileSide } from './treeDiff'
import { compareTreeToWorktree } from './worktree'

export type ComparisonSessionOpenResult =
  | { kind: 'ready'; session: ComparisonSession; refs: GitRefsSnapshot }
  | { kind: 'unavailable'; reason: RepoUnavailableReason }

function treeSide(side: TreeFileSide): GitTreeSide {
  return { source: 'git', oid: side.oid, mode: side.mode, objectKind: side.kind }
}

function serializedError(error: unknown, operation: string): PublicGitError {
  if (error instanceof GitReadError) return error.toPublic()
  if (typeof error === 'object' && error != null && 'code' in error && typeof error.code === 'string') {
    const candidate = error as { code: GitReadError['code']; context?: GitReadError['context'] }
    try {
      return gitError(candidate.code, { operation, ...candidate.context }).toPublic()
    } catch {
      // Fall through for a foreign, non-Git code.
    }
  }
  return gitError('repository-unreadable', { operation }, `Unexpected Git comparison failure: ${String(error)}`).toPublic()
}

export class ComparisonSession {
  private lastFiles = new Map<string, ChangedFile>()

  private constructor(
    readonly root: ReadOnlyFsa,
    readonly git: ReadOnlyFsa,
    readonly store: GitObjectStore,
    readonly graph: CommitGraph,
    readonly refs: GitRefsSnapshot,
  ) {}

  static async open(rootHandle: FileSystemDirectoryHandle): Promise<ComparisonSessionOpenResult> {
    const root = new ReadOnlyFsa(rootHandle)
    const probe = await probeRepository(rootHandle)
    if (probe.kind === 'unavailable') return probe
    const refs = await readGitRefs(probe.git)
    const store = await GitObjectStore.open(probe.git)
    const graph = await CommitGraph.open(probe.git, store)
    return { kind: 'ready', session: new ComparisonSession(root, probe.git, store, graph, refs), refs }
  }

  async compare(request: CompareRequest): Promise<Extract<GitCompareState, { kind: 'ready' | 'error' }>> {
    try {
      const baseCommit = await peelToCommit(this.store, request.base.oid)
      const targetCommit = request.target.kind === 'worktree'
        ? await peelToCommit(this.store, request.target.headOid)
        : await peelToCommit(this.store, request.target.oid)
      let leftCommit = baseCommit
      if (request.mode === 'review') {
        const mergeBase = await this.graph.mergeBase(baseCommit, targetCommit)
        if (mergeBase.kind === 'none') throw gitError('incomplete-history', { operation: 'merge-base', reason: 'no-common-history' }, 'The endpoints have no common history; use direct comparison')
        if (mergeBase.kind === 'multiple') throw gitError('incomplete-history', { operation: 'merge-base', reason: 'multiple-merge-bases' }, 'Multiple best merge bases require a recursive virtual merge; use direct comparison')
        if (mergeBase.kind === 'incomplete') throw gitError('incomplete-history', { operation: 'merge-base', oid: mergeBase.missingOid, reason: 'shallow-history' }, 'History is shallow or missing locally')
        leftCommit = mergeBase.oid
      }
      const leftTree = (await this.graph.read(leftCommit)).tree
      let files: ChangedFile[]
      let confidence: Extract<GitCompareState, { kind: 'ready' }>['confidence']
      if (request.target.kind === 'worktree') {
        const compared = await compareTreeToWorktree(this.store, leftTree, this.root, this.git)
        files = compared.files.map((file) => ({
          status: file.status,
          path: file.path,
          old: file.old ? treeSide(file.old) : undefined,
          new: file.new ? {
            source: 'worktree' as const,
            oid: file.new.oid,
            size: file.new.size,
            objectKind: file.new.kind,
            modeKnown: false as const,
          } : undefined,
        }))
        confidence = { kind: 'limited', limitations: [...compared.snapshot.limitations] }
      } else {
        const rightTree = (await this.graph.read(targetCommit)).tree
        files = (await compareTrees(this.store, leftTree, rightTree)).map((file) => ({
          status: file.status,
          path: file.path,
          old: file.old ? treeSide(file.old) : undefined,
          new: file.new ? treeSide(file.new) : undefined,
        }))
        confidence = { kind: 'exact', limitations: [] }
      }
      this.lastFiles = new Map(files.map((file) => [file.path, file]))
      return { kind: 'ready', files, confidence }
    } catch (error) {
      this.lastFiles.clear()
      return { kind: 'error', error: serializedError(error, 'compare') }
    }
  }

  async loadFilePair(path: string): Promise<LoadedFilePair> {
    const file = this.lastFiles.get(path)
    if (!file) throw gitError('invalid-path', { path, operation: 'load-file-pair' }, 'Path is not in the current comparison manifest')
    return {
      path,
      status: file.status,
      old: await this.loadSide(file.old, path),
      new: await this.loadSide(file.new, path),
    }
  }

  resolveCommit(input: string): Promise<string> {
    return resolveCommitInput(this.store, input)
  }

  dispose(): void {
    this.lastFiles.clear()
    this.store.dispose()
  }

  private async loadSide(side: ChangedFile['old'] | ChangedFile['new'], path: string): Promise<LoadedFileSide> {
    if (!side) return { kind: 'metadata', oid: '', reason: 'absent' }
    if (side.source === 'worktree') {
      if (side.size > MAX_BLOB_BODY_BYTES) return { kind: 'metadata', oid: side.oid, size: side.size, reason: 'over-5-mb' }
      const bytes = await this.root.readAll(path, MAX_BLOB_BODY_BYTES)
      if (gitObjectOid('blob', bytes) !== side.oid) throw gitError('repository-changing', { path, operation: 'load-file-pair' }, 'Worktree file changed after comparison')
      return { kind: 'content', oid: side.oid, size: bytes.byteLength, bytes }
    }
    if (side.objectKind === 'gitlink') return { kind: 'metadata', oid: side.oid, reason: 'gitlink' }
    try {
      const object = await this.store.read(side.oid)
      if (object.type !== 'blob') throw gitError('object-corrupt', { oid: side.oid, objectType: object.type }, 'File entry does not point to a blob')
      return { kind: 'content', oid: side.oid, size: object.size, bytes: object.body }
    } catch (error) {
      const code = typeof error === 'object' && error != null && 'code' in error ? error.code : undefined
      const context = typeof error === 'object' && error != null && 'context' in error ? error.context as { size?: number } : undefined
      if (code === 'resource-limit') return { kind: 'metadata', oid: side.oid, size: context?.size, reason: 'over-5-mb' }
      throw error
    }
  }
}

export { serializedError }

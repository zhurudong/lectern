import { gitError } from './errors'
import type { ReadOnlyFsa } from './fsa'
import type { GitObjectStore } from './objectStore'

export interface ParsedCommit {
  oid: string
  tree: string
  parents: string[]
}

export type MergeBaseResult =
  | { kind: 'single'; oid: string }
  | { kind: 'none' }
  | { kind: 'multiple'; oids: string[] }
  | { kind: 'incomplete'; missingOid?: string; shallow: boolean }

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error != null && 'code' in error && typeof error.code === 'string' ? error.code : undefined
}

function parseOidHeader(line: string, header: string, oid: string): string {
  const value = line.slice(header.length + 1)
  if (!/^[0-9a-f]{40}$/.test(value)) throw gitError('object-corrupt', { oid }, `Invalid ${header} header in commit`)
  return value
}

export function parseCommit(oid: string, body: Uint8Array): ParsedCommit {
  const headerEnd = body.indexOf(0x0a, body.indexOf(0x0a) + 1)
  if (headerEnd < 0) throw gitError('object-corrupt', { oid }, 'Commit headers are truncated')
  const text = new TextDecoder().decode(body)
  const lines = text.slice(0, text.indexOf('\n\n') >= 0 ? text.indexOf('\n\n') : text.length).split('\n')
  let tree = ''
  const parents: string[] = []
  for (const line of lines) {
    if (line.startsWith('tree ')) {
      if (tree) throw gitError('object-corrupt', { oid }, 'Commit contains multiple tree headers')
      tree = parseOidHeader(line, 'tree', oid)
    } else if (line.startsWith('parent ')) parents.push(parseOidHeader(line, 'parent', oid))
  }
  if (!tree) throw gitError('object-corrupt', { oid }, 'Commit has no tree header')
  return { oid, tree, parents }
}

async function readShallow(git: ReadOnlyFsa): Promise<Set<string>> {
  try {
    const text = await git.readText('shallow', 16 * 1024 * 1024)
    const output = new Set<string>()
    for (const line of text.split(/\r?\n/)) {
      if (!line) continue
      if (!/^[0-9a-f]{40}$/.test(line)) throw gitError('object-corrupt', { path: 'shallow' }, 'Invalid shallow boundary id')
      output.add(line)
    }
    return output
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return new Set()
    throw error
  }
}

export class CommitGraph {
  private readonly commits = new Map<string, ParsedCommit>()

  private constructor(
    readonly store: GitObjectStore,
    private readonly shallow: Set<string>,
  ) {}

  static async open(git: ReadOnlyFsa, store: GitObjectStore): Promise<CommitGraph> {
    return new CommitGraph(store, await readShallow(git))
  }

  async read(oid: string): Promise<ParsedCommit> {
    const cached = this.commits.get(oid)
    if (cached) return cached
    const object = await this.store.read(oid)
    if (object.type !== 'commit') throw gitError('non-commit-object', { oid, objectType: object.type }, 'Commit graph encountered a non-commit object')
    const commit = parseCommit(oid, object.body)
    this.commits.set(oid, commit)
    return commit
  }

  async mergeBase(left: string, right: string): Promise<MergeBaseResult> {
    let touchedShallow = false
    let missingOid: string | undefined
    const collect = async (start: string): Promise<Set<string>> => {
      const seen = new Set<string>()
      const pending = [start]
      while (pending.length > 0) {
        const oid = pending.pop()!
        if (seen.has(oid)) continue
        seen.add(oid)
        let commit: ParsedCommit
        try {
          commit = await this.read(oid)
        } catch (error) {
          if (errorCode(error) === 'object-not-found') {
            missingOid ??= oid
            continue
          }
          throw error
        }
        if (this.shallow.has(oid)) {
          touchedShallow = true
          continue
        }
        pending.push(...commit.parents)
      }
      return seen
    }

    const leftAncestors = await collect(left)
    const rightAncestors = await collect(right)
    if (missingOid) return { kind: 'incomplete', missingOid, shallow: touchedShallow }
    const common = new Set([...leftAncestors].filter((oid) => rightAncestors.has(oid)))
    if (common.size === 0) return touchedShallow ? { kind: 'incomplete', shallow: true } : { kind: 'none' }

    // A common ancestor is not "best" if it is reachable from another common
    // ancestor. Seeding every common node's parents computes that dominated set
    // in one traversal rather than one reachability walk per candidate.
    const dominated = new Set<string>()
    const visited = new Set<string>()
    const pending: string[] = []
    for (const oid of common) {
      const commit = await this.read(oid)
      if (!this.shallow.has(oid)) pending.push(...commit.parents)
    }
    while (pending.length > 0) {
      const oid = pending.pop()!
      if (visited.has(oid)) continue
      visited.add(oid)
      if (common.has(oid)) dominated.add(oid)
      const commit = await this.read(oid)
      if (!this.shallow.has(oid)) pending.push(...commit.parents)
    }
    const best = [...common].filter((oid) => !dominated.has(oid)).sort()
    if (best.length === 1) return { kind: 'single', oid: best[0] }
    return { kind: 'multiple', oids: best }
  }
}

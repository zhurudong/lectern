import type { PublicGitError, RepoUnavailableReason } from './errors'
import type { GitRef, GitRefsSnapshot } from './refs'

export type CompareMode = 'review' | 'direct'

export interface ImmutableEndpoint {
  kind: 'branch' | 'remote' | 'tag' | 'commit'
  label: string
  oid: string
}

export interface WorktreeEndpoint {
  kind: 'worktree'
  label: string
  headOid: string
}

export type TargetEndpoint = ImmutableEndpoint | WorktreeEndpoint

export interface CompareRequest {
  mode: CompareMode
  base: ImmutableEndpoint
  target: TargetEndpoint
  /** Development-only E2E delay. Production callers never set this field. */
  debugDelayMs?: number
}

export interface GitTreeSide {
  source: 'git'
  oid: string
  mode: string
  objectKind: 'regular' | 'executable' | 'symlink' | 'gitlink'
}

export interface WorktreeSide {
  source: 'worktree'
  oid: string
  size: number
  objectKind: 'regular-observed'
  modeKnown: false
}

export type ChangedFileSide = GitTreeSide | WorktreeSide

export interface ChangedFile {
  status: 'A' | 'M' | 'D'
  path: string
  old?: GitTreeSide
  new?: ChangedFileSide
}

export type ComparisonConfidence =
  | { kind: 'exact'; limitations: [] }
  | {
      kind: 'limited'
      limitations: Array<'filesystem-mode-and-symlink-unobservable' | 'global-excludes-unavailable'>
    }

export type GitCompareState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'unavailable'; reason: RepoUnavailableReason }
  | { kind: 'ready'; files: ChangedFile[]; confidence: ComparisonConfidence }
  | { kind: 'error'; error: PublicGitError }

export interface LoadedContentSide {
  kind: 'content'
  oid: string
  size: number
  bytes: Uint8Array
}

export interface LoadedMetadataSide {
  kind: 'metadata'
  oid: string
  size?: number
  reason: 'absent' | 'gitlink' | 'over-5-mb' | 'unavailable'
}

export type LoadedFileSide = LoadedContentSide | LoadedMetadataSide

export interface LoadedFilePair {
  path: string
  status: ChangedFile['status']
  old: LoadedFileSide
  new: LoadedFileSide
}

interface WorkerRequestBase {
  id: number
  generation: number
}

export type GitWorkerRequest =
  | (WorkerRequestBase & { type: 'probe-and-list-refs'; root: FileSystemDirectoryHandle })
  | (WorkerRequestBase & { type: 'compare'; root: FileSystemDirectoryHandle; request: CompareRequest })
  | (WorkerRequestBase & { type: 'resolve-commit'; input: string })
  | (WorkerRequestBase & { type: 'load-file-pair'; path: string })
  | (WorkerRequestBase & { type: 'dispose' })

export type GitWorkerPayload =
  | { type: 'probe-result'; state: { kind: 'ready'; refs: GitRefsSnapshot } | { kind: 'unavailable'; reason: RepoUnavailableReason } }
  | { type: 'compare-result'; state: Extract<GitCompareState, { kind: 'ready' | 'unavailable' | 'error' }> }
  | { type: 'resolve-commit-result'; oid: string }
  | { type: 'file-pair-result'; pair: LoadedFilePair }
  | { type: 'disposed' }

export interface GitWorkerResponse {
  id: number
  generation: number
  payload?: GitWorkerPayload
  error?: PublicGitError
}

export interface RefGroupsForUi {
  local: GitRef[]
  remote: GitRef[]
  tag: GitRef[]
}

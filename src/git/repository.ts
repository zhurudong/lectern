import type { RepoUnavailableReason } from './errors'
import { ReadOnlyFsa, tryNormalizeRelativePath } from './fsa'

export interface ReadyRepository {
  kind: 'ready'
  worktree: ReadOnlyFsa
  git: ReadOnlyFsa
  /** Repository-relative, never an external absolute path. */
  gitDirPath: string
}

export interface UnavailableRepository {
  kind: 'unavailable'
  reason: RepoUnavailableReason
}

export type RepositoryProbe = ReadyRepository | UnavailableRepository

function missing(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'NotFoundError'
}

function wrongKind(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'TypeMismatchError'
}

export async function probeRepository(root: FileSystemDirectoryHandle): Promise<RepositoryProbe> {
  const worktree = new ReadOnlyFsa(root)

  try {
    const gitDirectory = await root.getDirectoryHandle('.git')
    return { kind: 'ready', worktree, git: new ReadOnlyFsa(gitDirectory), gitDirPath: '.git' }
  } catch (error) {
    if (!missing(error) && !wrongKind(error)) return { kind: 'unavailable', reason: 'repository-unreadable' }
  }

  let pointer: string
  try {
    pointer = await worktree.readText('.git', 4096)
  } catch (error) {
    if (missing(error) || wrongKind(error)) return { kind: 'unavailable', reason: 'not-a-git-repository' }
    return { kind: 'unavailable', reason: 'repository-unreadable' }
  }

  const match = /^gitdir:\s*([^\r\n]+)\s*(?:\r?\n)?$/i.exec(pointer)
  if (!match) return { kind: 'unavailable', reason: 'malformed-gitdir' }
  const gitDirPath = tryNormalizeRelativePath(match[1])
  if (!gitDirPath) return { kind: 'unavailable', reason: 'gitdir-outside-authorized-root' }

  try {
    const gitDirectory = await worktree.directory(gitDirPath)
    return { kind: 'ready', worktree, git: new ReadOnlyFsa(gitDirectory), gitDirPath }
  } catch {
    return { kind: 'unavailable', reason: 'repository-unreadable' }
  }
}


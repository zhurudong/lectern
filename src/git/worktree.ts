import ignore, { type Ignore } from 'ignore'
import { gitError } from './errors'
import type { ReadOnlyFsa } from './fsa'
import type { GitObjectStore } from './objectStore'
import { Sha1 } from './sha1'
import { parseTree, type TreeFileSide } from './treeDiff'

const HASH_CHUNK_BYTES = 1024 * 1024
const MAX_IGNORE_BYTES = 1024 * 1024

interface IgnoreLayer {
  base: string
  matcher: Ignore
}

export interface WorktreeFile {
  path: string
  oid: string
  size: number
}

export interface WorktreeSnapshot {
  files: Map<string, WorktreeFile>
  confidence: 'limited'
  limitations: readonly ['filesystem-mode-and-symlink-unobservable', 'global-excludes-unavailable']
}

export interface WorktreeFileSide {
  oid: string
  size: number
  kind: 'regular-observed'
  modeKnown: false
}

export interface WorktreeChange {
  status: 'A' | 'M' | 'D'
  path: string
  old?: TreeFileSide
  new?: WorktreeFileSide
}

async function optionalText(fsa: ReadOnlyFsa, path: string): Promise<string | null> {
  try {
    return await fsa.readText(path, MAX_IGNORE_BYTES)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return null
    throw error
  }
}

function layer(base: string, patterns: string): IgnoreLayer {
  return { base, matcher: ignore().add(patterns) }
}

function ignoredByLayers(path: string, directory: boolean, layers: IgnoreLayer[]): boolean {
  let ignored = false
  for (const current of layers) {
    if (current.base && path !== current.base && !path.startsWith(`${current.base}/`)) continue
    const relative = current.base ? path.slice(current.base.length + 1) : path
    if (!relative) continue
    const result = current.matcher.test(directory ? `${relative}/` : relative)
    if (result.rule) ignored = result.ignored
  }
  return ignored
}

function trackedDirectorySet(paths: Set<string>): Set<string> {
  const directories = new Set<string>()
  for (const path of paths) {
    const parts = path.split('/')
    parts.pop()
    let current = ''
    for (const part of parts) {
      current = current ? `${current}/${part}` : part
      directories.add(current)
    }
  }
  return directories
}

export async function hashWorktreeFile(
  root: ReadOnlyFsa,
  path: string,
  onChunk?: (bytes: number) => void,
): Promise<WorktreeFile> {
  const file = await root.file(path)
  if (!Number.isSafeInteger(file.size)) throw gitError('resource-limit', { path, size: file.size }, 'File size exceeds the safe integer range')
  const hash = new Sha1().update(new TextEncoder().encode(`blob ${file.size}\0`))
  for (let offset = 0; offset < file.size; offset += HASH_CHUNK_BYTES) {
    const bytes = new Uint8Array(await file.slice(offset, Math.min(file.size, offset + HASH_CHUNK_BYTES)).arrayBuffer())
    hash.update(bytes)
    onChunk?.(bytes.byteLength)
  }
  return { path, oid: hash.hex(), size: file.size }
}

export async function snapshotWorktree(
  root: ReadOnlyFsa,
  git: ReadOnlyFsa,
  trackedPaths: Set<string>,
  onHashChunk?: (path: string, bytes: number) => void,
): Promise<WorktreeSnapshot> {
  const files = new Map<string, WorktreeFile>()
  const trackedDirectories = trackedDirectorySet(trackedPaths)
  const layers: IgnoreLayer[] = []
  const infoExclude = await optionalText(git, 'info/exclude')
  if (infoExclude) layers.push(layer('', infoExclude))

  const walk = async (directory: string, inheritedLayers: IgnoreLayer[], blockedByIgnoredParent: boolean): Promise<void> => {
    const localLayers = [...inheritedLayers]
    const ignorePath = directory ? `${directory}/.gitignore` : '.gitignore'
    const ignoreText = await optionalText(root, ignorePath)
    if (ignoreText) localLayers.push(layer(directory, ignoreText))
    const entries = await root.list(directory)
    for (const entry of entries) {
      if (!directory && entry.name === '.git') continue
      const path = directory ? `${directory}/${entry.name}` : entry.name
      if (entry.kind === 'directory') {
        const ignored = blockedByIgnoredParent || ignoredByLayers(path, true, localLayers)
        if (!ignored || trackedDirectories.has(path)) await walk(path, localLayers, ignored)
        continue
      }
      const tracked = trackedPaths.has(path)
      const ignored = blockedByIgnoredParent || ignoredByLayers(path, false, localLayers)
      if (ignored && !tracked) continue
      files.set(path, await hashWorktreeFile(root, path, (bytes) => onHashChunk?.(path, bytes)))
    }
  }
  await walk('', layers, false)
  return {
    files,
    confidence: 'limited',
    limitations: ['filesystem-mode-and-symlink-unobservable', 'global-excludes-unavailable'],
  }
}

export async function flattenCommitTree(store: GitObjectStore, treeOid: string): Promise<Map<string, TreeFileSide>> {
  const files = new Map<string, TreeFileSide>()
  const walk = async (oid: string, parent: string): Promise<void> => {
    const object = await store.read(oid)
    if (object.type !== 'tree') throw gitError('object-corrupt', { oid, objectType: object.type }, 'Expected a tree while flattening commit')
    for (const entry of parseTree(oid, object.body)) {
      const path = parent ? `${parent}/${entry.displayName}` : entry.displayName
      if (entry.kind === 'tree') await walk(entry.oid, path)
      else files.set(path, { oid: entry.oid, mode: entry.mode, kind: entry.kind })
    }
  }
  await walk(treeOid, '')
  return files
}

export async function compareTreeToWorktree(
  store: GitObjectStore,
  treeOid: string,
  root: ReadOnlyFsa,
  git: ReadOnlyFsa,
  onHashChunk?: (path: string, bytes: number) => void,
): Promise<{ files: WorktreeChange[]; snapshot: WorktreeSnapshot }> {
  const tracked = await flattenCommitTree(store, treeOid)
  const snapshot = await snapshotWorktree(root, git, new Set(tracked.keys()), onHashChunk)
  const paths = new Set([...tracked.keys(), ...snapshot.files.keys()])
  const files: WorktreeChange[] = []
  for (const path of paths) {
    const old = tracked.get(path)
    const current = snapshot.files.get(path)
    if (!old && current) {
      files.push({ status: 'A', path, new: { oid: current.oid, size: current.size, kind: 'regular-observed', modeKnown: false } })
    } else if (old && !current) {
      files.push({ status: 'D', path, old })
    } else if (old && current && old.oid !== current.oid) {
      files.push({ status: 'M', path, old, new: { oid: current.oid, size: current.size, kind: 'regular-observed', modeKnown: false } })
    }
  }
  files.sort((left, right) => left.path.localeCompare(right.path))
  return { files, snapshot }
}

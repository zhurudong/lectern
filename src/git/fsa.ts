import { gitError } from './errors'

// Allows a 16 MiB decoded Git metadata object plus bounded zlib/header overhead.
export const MAX_FSA_SLICE_BYTES = 17 * 1024 * 1024

export interface FsEntry {
  name: string
  kind: 'file' | 'directory'
}

export interface FsStat {
  kind: 'file' | 'directory'
  size?: number
  lastModified?: number
}

export function isAbsoluteFsPath(path: string): boolean {
  return path.startsWith('/') || path.startsWith('\\\\') || /^[a-z]:[\\/]/i.test(path)
}

/** Return null for absolute paths, NULs, or traversal beyond the authorized root. */
export function tryNormalizeRelativePath(raw: string): string | null {
  if (raw.includes('\0') || isAbsoluteFsPath(raw)) return null
  const parts = raw.replaceAll('\\', '/').split('/')
  const out: string[] = []
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (out.length === 0) return null
      out.pop()
      continue
    }
    out.push(part)
  }
  return out.join('/')
}

export function normalizeRelativePath(raw: string): string {
  const path = tryNormalizeRelativePath(raw)
  if (path == null) throw gitError('invalid-path', {}, 'Path escapes the authorized root')
  return path
}

function parts(path: string): string[] {
  const normalized = normalizeRelativePath(path)
  return normalized ? normalized.split('/') : []
}

/** A deliberately read-only adapter over one authorized directory handle. */
export class ReadOnlyFsa {
  constructor(readonly root: FileSystemDirectoryHandle) {}

  async directory(path = ''): Promise<FileSystemDirectoryHandle> {
    let current = this.root
    for (const part of parts(path)) current = await current.getDirectoryHandle(part)
    return current
  }

  async file(path: string): Promise<File> {
    const pathParts = parts(path)
    const name = pathParts.pop()
    if (!name) throw gitError('invalid-path', { path }, 'Expected a file path')
    let directory = this.root
    for (const part of pathParts) directory = await directory.getDirectoryHandle(part)
    const handle = await directory.getFileHandle(name)
    return handle.getFile()
  }

  async list(path = ''): Promise<FsEntry[]> {
    const directory = await this.directory(path)
    const entries: FsEntry[] = []
    for await (const [name, handle] of directory.entries()) {
      entries.push({ name, kind: handle.kind })
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    return entries
  }

  async stat(path: string): Promise<FsStat> {
    try {
      const file = await this.file(path)
      return { kind: 'file', size: file.size, lastModified: file.lastModified }
    } catch (error) {
      if (!(error instanceof DOMException) || error.name !== 'TypeMismatchError') throw error
      await this.directory(path)
      return { kind: 'directory' }
    }
  }

  async readSlice(path: string, start: number, end: number): Promise<Uint8Array> {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) {
      throw gitError('invalid-path', { path }, `Invalid slice [${start}, ${end})`)
    }
    if (end - start > MAX_FSA_SLICE_BYTES) {
      throw gitError('resource-limit', { path }, `Slice exceeds ${MAX_FSA_SLICE_BYTES} bytes`)
    }
    const file = await this.file(path)
    if (end > file.size) throw gitError('object-corrupt', { path }, 'Slice exceeds file size')
    return new Uint8Array(await file.slice(start, end).arrayBuffer())
  }

  async readAll(path: string, maxBytes = MAX_FSA_SLICE_BYTES): Promise<Uint8Array> {
    const file = await this.file(path)
    if (file.size > maxBytes) {
      throw gitError('resource-limit', { path }, `File exceeds ${maxBytes} bytes`)
    }
    return this.readSlice(path, 0, file.size)
  }

  async readText(path: string, maxBytes = 64 * 1024): Promise<string> {
    return new TextDecoder().decode(await this.readAll(path, maxBytes))
  }
}

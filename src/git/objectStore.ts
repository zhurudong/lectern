import { GitReadError, gitError } from './errors'
import type { ReadOnlyFsa } from './fsa'
import { readLooseObject, type GitObject } from './looseObject'
import { PackFileV2, type PackBaseResolver, type PackResolutionState } from './packFile'
import { loadPackIndex } from './packIndex'

export const OBJECT_CACHE_BYTES = 32 * 1024 * 1024

class ObjectLru {
  private readonly values = new Map<string, GitObject>()
  private size = 0

  get(oid: string): GitObject | undefined {
    const value = this.values.get(oid)
    if (!value) return undefined
    this.values.delete(oid)
    this.values.set(oid, value)
    return value
  }

  set(value: GitObject): void {
    const previous = this.values.get(value.oid)
    if (previous) this.size -= previous.body.byteLength
    this.values.delete(value.oid)
    if (value.body.byteLength > OBJECT_CACHE_BYTES) return
    this.values.set(value.oid, value)
    this.size += value.body.byteLength
    while (this.size > OBJECT_CACHE_BYTES) {
      const oldest = this.values.entries().next().value as [string, GitObject] | undefined
      if (!oldest) break
      this.values.delete(oldest[0])
      this.size -= oldest[1].body.byteLength
    }
  }

  clear(): void {
    this.values.clear()
    this.size = 0
  }

  get byteLength(): number {
    return this.size
  }

  get objectCount(): number {
    return this.values.size
  }
}

export class GitObjectStore implements PackBaseResolver {
  private readonly cache = new ObjectLru()
  private readonly indexBytes: number
  private transientBytes = 0
  private peakOwnedBytes = 0

  private constructor(readonly git: ReadOnlyFsa, readonly packs: PackFileV2[]) {
    this.indexBytes = packs.reduce((total, pack) => total + pack.index.memoryBytes(), 0)
    this.sampleOwnedMemory()
  }

  static async open(git: ReadOnlyFsa): Promise<GitObjectStore> {
    let entries
    try {
      entries = await git.list('objects/pack')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') return new GitObjectStore(git, [])
      throw error
    }
    const names = new Set(entries.filter((entry) => entry.kind === 'file').map((entry) => entry.name))
    const idxNames = [...names].filter((name) => /^pack-[0-9a-f]{40}\.idx$/.test(name)).sort()
    const packs: PackFileV2[] = []
    for (const idxName of idxNames) {
      const packName = `${idxName.slice(0, -4)}.pack`
      if (!names.has(packName)) throw gitError('object-corrupt', { path: `objects/pack/${idxName}` }, 'Pack index has no matching pack file')
      const index = await loadPackIndex(git, `objects/pack/${idxName}`)
      packs.push(await PackFileV2.open(git, `objects/pack/${packName}`, index))
    }
    return new GitObjectStore(git, packs)
  }

  async read(oid: string): Promise<GitObject> {
    return this.readWithState(oid, { depth: 0, active: new Set() })
  }

  async readForDelta(oid: string, state: PackResolutionState): Promise<GitObject> {
    return this.readWithState(oid, state)
  }

  trackTransientMemory(deltaBytes: number): void {
    this.transientBytes += deltaBytes
    if (this.transientBytes < 0) throw new Error('Git transient-memory accounting underflow')
    this.sampleOwnedMemory()
  }

  dispose(): void {
    this.cache.clear()
  }

  cacheMetrics(): { bytes: number; objects: number; limit: number; indexBytes: number; peakOwnedBytes: number } {
    return {
      bytes: this.cache.byteLength,
      objects: this.cache.objectCount,
      limit: OBJECT_CACHE_BYTES,
      indexBytes: this.indexBytes,
      peakOwnedBytes: this.peakOwnedBytes,
    }
  }

  async findPrefix(prefix: string, limit = 2): Promise<string[]> {
    if (!/^[0-9a-f]{1,40}$/.test(prefix) || limit <= 0) return []
    const matches = new Set<string>()
    const add = (oid: string): void => {
      if (matches.size < limit && oid.startsWith(prefix)) matches.add(oid)
    }
    if (prefix.length >= 2) {
      try {
        for (const entry of await this.git.list(`objects/${prefix.slice(0, 2)}`)) {
          if (entry.kind === 'file' && /^[0-9a-f]{38}$/.test(entry.name)) add(`${prefix.slice(0, 2)}${entry.name}`)
        }
      } catch (error) {
        if (!(error instanceof DOMException) || error.name !== 'NotFoundError') throw error
      }
    } else {
      try {
        for (const directory of await this.git.list('objects')) {
          if (matches.size >= limit) break
          if (directory.kind !== 'directory' || !/^[0-9a-f]{2}$/.test(directory.name) || !directory.name.startsWith(prefix)) continue
          for (const entry of await this.git.list(`objects/${directory.name}`)) {
            if (entry.kind === 'file' && /^[0-9a-f]{38}$/.test(entry.name)) add(`${directory.name}${entry.name}`)
          }
        }
      } catch (error) {
        if (!(error instanceof DOMException) || error.name !== 'NotFoundError') throw error
      }
    }
    for (const pack of this.packs) {
      if (matches.size >= limit) break
      for (const oid of pack.index.findPrefix(prefix, limit - matches.size)) add(oid)
    }
    return [...matches].sort()
  }

  private async readWithState(oid: string, state: PackResolutionState): Promise<GitObject> {
    const cached = this.cache.get(oid)
    if (cached) return cached
    try {
      const loose = await readLooseObject(this.git, oid)
      this.cache.set(loose)
      this.sampleOwnedMemory()
      return loose
    } catch (error) {
      if (!(error instanceof GitReadError) || error.code !== 'object-not-found') throw error
    }
    for (const pack of this.packs) {
      const found = pack.find(oid)
      if (!found) continue
      const value = await pack.readByIndex(found.index, this, state)
      this.cache.set(value)
      this.sampleOwnedMemory()
      return value
    }
    throw gitError('object-not-found', { oid }, 'Object is absent from loose storage and all local packs')
  }


  private sampleOwnedMemory(): void {
    this.peakOwnedBytes = Math.max(this.peakOwnedBytes, this.indexBytes + this.cache.byteLength + this.transientBytes)
  }
}

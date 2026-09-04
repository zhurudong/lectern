import { crc32 } from './crc32'
import { applyGitDelta } from './delta'
import { GitReadError, gitError } from './errors'
import type { ReadOnlyFsa } from './fsa'
import { MAX_BLOB_BODY_BYTES, MAX_METADATA_OBJECT_BYTES, type GitObject, type GitObjectType } from './looseObject'
import { type PackIndexLookup, PackIndexV2 } from './packIndex'
import { gitObjectOid } from './sha1'

const PACK_HEADER_BYTES = 12
const PACK_TRAILER_BYTES = 20
const MAX_ENTRY_BYTES = MAX_METADATA_OBJECT_BYTES + 256 * 1024
export const MAX_DELTA_DEPTH = 64

const PACK_TYPES: Record<number, GitObjectType | undefined> = {
  1: 'commit',
  2: 'tree',
  3: 'blob',
  4: 'tag',
}

interface ParsedEntry {
  packedSize: number
  type: GitObjectType | 'ofs-delta' | 'ref-delta'
  baseOffset?: bigint
  baseOid?: string
  compressed: Uint8Array
}

export interface PackResolutionState {
  depth: number
  active: Set<string>
}

export interface PackBaseResolver {
  readForDelta(oid: string, state: PackResolutionState): Promise<GitObject>
  trackTransientMemory(deltaBytes: number): void
}

function bytesHex(bytes: Uint8Array): string {
  let output = ''
  for (const byte of bytes) output += byte.toString(16).padStart(2, '0')
  return output
}

function parseEntry(bytes: Uint8Array, objectOffset: bigint): ParsedEntry {
  let cursor = 0
  const first = bytes[cursor++]
  if (first == null) throw gitError('object-corrupt', {}, 'Missing pack object header')
  const typeCode = (first >> 4) & 0x07
  let packedSize = first & 0x0f
  let shift = 4
  let current = first
  while ((current & 0x80) !== 0) {
    if (cursor >= bytes.length || shift > 49) throw gitError('object-corrupt', {}, 'Invalid pack object size header')
    current = bytes[cursor++]
    const part = current & 0x7f
    if (part * 2 ** shift > Number.MAX_SAFE_INTEGER - packedSize) {
      throw gitError('resource-limit', {}, 'Packed object size exceeds safe integer range')
    }
    packedSize += part * 2 ** shift
    shift += 7
  }

  const objectType = PACK_TYPES[typeCode]
  if (objectType) return { packedSize, type: objectType, compressed: bytes.subarray(cursor) }
  if (typeCode === 6) {
    const initial = bytes[cursor++]
    if (initial == null) throw gitError('object-corrupt', {}, 'Truncated OFS_DELTA base offset')
    let distance = BigInt(initial & 0x7f)
    current = initial
    while ((current & 0x80) !== 0) {
      current = bytes[cursor++]
      if (current == null) throw gitError('object-corrupt', {}, 'Truncated OFS_DELTA base offset')
      distance = ((distance + 1n) << 7n) + BigInt(current & 0x7f)
      if (distance > objectOffset) throw gitError('object-corrupt', {}, 'OFS_DELTA points before the pack data')
    }
    return { packedSize, type: 'ofs-delta', baseOffset: objectOffset - distance, compressed: bytes.subarray(cursor) }
  }
  if (typeCode === 7) {
    if (cursor + 20 > bytes.length) throw gitError('object-corrupt', {}, 'Truncated REF_DELTA base id')
    const baseOid = bytesHex(bytes.subarray(cursor, cursor + 20))
    cursor += 20
    return { packedSize, type: 'ref-delta', baseOid, compressed: bytes.subarray(cursor) }
  }
  throw gitError('unsupported-object-type', {}, `Unsupported pack object type ${typeCode}`)
}

async function inflateBounded(compressed: Uint8Array, expectedSize: number): Promise<Uint8Array> {
  if (expectedSize > MAX_METADATA_OBJECT_BYTES) {
    throw gitError('resource-limit', { size: expectedSize }, 'Packed representation exceeds the decode limit')
  }
  const source = compressed.buffer.slice(compressed.byteOffset, compressed.byteOffset + compressed.byteLength) as ArrayBuffer
  const reader = new Blob([source]).stream().pipeThrough(new DecompressionStream('deflate')).getReader()
  const output = new Uint8Array(expectedSize)
  let offset = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (offset + value.byteLength > expectedSize) {
        await reader.cancel()
        throw gitError('object-corrupt', {}, 'Packed stream expands beyond its declared size')
      }
      output.set(value, offset)
      offset += value.byteLength
    }
  } catch (error) {
    if (error instanceof GitReadError) throw error
    throw gitError('object-corrupt', {}, `Packed zlib stream failed: ${String(error)}`)
  }
  if (offset !== expectedSize) {
    throw gitError('object-corrupt', {}, `Packed stream decoded ${offset} bytes, expected ${expectedSize}`)
  }
  return output
}

function objectLimit(type: GitObjectType): number {
  return type === 'blob' ? MAX_BLOB_BODY_BYTES : MAX_METADATA_OBJECT_BYTES
}

export class PackFileV2 {
  private constructor(
    readonly git: ReadOnlyFsa,
    readonly path: string,
    readonly index: PackIndexV2,
    readonly fileSize: number,
  ) {}

  static async open(git: ReadOnlyFsa, path: string, index: PackIndexV2): Promise<PackFileV2> {
    const stat = await git.stat(path)
    if (stat.kind !== 'file' || stat.size == null || stat.size < PACK_HEADER_BYTES + PACK_TRAILER_BYTES) {
      throw gitError('object-corrupt', { path }, 'Pack file is too small')
    }
    const header = await git.readSlice(path, 0, PACK_HEADER_BYTES)
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength)
    if (view.getUint32(0) !== 0x5041434b || view.getUint32(4) !== 2) {
      throw gitError('object-corrupt', { path }, 'Only pack v2 is supported')
    }
    if (view.getUint32(8) !== index.objectCount) {
      throw gitError('object-corrupt', { path }, 'Pack/index object counts do not match')
    }
    const trailer = await git.readSlice(path, stat.size - PACK_TRAILER_BYTES, stat.size)
    if (bytesHex(trailer) !== index.packChecksum) {
      throw gitError('object-corrupt', { path }, 'Pack checksum does not match its index')
    }
    const dataEnd = BigInt(stat.size - PACK_TRAILER_BYTES)
    for (const offset of index.orderedOffsets) {
      if (offset < BigInt(PACK_HEADER_BYTES) || offset >= dataEnd) {
        throw gitError('object-corrupt', { path }, 'Pack index contains an out-of-range object offset')
      }
    }
    return new PackFileV2(git, path, index, stat.size)
  }

  find(oid: string): PackIndexLookup | null {
    return this.index.find(oid)
  }

  async readByIndex(index: number, resolver: PackBaseResolver, state: PackResolutionState): Promise<GitObject> {
    if (state.depth > MAX_DELTA_DEPTH) throw gitError('resource-limit', {}, `Delta chain exceeds ${MAX_DELTA_DEPTH}`)
    const oid = this.index.oidAt(index)
    const offset = this.index.objectOffsets[index]
    const key = `${this.path}@${offset}`
    if (state.active.has(key)) throw gitError('object-corrupt', { oid }, 'Delta cycle detected')
    state.active.add(key)
    let trackedBytes = 0
    const track = (bytes: number) => {
      trackedBytes += bytes
      resolver.trackTransientMemory(bytes)
    }
    try {
      const end = this.index.nextOffset(offset, BigInt(this.fileSize - PACK_TRAILER_BYTES))
      const length = end - offset
      if (length <= 0n || length > BigInt(MAX_ENTRY_BYTES) || end > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw gitError('resource-limit', { oid }, 'Packed entry exceeds bounded-slice limits')
      }
      const entryBytes = await this.git.readSlice(this.path, Number(offset), Number(end))
      track(entryBytes.byteLength)
      if (crc32(entryBytes) !== this.index.crcTable[index]) {
        throw gitError('object-corrupt', { oid, path: this.path }, 'Packed entry CRC does not match its index')
      }
      const entry = parseEntry(entryBytes, offset)
      const decoded = await inflateBounded(entry.compressed, entry.packedSize)
      track(decoded.byteLength)
      let type: GitObjectType
      let body: Uint8Array
      if (entry.type === 'ofs-delta' || entry.type === 'ref-delta') {
        let base: GitObject
        const childState = { depth: state.depth + 1, active: state.active }
        if (entry.type === 'ofs-delta') {
          const baseIndex = this.index.objectIndexAtOffset(entry.baseOffset!)
          if (baseIndex == null) throw gitError('object-corrupt', { oid }, 'OFS_DELTA base is not an indexed object')
          base = await this.readByIndex(baseIndex, resolver, childState)
        } else {
          base = await resolver.readForDelta(entry.baseOid!, childState)
        }
        type = base.type
        body = applyGitDelta(base.body, decoded, objectLimit(type))
        track(body.byteLength)
      } else {
        type = entry.type
        if (decoded.byteLength > objectLimit(type)) {
          throw gitError('resource-limit', { oid, objectType: type, size: decoded.byteLength }, `${type} exceeds its decoded limit`)
        }
        body = decoded
      }
      if (gitObjectOid(type, body) !== oid) {
        throw gitError('object-corrupt', { oid, objectType: type, size: body.byteLength }, 'Reconstructed object id does not match the index')
      }
      return { oid, type, size: body.byteLength, body, source: 'pack' }
    } finally {
      resolver.trackTransientMemory(-trackedBytes)
      state.active.delete(key)
    }
  }
}

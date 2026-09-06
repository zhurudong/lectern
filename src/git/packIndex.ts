import { gitError } from './errors'
import { MAX_FSA_SLICE_BYTES, type ReadOnlyFsa } from './fsa'
import { Sha1 } from './sha1'

const IDX_MAGIC = 0xff744f63
const IDX_VERSION = 2
const HEADER_BYTES = 8 + 256 * 4
const TRAILER_BYTES = 40

function hex(bytes: Uint8Array): string {
  let value = ''
  for (const byte of bytes) value += byte.toString(16).padStart(2, '0')
  return value
}

function parseOid(oid: string): Uint8Array {
  if (!/^[0-9a-f]{40}$/.test(oid)) throw gitError('object-not-found', { oid }, 'Expected a full SHA-1 object id')
  const bytes = new Uint8Array(20)
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(oid.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

function compareOid(table: Uint8Array, index: number, oid: Uint8Array): number {
  const offset = index * 20
  for (let i = 0; i < 20; i++) {
    const difference = table[offset + i] - oid[i]
    if (difference !== 0) return difference
  }
  return 0
}

async function readRange(git: ReadOnlyFsa, path: string, start: number, end: number): Promise<Uint8Array> {
  if (!Number.isSafeInteger(end - start) || end < start) {
    throw gitError('object-corrupt', { path }, 'Invalid pack-index table bounds')
  }
  const output = new Uint8Array(end - start)
  for (let cursor = start; cursor < end; cursor += MAX_FSA_SLICE_BYTES) {
    const next = Math.min(end, cursor + MAX_FSA_SLICE_BYTES)
    output.set(await git.readSlice(path, cursor, next), cursor - start)
  }
  return output
}

async function hashRange(git: ReadOnlyFsa, path: string, end: number): Promise<string> {
  const hash = new Sha1()
  for (let cursor = 0; cursor < end; cursor += MAX_FSA_SLICE_BYTES) {
    hash.update(await git.readSlice(path, cursor, Math.min(end, cursor + MAX_FSA_SLICE_BYTES)))
  }
  return hash.hex()
}

export interface PackIndexLookup {
  index: number
  offset: bigint
  crc32: number
}

export class PackIndexV2 {
  constructor(
    readonly path: string,
    readonly fanout: Uint32Array,
    private readonly oidTable: Uint8Array,
    readonly crcTable: Uint32Array,
    readonly objectOffsets: BigUint64Array,
    readonly orderedOffsets: BigUint64Array,
    readonly orderedObjectIndexes: Uint32Array,
    readonly packChecksum: string,
    readonly indexChecksum: string,
  ) {}

  get objectCount(): number {
    return this.objectOffsets.length
  }

  /** Retained typed-array bytes owned by this parsed index. */
  memoryBytes(): number {
    return this.fanout.byteLength
      + this.oidTable.byteLength
      + this.crcTable.byteLength
      + this.objectOffsets.byteLength
      + this.orderedOffsets.byteLength
      + this.orderedObjectIndexes.byteLength
  }

  oidAt(index: number): string {
    if (!Number.isInteger(index) || index < 0 || index >= this.objectCount) {
      throw gitError('object-corrupt', { path: this.path }, `Invalid pack-index object number ${index}`)
    }
    return hex(this.oidTable.subarray(index * 20, index * 20 + 20))
  }

  find(oid: string): PackIndexLookup | null {
    const target = parseOid(oid)
    const first = target[0] === 0 ? 0 : this.fanout[target[0] - 1]
    let low = first
    let high = this.fanout[target[0]]
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2)
      const comparison = compareOid(this.oidTable, middle, target)
      if (comparison < 0) low = middle + 1
      else high = middle
    }
    if (low >= this.fanout[target[0]] || compareOid(this.oidTable, low, target) !== 0) return null
    return { index: low, offset: this.objectOffsets[low], crc32: this.crcTable[low] }
  }

  findPrefix(prefix: string, limit = 2): string[] {
    if (!/^[0-9a-f]{1,40}$/.test(prefix) || limit <= 0) return []
    const firstByte = Number.parseInt(prefix.slice(0, 2).padEnd(2, '0'), 16)
    const lastByte = Number.parseInt(prefix.slice(0, 2).padEnd(2, 'f'), 16)
    const start = firstByte === 0 ? 0 : this.fanout[firstByte - 1]
    const end = this.fanout[lastByte]
    const matches: string[] = []
    for (let index = start; index < end && matches.length < limit; index++) {
      const oid = this.oidAt(index)
      if (oid.startsWith(prefix)) matches.push(oid)
    }
    return matches
  }

  objectIndexAtOffset(offset: bigint): number | null {
    let low = 0
    let high = this.orderedOffsets.length
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2)
      if (this.orderedOffsets[middle] < offset) low = middle + 1
      else high = middle
    }
    return low < this.orderedOffsets.length && this.orderedOffsets[low] === offset
      ? this.orderedObjectIndexes[low]
      : null
  }

  nextOffset(offset: bigint, packDataEnd: bigint): bigint {
    let low = 0
    let high = this.orderedOffsets.length
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2)
      if (this.orderedOffsets[middle] < offset) low = middle + 1
      else high = middle
    }
    if (low >= this.orderedOffsets.length || this.orderedOffsets[low] !== offset) {
      throw gitError('object-corrupt', { path: this.path }, 'Pack offset is absent from its index')
    }
    return low + 1 < this.orderedOffsets.length ? this.orderedOffsets[low + 1] : packDataEnd
  }
}

export async function loadPackIndex(git: ReadOnlyFsa, path: string): Promise<PackIndexV2> {
  const stat = await git.stat(path)
  const fileSize = stat.size
  if (stat.kind !== 'file' || fileSize == null || fileSize < HEADER_BYTES + TRAILER_BYTES) {
    throw gitError('object-corrupt', { path }, 'Pack index is too small')
  }

  const header = await git.readSlice(path, 0, HEADER_BYTES)
  const headerView = new DataView(header.buffer, header.byteOffset, header.byteLength)
  if (headerView.getUint32(0) !== IDX_MAGIC || headerView.getUint32(4) !== IDX_VERSION) {
    throw gitError('object-corrupt', { path }, 'Only pack index v2 is supported')
  }
  const fanout = new Uint32Array(256)
  for (let i = 0; i < fanout.length; i++) {
    fanout[i] = headerView.getUint32(8 + i * 4)
    if (i > 0 && fanout[i] < fanout[i - 1]) {
      throw gitError('object-corrupt', { path }, 'Pack-index fan-out table is not monotonic')
    }
  }

  const objectCount = fanout[255]
  const oidStart = HEADER_BYTES
  const oidEnd = oidStart + objectCount * 20
  const crcEnd = oidEnd + objectCount * 4
  const offsetEnd = crcEnd + objectCount * 4
  if (!Number.isSafeInteger(offsetEnd) || offsetEnd + TRAILER_BYTES > fileSize) {
    throw gitError('resource-limit', { path }, 'Pack-index tables exceed safe allocation bounds')
  }
  const oidTable = await readRange(git, path, oidStart, oidEnd)
  for (let i = 1; i < objectCount; i++) {
    if (compareOid(oidTable, i - 1, oidTable.subarray(i * 20, i * 20 + 20)) >= 0) {
      throw gitError('object-corrupt', { path }, 'Pack-index object ids are not strictly sorted')
    }
  }
  const crcBytes = await readRange(git, path, oidEnd, crcEnd)
  const offsetBytes = await readRange(git, path, crcEnd, offsetEnd)
  const crcView = new DataView(crcBytes.buffer, crcBytes.byteOffset, crcBytes.byteLength)
  const offsetView = new DataView(offsetBytes.buffer, offsetBytes.byteOffset, offsetBytes.byteLength)
  const crcTable = new Uint32Array(objectCount)
  const offset32 = new Uint32Array(objectCount)
  let largeCount = 0
  let largeReferences = 0
  for (let i = 0; i < objectCount; i++) {
    crcTable[i] = crcView.getUint32(i * 4)
    offset32[i] = offsetView.getUint32(i * 4)
    if ((offset32[i] & 0x80000000) !== 0) {
      largeReferences++
      largeCount = Math.max(largeCount, (offset32[i] & 0x7fffffff) + 1)
    }
  }
  if (largeCount !== largeReferences) throw gitError('object-corrupt', { path }, 'Pack-index large offsets are sparse or duplicated')
  const largeEnd = offsetEnd + largeCount * 8
  if (!Number.isSafeInteger(largeEnd) || largeEnd + TRAILER_BYTES !== fileSize) {
    throw gitError('object-corrupt', { path }, 'Pack-index large-offset table has inconsistent bounds')
  }
  const largeBytes = await readRange(git, path, offsetEnd, largeEnd)
  const largeView = new DataView(largeBytes.buffer, largeBytes.byteOffset, largeBytes.byteLength)
  const objectOffsets = new BigUint64Array(objectCount)
  for (let i = 0; i < objectCount; i++) {
    const raw = offset32[i]
    if ((raw & 0x80000000) === 0) {
      objectOffsets[i] = BigInt(raw)
      continue
    }
    const largeIndex = raw & 0x7fffffff
    if (largeIndex >= largeCount) throw gitError('object-corrupt', { path }, 'Invalid large-offset table index')
    objectOffsets[i] = largeView.getBigUint64(largeIndex * 8)
  }

  const order = Array.from({ length: objectCount }, (_, index) => index)
  order.sort((left, right) => objectOffsets[left] < objectOffsets[right] ? -1 : objectOffsets[left] > objectOffsets[right] ? 1 : 0)
  const orderedOffsets = new BigUint64Array(objectCount)
  const orderedObjectIndexes = new Uint32Array(objectCount)
  for (let i = 0; i < objectCount; i++) {
    const index = order[i]
    orderedOffsets[i] = objectOffsets[index]
    orderedObjectIndexes[i] = index
    if (i > 0 && orderedOffsets[i] === orderedOffsets[i - 1]) {
      throw gitError('object-corrupt', { path }, 'Pack index contains duplicate object offsets')
    }
  }

  const trailer = await git.readSlice(path, largeEnd, fileSize)
  const packChecksum = hex(trailer.subarray(0, 20))
  const indexChecksum = hex(trailer.subarray(20, 40))
  if (await hashRange(git, path, fileSize - 20) !== indexChecksum) {
    throw gitError('object-corrupt', { path }, 'Pack-index checksum does not match its contents')
  }
  return new PackIndexV2(
    path,
    fanout,
    oidTable,
    crcTable,
    objectOffsets,
    orderedOffsets,
    orderedObjectIndexes,
    packChecksum,
    indexChecksum,
  )
}

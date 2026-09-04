import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { readdirSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { catFileBatch, createGitOracleRepo, snapshotDirectory } from './git-fixture.mjs'
import { memoryDirectoryFromSnapshot } from './fsa-memory.mjs'
import { PROJECT } from './paths.mjs'

const outdir = mkdtempSync(join(tmpdir(), 'lectern-git-pack-'))
await build({
  entryPoints: [
    join(PROJECT, 'src/git/objectStore.ts'),
    join(PROJECT, 'src/git/repository.ts'),
    join(PROJECT, 'src/git/fsa.ts'),
    join(PROJECT, 'src/git/packIndex.ts'),
    join(PROJECT, 'src/git/delta.ts'),
  ],
  bundle: true,
  format: 'esm',
  outdir,
  entryNames: '[name]',
  platform: 'browser',
  logLevel: 'error',
})
const objectStore = await import(join(outdir, 'objectStore.js'))
const repository = await import(join(outdir, 'repository.js'))
const fsaModule = await import(join(outdir, 'fsa.js'))
const packIndex = await import(join(outdir, 'packIndex.js'))
const deltaModule = await import(join(outdir, 'delta.js'))

const results = []
const check = (name, ok, extra = '') => {
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`)
}
const expectError = async (name, action, code, detail = '') => {
  let actualCode = ''
  let actualMessage = ''
  try {
    await action()
  } catch (error) {
    actualCode = error?.code
    actualMessage = error?.message ?? ''
  }
  check(name, actualCode === code && (!detail || actualMessage.includes(detail)), `${actualCode}: ${actualMessage}`)
}
const sha1 = (bytes) => createHash('sha1').update(bytes).digest()
const oidFor = (type, body) => sha1(Buffer.concat([Buffer.from(`${type} ${body.length}\0`), body])).toString('hex')

const CRC_TABLE = new Uint32Array(256)
for (let i = 0; i < CRC_TABLE.length; i++) {
  let value = i
  for (let bit = 0; bit < 8; bit++) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  CRC_TABLE[i] = value >>> 0
}
const crc32 = (bytes) => {
  let value = 0xffffffff
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8)
  return (value ^ 0xffffffff) >>> 0
}

const encodePackHeader = (type, size) => {
  const output = []
  let remaining = size
  let first = (type << 4) | (remaining & 0x0f)
  remaining = Math.floor(remaining / 16)
  if (remaining) first |= 0x80
  output.push(first)
  while (remaining) {
    let byte = remaining & 0x7f
    remaining = Math.floor(remaining / 128)
    if (remaining) byte |= 0x80
    output.push(byte)
  }
  return Buffer.from(output)
}

const buildIndexBytes = (records, packChecksum) => {
  const sorted = [...records].sort((left, right) => left.oid.localeCompare(right.oid))
  const fanout = new Uint32Array(256)
  for (const record of sorted) fanout[Number.parseInt(record.oid.slice(0, 2), 16)]++
  for (let i = 1; i < fanout.length; i++) fanout[i] += fanout[i - 1]
  const large = sorted.filter((record) => record.offset > 0x7fffffffn)
  const bodySize = 8 + 1024 + sorted.length * 20 + sorted.length * 4 + sorted.length * 4 + large.length * 8 + 20
  const body = Buffer.alloc(bodySize)
  let cursor = 0
  body.writeUInt32BE(0xff744f63, cursor); cursor += 4
  body.writeUInt32BE(2, cursor); cursor += 4
  for (const count of fanout) { body.writeUInt32BE(count, cursor); cursor += 4 }
  for (const record of sorted) { Buffer.from(record.oid, 'hex').copy(body, cursor); cursor += 20 }
  for (const record of sorted) { body.writeUInt32BE(record.crc ?? 0, cursor); cursor += 4 }
  let largeIndex = 0
  for (const record of sorted) {
    if (record.offset > 0x7fffffffn) body.writeUInt32BE((0x80000000 | largeIndex++) >>> 0, cursor)
    else body.writeUInt32BE(Number(record.offset), cursor)
    cursor += 4
  }
  for (const record of large) { body.writeBigUInt64BE(record.offset, cursor); cursor += 8 }
  packChecksum.copy(body, cursor); cursor += 20
  if (cursor !== body.length) throw new Error('Synthetic idx body size mismatch')
  return Buffer.concat([body, sha1(body)])
}

const buildSyntheticPack = (definitions, mutatePack, nameByte = '9') => {
  const header = Buffer.alloc(12)
  header.write('PACK')
  header.writeUInt32BE(2, 4)
  header.writeUInt32BE(definitions.length, 8)
  const records = []
  const entries = []
  let offset = 12n
  for (const definition of definitions) {
    const payload = definition.payload ?? definition.body ?? Buffer.alloc(0)
    const compressed = definition.compressed ?? deflateSync(payload)
    const prefix = [encodePackHeader(definition.type, payload.length)]
    if (definition.type === 7) prefix.push(Buffer.from(definition.baseOid, 'hex'))
    const entry = definition.rawEntry ?? Buffer.concat([...prefix, compressed])
    entries.push(entry)
    records.push({ oid: definition.oid, offset: definition.indexOffset ?? offset, crc: crc32(entry) })
    offset += BigInt(entry.length)
  }
  const withoutTrailer = Buffer.concat([header, ...entries])
  let pack = Buffer.concat([withoutTrailer, sha1(withoutTrailer)])
  if (mutatePack) pack = mutatePack(Buffer.from(pack))
  const packChecksum = pack.subarray(pack.length - 20)
  const idx = buildIndexBytes(records, packChecksum)
  const stem = `pack-${nameByte.repeat(40)}`
  return [
    { path: `.git/objects/pack/${stem}.pack`, base64: pack.toString('base64') },
    { path: `.git/objects/pack/${stem}.idx`, base64: idx.toString('base64') },
  ]
}

const openStoreFromSnapshot = async (snapshot, FsaClass = fsaModule.ReadOnlyFsa) => {
  const root = memoryDirectoryFromSnapshot(snapshot)
  const probe = await repository.probeRepository(root)
  if (probe.kind !== 'ready') throw new Error(`Synthetic repository probe failed: ${probe.reason}`)
  return objectStore.GitObjectStore.open(new FsaClass(probe.git.root))
}

const encodeVarint = (value) => {
  const bytes = []
  do {
    let byte = value & 0x7f
    value = Math.floor(value / 128)
    if (value) byte |= 0x80
    bytes.push(byte)
  } while (value)
  return bytes
}
const copyInstruction = (offset, size) => {
  let opcode = 0x80
  const bytes = []
  for (let i = 0; i < 4; i++) {
    const byte = Math.floor(offset / 2 ** (i * 8)) & 0xff
    if (byte) { opcode |= 1 << i; bytes.push(byte) }
  }
  for (let i = 0; i < 3; i++) {
    const byte = Math.floor(size / 2 ** (i * 8)) & 0xff
    if (byte) { opcode |= 1 << (i + 4); bytes.push(byte) }
  }
  return [opcode, ...bytes]
}

let randomState = 0x12345678
const randomByte = () => {
  randomState ^= randomState << 13
  randomState ^= randomState >>> 17
  randomState ^= randomState << 5
  return randomState & 0xff
}
for (let round = 0; round < 100; round++) {
  const base = Buffer.alloc(256 + (randomByte() % 200))
  for (let i = 0; i < base.length; i++) base[i] = randomByte()
  const firstOffset = randomByte() % 50
  const firstSize = 50 + (randomByte() % 80)
  const insert = Buffer.from([randomByte(), randomByte(), randomByte()])
  const secondOffset = Math.min(base.length - 60, firstOffset + firstSize + 10)
  const secondSize = 60
  const result = Buffer.concat([
    base.subarray(firstOffset, firstOffset + firstSize),
    insert,
    base.subarray(secondOffset, secondOffset + secondSize),
  ])
  const instructions = Buffer.from([
    ...encodeVarint(base.length),
    ...encodeVarint(result.length),
    ...copyInstruction(firstOffset, firstSize),
    insert.length,
    ...insert,
    ...copyInstruction(secondOffset, secondSize),
  ])
  const actual = deltaModule.applyGitDelta(base, instructions, 1024 * 1024)
  if (!Buffer.from(actual).equals(result)) throw new Error(`Random delta mismatch at round ${round}`)
}
check('100 randomized copy/insert delta round trips', true)
await expectError('delta zero opcode', () => deltaModule.applyGitDelta(Buffer.alloc(0), Uint8Array.of(0, 0, 0), 10), 'object-corrupt', 'opcode zero')
await expectError('delta source-size mismatch', () => deltaModule.applyGitDelta(Buffer.alloc(1), Uint8Array.of(2, 0), 10), 'object-corrupt', 'expects')
await expectError('delta out-of-range copy', () => deltaModule.applyGitDelta(Buffer.alloc(1), Uint8Array.of(1, 1, 0x91, 1, 1), 10), 'object-corrupt', 'copy exceeds')
await expectError('delta result-size mismatch', () => deltaModule.applyGitDelta(Buffer.alloc(0), Uint8Array.of(0, 2, 1, 7), 10), 'object-corrupt', 'produced')

const largeIdx = buildIndexBytes([{ oid: '1'.repeat(40), offset: 0x100000123n, crc: 123 }], Buffer.alloc(20, 7))
const largeRoot = memoryDirectoryFromSnapshot([{ path: 'large.idx', base64: largeIdx.toString('base64') }])
const largeIndex = await packIndex.loadPackIndex(new fsaModule.ReadOnlyFsa(largeRoot), 'large.idx')
check('idx v2 64-bit large offset', largeIndex.objectOffsets[0] === 0x100000123n)
const duplicateIdx = buildIndexBytes([
  { oid: '1'.repeat(40), offset: 12n },
  { oid: '2'.repeat(40), offset: 12n },
], Buffer.alloc(20, 7))
const duplicateRoot = memoryDirectoryFromSnapshot([{ path: 'duplicate.idx', base64: duplicateIdx.toString('base64') }])
await expectError(
  'idx duplicate offset rejected',
  () => packIndex.loadPackIndex(new fsaModule.ReadOnlyFsa(duplicateRoot), 'duplicate.idx'),
  'object-corrupt',
  'duplicate',
)

const selfOid = '1'.repeat(40)
const selfCycle = buildSyntheticPack([{ oid: selfOid, type: 7, baseOid: selfOid, payload: Buffer.from([0, 0]) }])
const selfStore = await openStoreFromSnapshot(selfCycle)
await expectError('REF_DELTA self-cycle', () => selfStore.read(selfOid), 'object-corrupt', 'cycle')

const chain = []
for (let i = 1; i <= 66; i++) {
  const oid = i.toString(16).padStart(40, '0')
  const next = (i + 1).toString(16).padStart(40, '0')
  chain.push({ oid, type: 7, baseOid: next, payload: Buffer.from([0, 0]) })
}
chain.push({ oid: (67).toString(16).padStart(40, '0'), type: 3, body: Buffer.alloc(0) })
const deepStore = await openStoreFromSnapshot(buildSyntheticPack(chain))
await expectError('delta depth overflow', () => deepStore.read(chain[0].oid), 'resource-limit', 'exceeds 64')

const baseBody = Buffer.from('abc')
const baseOid = oidFor('blob', baseBody)
const outOfRangeOid = 'f'.repeat(40)
const outOfRangeDelta = Buffer.from([3, 1, 0x91, 3, 1])
const rangeStore = await openStoreFromSnapshot(buildSyntheticPack([
  { oid: baseOid, type: 3, body: baseBody },
  { oid: outOfRangeOid, type: 7, baseOid, payload: outOfRangeDelta },
]))
await expectError('packed delta out-of-range copy', () => rangeStore.read(outOfRangeOid), 'object-corrupt', 'copy exceeds')

const targetBody = Buffer.from('abcd')
const targetOid = oidFor('blob', targetBody)
const validRefDelta = Buffer.from([3, 4, 0x90, 3, 1, 'd'.charCodeAt(0)])
const crossPackSnapshot = [
  ...buildSyntheticPack([{ oid: baseOid, type: 3, body: baseBody }], undefined, '7'),
  ...buildSyntheticPack([{ oid: targetOid, type: 7, baseOid, payload: validRefDelta }], undefined, '8'),
]
const crossPackStore = await openStoreFromSnapshot(crossPackSnapshot)
const crossPackObject = await crossPackStore.read(targetOid)
check('REF_DELTA resolves a base from another pack', Buffer.from(crossPackObject.body).equals(targetBody))

const looseEnvelope = Buffer.concat([Buffer.from(`blob ${baseBody.length}\0`), baseBody])
const looseBaseSnapshot = [
  { path: `.git/objects/${baseOid.slice(0, 2)}/${baseOid.slice(2)}`, base64: deflateSync(looseEnvelope).toString('base64') },
  ...buildSyntheticPack([{ oid: targetOid, type: 7, baseOid, payload: validRefDelta }], undefined, '6'),
]
const looseBaseStore = await openStoreFromSnapshot(looseBaseSnapshot)
const looseBaseObject = await looseBaseStore.read(targetOid)
check('REF_DELTA resolves a loose-object base', Buffer.from(looseBaseObject.body).equals(targetBody))

const wrongOid = '0'.repeat(40)
const wrongStore = await openStoreFromSnapshot(buildSyntheticPack([{ oid: wrongOid, type: 3, body: baseBody }]))
await expectError('corrupt reconstructed object id', () => wrongStore.read(wrongOid), 'object-corrupt', 'does not match')

const compressed = deflateSync(baseBody)
const truncatedStore = await openStoreFromSnapshot(buildSyntheticPack([{
  oid: baseOid,
  type: 3,
  body: baseBody,
  compressed: compressed.subarray(0, Math.max(1, compressed.length - 4)),
}]))
await expectError('truncated packed zlib', () => truncatedStore.read(baseOid), 'object-corrupt', 'zlib')

const mismatchedCount = buildSyntheticPack([{ oid: baseOid, type: 3, body: baseBody }], (pack) => {
  pack.writeUInt32BE(2, 8)
  return pack
})
await expectError('pack/index count mismatch', () => openStoreFromSnapshot(mismatchedCount), 'object-corrupt', 'counts')

const invalidOffset = buildSyntheticPack([{ oid: baseOid, type: 3, body: baseBody, indexOffset: 11n }])
await expectError('out-of-range pack index offset', () => openStoreFromSnapshot(invalidOffset), 'object-corrupt', 'out-of-range')

const malformedHeaderOid = 'e'.repeat(40)
const malformedHeader = buildSyntheticPack([{
  oid: malformedHeaderOid,
  type: 3,
  rawEntry: Buffer.from([0xb0, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80]),
}])
const malformedHeaderStore = await openStoreFromSnapshot(malformedHeader)
await expectError('malformed pack object header', () => malformedHeaderStore.read(malformedHeaderOid), 'object-corrupt', 'size header')

const oversizedBody = Buffer.alloc(5 * 1024 * 1024 + 1)
const oversizedOid = oidFor('blob', oversizedBody)
const oversizedStore = await openStoreFromSnapshot(buildSyntheticPack([{ oid: oversizedOid, type: 3, body: oversizedBody }]))
let oversizedError
try {
  await oversizedStore.read(oversizedOid)
} catch (error) {
  oversizedError = error
}
check(
  'oversized packed blob yields metadata-only resource failure',
  oversizedError?.code === 'resource-limit' && oversizedError?.context?.objectType === 'blob' && oversizedError?.context?.size === oversizedBody.length,
  `${oversizedError?.code}: ${JSON.stringify(oversizedError?.context)}`,
)

const makeNoise = (size, seed) => {
  const output = Buffer.allocUnsafe(size)
  let state = seed >>> 0
  for (let i = 0; i < output.length; i++) {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    output[i] = state & 0xff
  }
  return output
}
const createPackedFixture = (useDeltaBaseOffset, includeLargeBlobs) => {
  const fixture = createGitOracleRepo(useDeltaBaseOffset ? 'lectern-pack-ofs-' : 'lectern-pack-ref-')
  const lines = Array.from({ length: 4000 }, (_, index) => `line ${index.toString().padStart(4, '0')} stable payload`).join('\n')
  for (let version = 0; version < 18; version++) {
    const changed = lines.replace(`line ${(version * 173) % 4000}`.padEnd(9), `edit ${(version * 173) % 4000}`.padEnd(9))
    fixture.write('history.txt', `${changed}\nversion ${version}\n`)
    fixture.commit(`version ${version}`)
  }
  if (includeLargeBlobs) {
    for (let i = 0; i < 9; i++) fixture.write(`noise-${i}.bin`, makeNoise(3_800_000, i + 1))
    fixture.commit('large bounded blobs')
  }
  fixture.git(['-c', `repack.useDeltaBaseOffset=${useDeltaBaseOffset}`, 'repack', '-adf', '--window=250', '--depth=50'])
  fixture.git(['prune-packed'])
  return fixture
}

class InstrumentedFsa extends fsaModule.ReadOnlyFsa {
  static reads = []
  async readSlice(path, start, end) {
    InstrumentedFsa.reads.push({ path, start, end, kind: 'slice' })
    return super.readSlice(path, start, end)
  }
  async readAll(path, maxBytes) {
    InstrumentedFsa.reads.push({ path, kind: 'all' })
    return super.readAll(path, maxBytes)
  }
}

const verifyFixture = async (fixture, expectedType, instrumented = false) => {
  const snapshot = snapshotDirectory(fixture.path)
  const root = memoryDirectoryFromSnapshot(snapshot)
  const probe = await repository.probeRepository(root)
  if (probe.kind !== 'ready') throw new Error(`Packed fixture probe failed: ${probe.reason}`)
  const FsaClass = instrumented ? InstrumentedFsa : fsaModule.ReadOnlyFsa
  if (instrumented) InstrumentedFsa.reads = []
  const git = new FsaClass(probe.git.root)
  const store = await objectStore.GitObjectStore.open(git)
  const objectLines = fixture.git(['cat-file', '--batch-all-objects', '--batch-check=%(objectname) %(objecttype) %(objectsize)']).trim().split('\n')
  const objects = objectLines.map((line) => {
    const [oid, type, size] = line.split(' ')
    return { oid, type, size: Number(size) }
  }).filter((entry) => ['commit', 'tree', 'blob', 'tag'].includes(entry.type))
  const oracle = catFileBatch(fixture.path, objects.map((entry) => entry.oid))
  let decodedBytes = 0
  for (const expected of objects) {
    const actual = await store.read(expected.oid)
    const batch = oracle.get(expected.oid)
    if (actual.type !== batch.type || !Buffer.from(actual.body).equals(batch.body)) {
      throw new Error(`Packed oracle mismatch for ${expected.oid}`)
    }
    decodedBytes += actual.body.byteLength
  }
  const packEntries = await git.list('objects/pack')
  const idxNames = packEntries.filter((entry) => entry.name.endsWith('.idx')).map((entry) => entry.name)
  const typeCounts = new Map()
  let externalRefCount = 0
  for (const idxName of idxNames) {
    const index = await packIndex.loadPackIndex(git, `objects/pack/${idxName}`)
    const packPath = `objects/pack/${idxName.slice(0, -4)}.pack`
    for (const offset of index.objectOffsets) {
      const header = await git.readSlice(packPath, Number(offset), Number(offset) + 32)
      const byte = header[0]
      const type = (byte >> 4) & 7
      typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1)
      if (type === 7) {
        let cursor = 1
        let current = byte
        while ((current & 0x80) !== 0) current = header[cursor++]
        const baseOid = Buffer.from(header.subarray(cursor, cursor + 20)).toString('hex')
        if (!index.find(baseOid)) externalRefCount++
      }
    }
  }
  check(`real Git ${expectedType} fixture contains requested delta`, (typeCounts.get(expectedType === 'OFS_DELTA' ? 6 : 7) ?? 0) > 0, JSON.stringify(Object.fromEntries(typeCounts)))
  check(`real Git ${expectedType} objects match cat-file --batch`, true, `${objects.length} objects`)
  const metrics = store.cacheMetrics()
  check(`${expectedType} decoded LRU stays within 32 MB`, metrics.bytes <= metrics.limit && (decodedBytes <= metrics.limit || metrics.bytes < decodedBytes), `${metrics.bytes}/${metrics.limit}`)
  if (instrumented) {
    check(
      'large-pack worker-owned peak memory recorded',
      metrics.peakOwnedBytes >= metrics.bytes + metrics.indexBytes,
      `${metrics.peakOwnedBytes} B peak (${metrics.bytes} B decoded cache + ${metrics.indexBytes} B pack indexes at completion)`,
    )
  }
  if (instrumented) {
    const wholePackRead = InstrumentedFsa.reads.some((read) => read.path?.endsWith('.pack') && read.kind === 'all')
    const packSizes = new Map(snapshot.filter((entry) => entry.path.endsWith('.pack')).map((entry) => [entry.path.slice(5), Buffer.from(entry.base64, 'base64').length]))
    const unboundedSlice = InstrumentedFsa.reads.some((read) => read.path?.endsWith('.pack') && read.start === 0 && read.end === packSizes.get(read.path))
    check('large pack never uses readAll or a whole-file slice', !wholePackRead && !unboundedSlice, `${InstrumentedFsa.reads.length} bounded reads`)
  }
  return { idxCount: idxNames.length, typeCounts, externalRefCount }
}

const ofsFixture = createPackedFixture(true, true)
await verifyFixture(ofsFixture, 'OFS_DELTA', true)
const refFixture = createPackedFixture(false, false)
await verifyFixture(refFixture, 'REF_DELTA')

const multi = createGitOracleRepo('lectern-pack-multiple-')
multi.write('shared.txt', 'base\n'.repeat(10_000))
multi.commit('base pack')
multi.git(['repack', '-ad'])
const existingPack = readdirSync(join(multi.path, '.git/objects/pack')).find((name) => name.endsWith('.pack'))
if (!existingPack) throw new Error('Expected first pack')
multi.write(`.git/objects/pack/${existingPack.slice(0, -5)}.keep`, 'Lectern test\n')
for (let i = 0; i < 5; i++) {
  multi.write('shared.txt', `${'base\n'.repeat(10_000)}change ${i}\n`)
  multi.commit(`increment ${i}`)
}
multi.git(['-c', 'repack.useDeltaBaseOffset=false', 'repack', '-d', '--window=250', '--depth=50'])
const multiResult = await verifyFixture(multi, 'REF_DELTA')
check('multiple packs are opened together', multiResult.idxCount >= 2, `${multiResult.idxCount} packs`)

if (results.some((ok) => !ok)) process.exitCode = 1

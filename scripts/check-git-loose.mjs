import { build } from 'esbuild'
import { deflateSync } from 'node:zlib'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { catFileBatch, createGitOracleRepo, snapshotDirectory } from './git-fixture.mjs'
import { memoryDirectoryFromSnapshot } from './fsa-memory.mjs'
import { PROJECT } from './paths.mjs'

const output = join(mkdtempSync(join(tmpdir(), 'lectern-git-loose-')), 'loose.mjs')
await build({
  entryPoints: [join(PROJECT, 'src/git/looseObject.ts'), join(PROJECT, 'src/git/sha1.ts'), join(PROJECT, 'src/git/repository.ts')],
  bundle: true,
  format: 'esm',
  outdir: output.slice(0, output.lastIndexOf('/')),
  entryNames: '[name]',
  platform: 'browser',
  logLevel: 'error',
})
const outdir = output.slice(0, output.lastIndexOf('/'))
const loose = await import(join(outdir, 'looseObject.js'))
const sha = await import(join(outdir, 'sha1.js'))
const repository = await import(join(outdir, 'repository.js'))

const results = []
const check = (name, ok, extra = '') => {
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`)
}
const bytes = (text) => new TextEncoder().encode(text)
check('SHA-1 empty vector', sha.sha1Hex(bytes('')) === 'da39a3ee5e6b4b0d3255bfef95601890afd80709')
check('SHA-1 abc vector', sha.sha1Hex(bytes('abc')) === 'a9993e364706816aba3e25717850c26c9cd0d89d')
const million = new sha.Sha1()
for (let i = 0; i < 1000; i++) million.update(bytes('a'.repeat(1000)))
check('SHA-1 incremental million-a vector', million.hex() === '34aa973cd4c4daa4f61eeb2bdbad27316534016f')

const fixture = createGitOracleRepo()
fixture.write('src/app.ts', 'export const answer = 42\n')
const commitOid = fixture.commit('initial')
fixture.git(['tag', '-a', 'v1', '-m', 'version one'], {
  env: { GIT_COMMITTER_DATE: '2000-01-01T00:01:00Z' },
})
const treeOid = fixture.git(['rev-parse', 'HEAD^{tree}']).trim()
const blobOid = fixture.git(['rev-parse', 'HEAD:src/app.ts']).trim()
const tagOid = fixture.git(['rev-parse', 'v1^{tag}']).trim()
const blobBody = readFileSync(join(fixture.path, 'src/app.ts'))
check('Git blob id matches git hash-object', sha.gitObjectOid('blob', blobBody) === blobOid)

const oracleOids = [commitOid, treeOid, blobOid, tagOid]
const batchObjects = catFileBatch(fixture.path, oracleOids)

const snapshot = snapshotDirectory(fixture.path)
const root = memoryDirectoryFromSnapshot(snapshot)
const probe = await repository.probeRepository(root)
if (probe.kind !== 'ready') throw new Error(`Fixture probe failed: ${probe.reason}`)
for (const [type, oid] of [['commit', commitOid], ['tree', treeOid], ['blob', blobOid], ['tag', tagOid]]) {
  const actual = await loose.readLooseObject(probe.git, oid)
  const expected = batchObjects.get(oid)
  check(`loose ${type} type`, actual.type === type)
  check(`cat-file --batch ${type} type`, expected?.type === type)
  check(`cat-file --batch ${type} body`, Buffer.from(actual.body).equals(expected?.body))
}

const objectPath = (oid) => `.git/objects/${oid.slice(0, 2)}/${oid.slice(2)}`
const withObject = (oid, raw) => {
  const next = snapshot.filter((entry) => entry.path !== objectPath(oid))
  next.push({ path: objectPath(oid), base64: deflateSync(raw).toString('base64') })
  return memoryDirectoryFromSnapshot(next)
}
const expectCode = async (name, oid, raw, code) => {
  const brokenProbe = await repository.probeRepository(withObject(oid, raw))
  if (brokenProbe.kind !== 'ready') throw new Error('Broken fixture probe failed')
  let actual = ''
  try {
    await loose.readLooseObject(brokenProbe.git, oid)
  } catch (error) {
    actual = error?.code
  }
  check(name, actual === code, actual)
}
const fakeOid = '0'.repeat(40)
await expectCode('unsupported object type', fakeOid, bytes('nope 3\0abc'), 'unsupported-object-type')
await expectCode('declared size mismatch', fakeOid, bytes('blob 4\0abc'), 'object-corrupt')
await expectCode('object id mismatch', fakeOid, bytes('blob 3\0abc'), 'object-corrupt')
await expectCode(
  'oversized blob rejected',
  fakeOid,
  Buffer.concat([Buffer.from(`blob ${loose.MAX_BLOB_BODY_BYTES + 1}\0`), Buffer.alloc(loose.MAX_BLOB_BODY_BYTES + 1)]),
  'resource-limit',
)
await expectCode(
  'oversized metadata rejected',
  fakeOid,
  Buffer.concat([Buffer.from(`commit ${loose.MAX_METADATA_OBJECT_BYTES + 1}\0`), Buffer.alloc(loose.MAX_METADATA_OBJECT_BYTES + 1)]),
  'resource-limit',
)

const truncated = snapshot.map((entry) => {
  if (entry.path !== objectPath(blobOid)) return entry
  const raw = Buffer.from(entry.base64, 'base64')
  return { ...entry, base64: raw.subarray(0, raw.length - 1).toString('base64') }
})
const truncatedProbe = await repository.probeRepository(memoryDirectoryFromSnapshot(truncated))
let truncatedCode = ''
try {
  await loose.readLooseObject(truncatedProbe.git, blobOid)
} catch (error) {
  truncatedCode = error?.code
}
check('truncated deflate rejected', truncatedCode === 'object-corrupt', truncatedCode)

if (results.some((ok) => !ok)) process.exitCode = 1

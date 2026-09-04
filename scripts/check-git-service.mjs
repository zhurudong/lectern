import { build } from 'esbuild'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGitOracleRepo, snapshotDirectory } from './git-fixture.mjs'
import { memoryDirectoryFromSnapshot } from './fsa-memory.mjs'
import { PROJECT } from './paths.mjs'

const outdir = mkdtempSync(join(tmpdir(), 'lectern-git-service-'))
await build({
  entryPoints: [join(PROJECT, 'src/git/comparisonService.ts'), join(PROJECT, 'src/git/workerClient.ts')],
  bundle: true,
  format: 'esm',
  outdir,
  entryNames: '[name]',
  platform: 'browser',
  logLevel: 'error',
})
const serviceModule = await import(join(outdir, 'comparisonService.js'))
const clientModule = await import(join(outdir, 'workerClient.js'))

const checks = []
const check = (name, ok, extra = '') => {
  checks.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`)
}
const endpoint = (kind, label, oid) => ({ kind, label, oid })

const fixture = createGitOracleRepo('lectern-git-service-')
fixture.write('shared.txt', 'base\n')
const base = fixture.commit('base')
fixture.git(['branch', 'feature', base])
fixture.write('main.txt', 'main\n')
const main = fixture.commit('main')
fixture.git(['checkout', 'feature'])
fixture.write('feature.txt', 'feature\n')
const feature = fixture.commit('feature')

const tree = fixture.git(['rev-parse', `${base}^{tree}`]).trim()
let sequence = 10
const commitTree = (parents, message) => {
  sequence++
  return fixture.git(['commit-tree', tree, ...parents.flatMap((parent) => ['-p', parent])], {
    input: Buffer.from(`${message}\n`),
    env: {
      GIT_AUTHOR_DATE: `2000-01-01T00:02:${sequence}Z`,
      GIT_COMMITTER_DATE: `2000-01-01T00:02:${sequence}Z`,
    },
  }).trim()
}
const a1 = commitTree([base], 'a1')
const b1 = commitTree([base], 'b1')
const mergeA = commitTree([a1, b1], 'merge a')
const mergeB = commitTree([b1, a1], 'merge b')
const unrelated = commitTree([], 'unrelated')
for (const [name, oid] of Object.entries({ mergeA, mergeB, unrelated })) fixture.git(['update-ref', `refs/heads/${name}`, oid])

fixture.write('feature.txt', 'feature modified on disk\n')
fixture.write('worktree.txt', 'untracked disk file\n')
const snapshot = snapshotDirectory(fixture.path)
const root = memoryDirectoryFromSnapshot(snapshot)
const opened = await serviceModule.ComparisonSession.open(root)
if (opened.kind !== 'ready') throw new Error(`Service fixture unavailable: ${opened.reason}`)
const session = opened.session
check('default endpoint selection is available through service refs', opened.refs.defaultBase?.name === 'refs/heads/main')

const review = await session.compare({
  mode: 'review',
  base: endpoint('branch', 'main', main),
  target: endpoint('branch', 'feature', feature),
})
check('review compares merge-base snapshot to target', review.kind === 'ready' && JSON.stringify(review.files.map((file) => `${file.status}:${file.path}`)) === JSON.stringify(['A:feature.txt']))
check('immutable review is exact', review.kind === 'ready' && review.confidence.kind === 'exact')

const direct = await session.compare({
  mode: 'direct',
  base: endpoint('branch', 'main', main),
  target: endpoint('branch', 'feature', feature),
})
check('direct compares selected base tree to target tree', direct.kind === 'ready' && JSON.stringify(direct.files.map((file) => `${file.status}:${file.path}`)) === JSON.stringify(['A:feature.txt', 'D:main.txt']))
check('initial comparison transfers manifest metadata only', direct.kind === 'ready' && !JSON.stringify(direct.files).includes('feature modified on disk'))

const empty = await session.compare({
  mode: 'direct',
  base: endpoint('commit', feature.slice(0, 8), feature),
  target: endpoint('commit', feature.slice(0, 8), feature),
})
check('exact empty result is ready/files=[] rather than unavailable', empty.kind === 'ready' && empty.files.length === 0 && empty.confidence.kind === 'exact')

const noBase = await session.compare({
  mode: 'review',
  base: endpoint('commit', 'main', main),
  target: endpoint('commit', 'unrelated', unrelated),
})
check('no common history is an explicit compare error', noBase.kind === 'error' && noBase.error.code === 'incomplete-history')
const multipleBase = await session.compare({
  mode: 'review',
  base: endpoint('commit', 'merge-a', mergeA),
  target: endpoint('commit', 'merge-b', mergeB),
})
check('multiple best merge bases are an explicit compare error', multipleBase.kind === 'error' && multipleBase.error.code === 'incomplete-history')

const worktree = await session.compare({
  mode: 'direct',
  base: endpoint('commit', 'feature', feature),
  target: { kind: 'worktree', label: '当前工作区', headOid: feature },
})
check(
  'worktree target compares HEAD tree to disk bytes',
  worktree.kind === 'ready' && JSON.stringify(worktree.files.map((file) => `${file.status}:${file.path}`)) === JSON.stringify(['M:feature.txt', 'A:worktree.txt']),
)
check('worktree comparison is explicitly limited', worktree.kind === 'ready' && worktree.confidence.kind === 'limited')
const loaded = await session.loadFilePair('feature.txt')
check(
  'selected file pair loads lazily after manifest',
  loaded.old.kind === 'content' && loaded.new.kind === 'content'
    && new TextDecoder().decode(loaded.old.bytes) === 'feature\n'
    && new TextDecoder().decode(loaded.new.bytes) === 'feature modified on disk\n',
)

root.entriesByName.get('feature.txt').contents = new TextEncoder().encode('changed after manifest\n')
let mutationCode = ''
try {
  await session.loadFilePair('feature.txt')
} catch (error) {
  mutationCode = error?.code
}
check('worktree mutation after compare is detected at lazy load', mutationCode === 'repository-changing', mutationCode)

const nonRepo = memoryDirectoryFromSnapshot([{ path: 'README.md', base64: Buffer.from('plain\n').toString('base64') }])
const unavailable = await serviceModule.ComparisonSession.open(nonRepo)
check('non-repository remains distinct from empty comparison', unavailable.kind === 'unavailable' && unavailable.reason === 'not-a-git-repository')

const missingFixture = createGitOracleRepo('lectern-git-service-missing-')
missingFixture.write('lost.txt', 'old\n')
const missingBase = missingFixture.commit('old')
missingFixture.write('lost.txt', 'new\n')
const missingTarget = missingFixture.commit('new')
const missingBlob = missingFixture.git(['rev-parse', 'HEAD:lost.txt']).trim()
const missingSnapshot = snapshotDirectory(missingFixture.path).filter((entry) => entry.path !== `.git/objects/${missingBlob.slice(0, 2)}/${missingBlob.slice(2)}`)
const missingRoot = memoryDirectoryFromSnapshot(missingSnapshot)
const missingOpened = await serviceModule.ComparisonSession.open(missingRoot)
if (missingOpened.kind !== 'ready') throw new Error('Missing-object fixture did not open')
const missingManifest = await missingOpened.session.compare({
  mode: 'direct',
  base: endpoint('commit', 'old', missingBase),
  target: endpoint('commit', 'new', missingTarget),
})
check('missing blob does not prevent metadata manifest comparison', missingManifest.kind === 'ready' && missingManifest.files[0]?.path === 'lost.txt')
let missingCode = ''
try {
  await missingOpened.session.loadFilePair('lost.txt')
} catch (error) {
  missingCode = error?.code
}
check('missing selected blob is isolated to lazy file loading', missingCode === 'object-not-found', missingCode)

class FakeWorker {
  onmessage = null
  onerror = null
  terminated = false
  messages = []
  postMessage(message) { this.messages.push(message) }
  terminate() { this.terminated = true }
}
const workers = []
const client = new clientModule.GitWorkerClient(() => {
  const worker = new FakeWorker()
  workers.push(worker)
  return worker
})
const fakeRoot = {}
const firstPromise = client.compare(fakeRoot, { mode: 'direct', base: endpoint('commit', 'a', base), target: endpoint('commit', 'b', main) })
  .then(() => 'resolved', (error) => error?.name)
const secondPromise = client.compare(fakeRoot, { mode: 'direct', base: endpoint('commit', 'a', base), target: endpoint('commit', 'c', feature) })
const firstMessage = workers[0].messages[0]
const secondMessage = workers[1].messages[0]
workers[0].onmessage({ data: { id: firstMessage.id, generation: firstMessage.generation, payload: { type: 'disposed' } } })
workers[1].onmessage({ data: { id: secondMessage.id, generation: secondMessage.generation, payload: { type: 'disposed' } } })
check('obsolete generation promise is aborted', await firstPromise === 'AbortError')
check('obsolete worker is physically terminated', workers[0].terminated)
check('latest generation resolves independently of stale response', (await secondPromise).type === 'disposed')
client.dispose()

session.dispose()
missingOpened.session.dispose()
if (checks.some((ok) => !ok)) process.exitCode = 1

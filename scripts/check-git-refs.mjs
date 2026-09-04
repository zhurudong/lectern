import { build } from 'esbuild'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGitOracleRepo, snapshotDirectory } from './git-fixture.mjs'
import { memoryDirectoryFromSnapshot } from './fsa-memory.mjs'
import { PROJECT } from './paths.mjs'

const outdir = mkdtempSync(join(tmpdir(), 'lectern-git-refs-'))
await build({
  entryPoints: [join(PROJECT, 'src/git/refs.ts'), join(PROJECT, 'src/git/objectStore.ts'), join(PROJECT, 'src/git/repository.ts')],
  bundle: true,
  format: 'esm',
  outdir,
  entryNames: '[name]',
  platform: 'browser',
  logLevel: 'error',
})
const refsModule = await import(join(outdir, 'refs.js'))
const storeModule = await import(join(outdir, 'objectStore.js'))
const repository = await import(join(outdir, 'repository.js'))

const checks = []
const check = (name, ok, extra = '') => {
  checks.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`)
}
const expectCode = async (name, action, code) => {
  let actual = ''
  try {
    await action()
  } catch (error) {
    actual = error?.code
  }
  check(name, actual === code, actual)
}

const fixture = createGitOracleRepo('lectern-git-refs-')
fixture.write('README.md', 'one\n')
const firstCommit = fixture.commit('first')
fixture.git(['branch', 'feature', firstCommit])
fixture.git(['tag', 'lightweight', firstCommit])
fixture.git(['tag', '-a', 'inner', '-m', 'inner tag', firstCommit], { env: { GIT_COMMITTER_DATE: '2000-01-01T00:02:00Z' } })
fixture.git(['tag', '-a', 'outer', '-m', 'outer tag', 'inner'], { env: { GIT_COMMITTER_DATE: '2000-01-01T00:03:00Z' } })
fixture.git(['update-ref', 'refs/remotes/origin/main', firstCommit])
fixture.git(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main'])
fixture.git(['pack-refs', '--all', '--prune'])
fixture.write('README.md', 'two\n')
const secondCommit = fixture.commit('second')
fixture.git(['gc', '--prune=now'])

const ambiguous = new Map()
let collisionPrefix = ''
let collisionOids = []
for (let index = 0; index < 2000 && !collisionPrefix; index++) {
  const oid = fixture.git(['hash-object', '-w', '--stdin'], { input: Buffer.from(`ambiguous object ${index}`) }).trim()
  const prefix = oid.slice(0, 4)
  const existing = ambiguous.get(prefix)
  if (existing && existing !== oid) {
    collisionPrefix = prefix
    collisionOids = [existing, oid]
  } else ambiguous.set(prefix, oid)
}
if (!collisionPrefix) throw new Error('Could not generate a deterministic four-hex SHA collision')
const snapshot = snapshotDirectory(fixture.path)
const root = memoryDirectoryFromSnapshot(snapshot)
const probe = await repository.probeRepository(root)
if (probe.kind !== 'ready') throw new Error(`Refs fixture probe failed: ${probe.reason}`)
const refs = await refsModule.readGitRefs(probe.git)
const store = await storeModule.GitObjectStore.open(probe.git)

check('HEAD symbolic ref resolves to newest loose main', refs.head.oid === secondCommit && refs.head.symbolicName === 'refs/heads/main')
check('loose ref overrides packed main', refs.groups.local.find((ref) => ref.name === 'refs/heads/main')?.oid === secondCommit)
check('local refs grouped', refs.groups.local.some((ref) => ref.shortName === 'feature'))
check('remote-tracking refs grouped and labeled local snapshot', refs.groups.remote.some((ref) => ref.shortName === 'origin/main' && ref.localSnapshot))
check('tags grouped without remote label', refs.groups.tag.length >= 3 && refs.groups.tag.every((ref) => !ref.localSnapshot))
check('remote HEAD name selects local main as default base', refs.defaultBase?.name === 'refs/heads/main')
check('short SHA labels are stable', refs.refs.every((ref) => ref.shortOid === ref.oid.slice(0, 8)))

const outer = refs.groups.tag.find((ref) => ref.shortName === 'outer')
if (!outer) throw new Error('Missing outer tag')
check('nested annotated tags peel recursively to commit', await refsModule.peelToCommit(store, outer.oid) === firstCommit)
const lightweight = refs.groups.tag.find((ref) => ref.shortName === 'lightweight')
check('lightweight tag resolves as commit', lightweight && await refsModule.peelToCommit(store, lightweight.oid) === firstCommit)
check('packed object unique SHA prefix resolves', await refsModule.resolveCommitInput(store, secondCommit.slice(0, 10)) === secondCommit)
await expectCode('ambiguous SHA prefix rejected', () => refsModule.resolveCommitInput(store, collisionPrefix), 'ambiguous-object')
check('ambiguous fixture has distinct ids', collisionOids[0] !== collisionOids[1], collisionPrefix)
const blobOid = fixture.git(['rev-parse', 'HEAD:README.md']).trim()
await expectCode('non-commit SHA rejected', () => refsModule.resolveCommitInput(store, blobOid), 'non-commit-object')
await expectCode('missing SHA rejected', () => refsModule.resolveCommitInput(store, '00000000'), 'object-not-found')
await expectCode('64-hex SHA input rejected as unsupported format', () => refsModule.resolveCommitInput(store, 'a'.repeat(64)), 'unsupported-object-format')

fixture.git(['checkout', '--detach', secondCommit])
const detachedRoot = memoryDirectoryFromSnapshot(snapshotDirectory(fixture.path))
const detachedProbe = await repository.probeRepository(detachedRoot)
const detached = await refsModule.readGitRefs(detachedProbe.git)
check('detached HEAD resolves exact commit without symbolic name', detached.head.oid === secondCommit && detached.head.symbolicName == null)

const openSyntheticGit = async (entries) => {
  const syntheticRoot = memoryDirectoryFromSnapshot(entries)
  const result = await repository.probeRepository(syntheticRoot)
  if (result.kind !== 'ready') throw new Error(`Synthetic refs probe failed: ${result.reason}`)
  return result.git
}
const sha256Git = await openSyntheticGit([
  { path: '.git/config', base64: Buffer.from('[core]\n\trepositoryformatversion = 1\n[extensions]\n\tobjectFormat = sha256\n').toString('base64') },
  { path: '.git/HEAD', base64: Buffer.from(`${'a'.repeat(64)}\n`).toString('base64') },
])
await expectCode('SHA-256 repository config rejected', () => refsModule.readGitRefs(sha256Git), 'unsupported-object-format')

const widthGit = await openSyntheticGit([
  { path: '.git/HEAD', base64: Buffer.from(`${'a'.repeat(64)}\n`).toString('base64') },
])
await expectCode('64-hex ref width rejected without config hint', () => refsModule.readGitRefs(widthGit), 'unsupported-object-format')

const alternatesGit = await openSyntheticGit([
  { path: '.git/HEAD', base64: Buffer.from(`${firstCommit}\n`).toString('base64') },
  { path: '.git/objects/info/alternates', base64: Buffer.from('/private/shared/objects\n').toString('base64') },
])
await expectCode('authorization-external alternates rejected', () => refsModule.readGitRefs(alternatesGit), 'external-alternates')

const cycleGit = await openSyntheticGit([
  { path: '.git/HEAD', base64: Buffer.from('ref: refs/heads/a\n').toString('base64') },
  { path: '.git/refs/heads/a', base64: Buffer.from('ref: refs/heads/b\n').toString('base64') },
  { path: '.git/refs/heads/b', base64: Buffer.from('ref: refs/heads/a\n').toString('base64') },
])
await expectCode('symbolic ref cycle rejected', () => refsModule.readGitRefs(cycleGit), 'ref-cycle')

const masterFallbackGit = await openSyntheticGit([
  { path: '.git/HEAD', base64: Buffer.from('ref: refs/heads/topic\n').toString('base64') },
  { path: '.git/refs/heads/topic', base64: Buffer.from(`${firstCommit}\n`).toString('base64') },
  { path: '.git/refs/heads/master', base64: Buffer.from(`${secondCommit}\n`).toString('base64') },
])
const masterFallback = await refsModule.readGitRefs(masterFallbackGit)
check('default base falls back from missing main to master', masterFallback.defaultBase?.name === 'refs/heads/master')

const headFallbackGit = await openSyntheticGit([
  { path: '.git/HEAD', base64: Buffer.from('ref: refs/heads/topic\n').toString('base64') },
  { path: '.git/refs/heads/topic', base64: Buffer.from(`${firstCommit}\n`).toString('base64') },
])
const headFallback = await refsModule.readGitRefs(headFallbackGit)
check('default base finally falls back to current HEAD branch', headFallback.defaultBase?.name === 'refs/heads/topic')

if (checks.some((ok) => !ok)) process.exitCode = 1

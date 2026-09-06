import { build } from 'esbuild'
import { chmodSync, mkdtempSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGitOracleRepo, snapshotDirectory } from './git-fixture.mjs'
import { memoryDirectoryFromSnapshot } from './fsa-memory.mjs'
import { PROJECT } from './paths.mjs'

const outdir = mkdtempSync(join(tmpdir(), 'lectern-git-worktree-'))
await build({
  entryPoints: [
    join(PROJECT, 'src/git/worktree.ts'),
    join(PROJECT, 'src/git/commitGraph.ts'),
    join(PROJECT, 'src/git/objectStore.ts'),
    join(PROJECT, 'src/git/repository.ts'),
    join(PROJECT, 'src/git/fsa.ts'),
  ],
  bundle: true,
  format: 'esm',
  outdir,
  entryNames: '[name]',
  platform: 'browser',
  logLevel: 'error',
})
const worktreeModule = await import(join(outdir, 'worktree.js'))
const graphModule = await import(join(outdir, 'commitGraph.js'))
const storeModule = await import(join(outdir, 'objectStore.js'))
const repository = await import(join(outdir, 'repository.js'))
const fsaModule = await import(join(outdir, 'fsa.js'))

const checks = []
const check = (name, ok, extra = '') => {
  checks.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`)
}

const fixture = createGitOracleRepo('lectern-git-worktree-')
fixture.write('tracked-ignore.txt', 'tracked original\n')
fixture.write('ignored-dir/tracked.txt', 'tracked in ignored directory\n')
fixture.write('same-size.txt', 'AAAA\n')
fixture.write('delete-me.txt', 'delete me\n')
fixture.write('staged-divergence.txt', 'disk truth\n')
fixture.write('mode-only.sh', '#!/bin/sh\necho mode\n')
fixture.write('nested/tracked.txt', 'nested tracked\n')
const head = fixture.commit('worktree base')
const headTree = fixture.git(['rev-parse', 'HEAD^{tree}']).trim()

fixture.write('.gitignore', [
  '*.log',
  'ignored-dir/',
  'tracked-ignore.txt',
  'negated/*',
  '!negated/keep.txt',
  '',
].join('\n'))
fixture.write('nested/.gitignore', '*.tmp\n!important.tmp\n')
fixture.write('.git/info/exclude', 'info-only.txt\n')
fixture.write('tracked-ignore.txt', 'tracked modified\n')
fixture.write('ignored-dir/tracked.txt', 'tracked directory modified\n')
fixture.write('same-size.txt', 'BBBB\n')
unlinkSync(join(fixture.path, 'delete-me.txt'))
fixture.write('debug.log', 'ignored root log\n')
fixture.write('ignored-dir/untracked.txt', 'ignored by parent directory\n')
fixture.write('negated/drop.txt', 'ignored by wildcard\n')
fixture.write('negated/keep.txt', 're-included\n')
fixture.write('nested/drop.tmp', 'ignored nested\n')
fixture.write('nested/important.tmp', 're-included nested\n')
fixture.write('info-only.txt', 'ignored by info exclude\n')
fixture.write('ordinary.txt', 'ordinary untracked\n')
fixture.write('large.bin', Buffer.alloc(6 * 1024 * 1024, 0x5a))

fixture.write('staged-divergence.txt', 'staged content\n')
fixture.git(['add', 'staged-divergence.txt'])
fixture.write('staged-divergence.txt', 'disk truth\n')
chmodSync(join(fixture.path, 'mode-only.sh'), 0o755)

const snapshot = snapshotDirectory(fixture.path)
const root = memoryDirectoryFromSnapshot(snapshot)
const probe = await repository.probeRepository(root)
if (probe.kind !== 'ready') throw new Error(`Worktree fixture probe failed: ${probe.reason}`)
const project = new fsaModule.ReadOnlyFsa(root)
const store = await storeModule.GitObjectStore.open(probe.git)
const graph = await graphModule.CommitGraph.open(probe.git, store)
check('fixture HEAD remains the immutable base', (await graph.read(head)).tree === headTree)

const hashChunks = []
const comparison = await worktreeModule.compareTreeToWorktree(store, headTree, project, probe.git, (path, bytes) => hashChunks.push({ path, bytes }))
const actual = new Map(comparison.files.map((file) => [file.path, file]))

const raw = fixture.git(['diff', 'HEAD', '--raw', '--no-renames', '--abbrev=40']).trim()
const expected = new Map()
if (raw) {
  for (const line of raw.split('\n')) {
    const match = /^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40}) ([0-9a-f]{40}) ([A-Z])\t(.*)$/.exec(line)
    if (!match) throw new Error(`Unexpected worktree git diff line: ${line}`)
    // FSA cannot observe a pure executable-bit change, so content-equal mode
    // changes belong to the explicit limitation rather than the content list.
    if (match[1] !== match[2] && match[5] === 'M') {
      const diskOid = fixture.git(['hash-object', match[6]]).trim()
      const headOid = fixture.git(['rev-parse', `HEAD:${match[6]}`]).trim()
      if (diskOid === headOid) continue
    }
    expected.set(match[6], match[5] === 'A' || match[5] === 'D' ? match[5] : 'M')
  }
}
const untracked = fixture.git(['ls-files', '--others', '--exclude-standard']).trim()
if (untracked) for (const path of untracked.split('\n')) expected.set(path, 'A')
const actualStatuses = [...actual.entries()].map(([path, file]) => [path, file.status]).sort()
const expectedStatuses = [...expected.entries()].sort()
check(
  'worktree A/M/D manifest matches isolated Git content truth',
  JSON.stringify(actualStatuses) === JSON.stringify(expectedStatuses),
  JSON.stringify({ actual: actualStatuses, expected: expectedStatuses }),
)

for (const file of comparison.files) {
  if (file.new) {
    const oracleOid = fixture.git(['hash-object', file.path]).trim()
    check(`worktree blob id ${file.path}`, file.new.oid === oracleOid)
  }
  if (file.old) {
    const oracleOld = fixture.git(['rev-parse', `HEAD:${file.path}`]).trim()
    check(`base blob id ${file.path}`, file.old.oid === oracleOld)
  }
}

check('tracked ignored file remains visible', actual.get('tracked-ignore.txt')?.status === 'M')
check('tracked file inside ignored directory remains visible', actual.get('ignored-dir/tracked.txt')?.status === 'M')
check('root ignore excludes untracked log', !actual.has('debug.log'))
check('ignored parent directory excludes untracked descendant', !actual.has('ignored-dir/untracked.txt'))
check('root negation re-includes selected file', actual.get('negated/keep.txt')?.status === 'A' && !actual.has('negated/drop.txt'))
check('nested ignore and negation are scoped correctly', actual.get('nested/important.tmp')?.status === 'A' && !actual.has('nested/drop.tmp'))
check('accessible .git/info/exclude is applied', !actual.has('info-only.txt'))
check('same-size content change is detected by blob id', actual.get('same-size.txt')?.status === 'M')
check('tracked deletion is detected', actual.get('delete-me.txt')?.status === 'D')
check('staged index divergence is ignored when disk equals HEAD', !actual.has('staged-divergence.txt'))
check('mode-only disk change is not falsely claimed as content change', !actual.has('mode-only.sh'))
check('.git is hard excluded from every changed path', [...actual.keys()].every((path) => path !== '.git' && !path.startsWith('.git/')))
check('large file hashing uses bounded 1 MiB chunks', hashChunks.filter((entry) => entry.path === 'large.bin').length === 6 && hashChunks.every((entry) => entry.bytes <= 1024 * 1024))
check(
  'worktree result explicitly discloses mode/symlink and global-exclude limits',
  comparison.snapshot.confidence === 'limited'
    && comparison.snapshot.limitations.includes('filesystem-mode-and-symlink-unobservable')
    && comparison.snapshot.limitations.includes('global-excludes-unavailable'),
)

// A content-clean worktree still has limited permission equivalence.
// Reuse a new clean fixture to avoid mutating the exercised repository/index.
const cleanFixture = createGitOracleRepo('lectern-git-worktree-clean-')
cleanFixture.write('clean.txt', 'clean\n')
const cleanHead = cleanFixture.commit('clean')
const cleanTree = cleanFixture.git(['rev-parse', `${cleanHead}^{tree}`]).trim()
const cleanRoot = memoryDirectoryFromSnapshot(snapshotDirectory(cleanFixture.path))
const cleanProbe = await repository.probeRepository(cleanRoot)
const cleanStore = await storeModule.GitObjectStore.open(cleanProbe.git)
const cleanComparison = await worktreeModule.compareTreeToWorktree(cleanStore, cleanTree, new fsaModule.ReadOnlyFsa(cleanRoot), cleanProbe.git)
check('content-clean worktree is empty but never marked exact', cleanComparison.files.length === 0 && cleanComparison.snapshot.confidence === 'limited')

if (checks.some((ok) => !ok)) process.exitCode = 1

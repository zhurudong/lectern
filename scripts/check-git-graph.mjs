import { build } from 'esbuild'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGitOracleRepo, snapshotDirectory } from './git-fixture.mjs'
import { memoryDirectoryFromSnapshot } from './fsa-memory.mjs'
import { PROJECT } from './paths.mjs'

const outdir = mkdtempSync(join(tmpdir(), 'lectern-git-graph-'))
await build({
  entryPoints: [
    join(PROJECT, 'src/git/commitGraph.ts'),
    join(PROJECT, 'src/git/treeDiff.ts'),
    join(PROJECT, 'src/git/objectStore.ts'),
    join(PROJECT, 'src/git/repository.ts'),
  ],
  bundle: true,
  format: 'esm',
  outdir,
  entryNames: '[name]',
  platform: 'browser',
  logLevel: 'error',
})
const graphModule = await import(join(outdir, 'commitGraph.js'))
const treeModule = await import(join(outdir, 'treeDiff.js'))
const storeModule = await import(join(outdir, 'objectStore.js'))
const repository = await import(join(outdir, 'repository.js'))

const checks = []
const check = (name, ok, extra = '') => {
  checks.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`)
}

const fixture = createGitOracleRepo('lectern-git-graph-')
fixture.write('base.txt', 'base\n')
const rootCommit = fixture.commit('root')
const rootTree = fixture.git(['rev-parse', `${rootCommit}^{tree}`]).trim()
fixture.write('base.txt', 'left\n')
fixture.write('left.txt', 'left only\n')
const leftTreeCommit = fixture.commit('left tree')
const leftTree = fixture.git(['rev-parse', `${leftTreeCommit}^{tree}`]).trim()
fixture.git(['reset', '--hard', rootCommit])
fixture.write('base.txt', 'right\n')
fixture.write('right.txt', 'right only\n')
const rightTreeCommit = fixture.commit('right tree')
const rightTree = fixture.git(['rev-parse', `${rightTreeCommit}^{tree}`]).trim()
fixture.git(['update-ref', 'refs/heads/test-linear-left', leftTreeCommit])
fixture.git(['update-ref', 'refs/heads/test-linear-right', rightTreeCommit])

let commitSequence = 10
const commitTree = (tree, parents, message) => {
  commitSequence++
  const seconds = String(commitSequence).padStart(2, '0')
  return fixture.git(['commit-tree', tree, ...parents.flatMap((parent) => ['-p', parent])], {
    input: Buffer.from(`${message}\n`),
    env: {
      GIT_AUTHOR_DATE: `2000-01-01T00:01:${seconds}Z`,
      GIT_COMMITTER_DATE: `2000-01-01T00:01:${seconds}Z`,
    },
  }).trim()
}

const a1 = commitTree(leftTree, [rootCommit], 'a1')
const b1 = commitTree(rightTree, [rootCommit], 'b1')
const mergeA = commitTree(leftTree, [a1, b1], 'merge a')
const mergeB = commitTree(rightTree, [b1, a1], 'merge b')
const unrelated = commitTree(rootTree, [], 'unrelated root')
for (const [name, oid] of Object.entries({ a1, b1, mergeA, mergeB, unrelated })) fixture.git(['update-ref', `refs/heads/test-${name}`, oid])

const blobOid = fixture.git(['hash-object', '-w', '--stdin'], { input: Buffer.from('target.txt\n') }).trim()
const modeTreeInput = Buffer.concat([
  Buffer.from(`100755 blob ${blobOid}\texecutable.sh\0`),
  Buffer.from(`120000 blob ${blobOid}\tlink\0`),
  Buffer.from(`160000 commit ${rootCommit}\tmodule\0`),
  Buffer.from(`100644 blob ${blobOid}\tregular.txt\0`),
])
const modeTree = fixture.git(['mktree', '-z'], { input: modeTreeInput }).trim()
const invalidPathTreeInput = Buffer.concat([
  Buffer.from(`100644 blob ${blobOid}\tbad`),
  Buffer.from([0xff]),
  Buffer.from('name\0'),
])
const invalidPathTree = fixture.git(['mktree', '-z'], { input: invalidPathTreeInput }).trim()
const emptyTree = fixture.git(['mktree'], { input: Buffer.alloc(0) }).trim()
const emptyCommit = commitTree(emptyTree, [], 'empty')
const modeCommit = commitTree(modeTree, [emptyCommit], 'all modes')
fixture.git(['update-ref', 'refs/heads/test-modes', modeCommit])
fixture.git(['update-ref', 'refs/heads/test-empty', emptyCommit])
fixture.git(['update-ref', 'refs/heads/test-invalid-path-tree', commitTree(invalidPathTree, [], 'invalid utf8 path')])

fixture.git(['gc', '--prune=now'])
const snapshot = snapshotDirectory(fixture.path)
const root = memoryDirectoryFromSnapshot(snapshot)
const probe = await repository.probeRepository(root)
if (probe.kind !== 'ready') throw new Error(`Graph fixture probe failed: ${probe.reason}`)
const store = await storeModule.GitObjectStore.open(probe.git)
const graph = await graphModule.CommitGraph.open(probe.git, store)

const oracleMergeBases = (left, right) => {
  try {
    const output = fixture.git(['merge-base', '--all', left, right]).trim()
    return output ? output.split('\n').sort() : []
  } catch {
    return []
  }
}
const graphCases = [
  ['linear', rootCommit, leftTreeCommit],
  ['diverged', a1, b1],
  ['unrelated', mergeA, unrelated],
  ['merge', mergeA, b1],
  ['criss-cross', mergeA, mergeB],
]
for (const [name, left, right] of graphCases) {
  const expected = oracleMergeBases(left, right)
  const actual = await graph.mergeBase(left, right)
  const actualOids = actual.kind === 'single' ? [actual.oid] : actual.kind === 'multiple' ? actual.oids : []
  check(`${name} merge base matches git merge-base --all`, actual.kind !== 'incomplete' && JSON.stringify(actualOids.sort()) === JSON.stringify(expected), `${actual.kind}: ${actualOids.join(',')}`)
}

const parsedModeTree = treeModule.parseTree(modeTree, (await store.read(modeTree)).body)
check('tree parses regular mode', parsedModeTree.some((entry) => entry.kind === 'regular' && entry.mode === '100644'))
check('tree parses executable mode', parsedModeTree.some((entry) => entry.kind === 'executable' && entry.mode === '100755'))
check('tree parses symlink mode', parsedModeTree.some((entry) => entry.kind === 'symlink' && entry.mode === '120000'))
check('tree parses gitlink mode', parsedModeTree.some((entry) => entry.kind === 'gitlink' && entry.mode === '160000'))
const parsedInvalidPath = treeModule.parseTree(invalidPathTree, (await store.read(invalidPathTree)).body)
check('invalid UTF-8 path has stable escaped display form', parsedInvalidPath[0]?.displayName === 'bad\\xffname', parsedInvalidPath[0]?.displayName)
let truncatedTreeCode = ''
try {
  treeModule.parseTree(modeTree, Uint8Array.of(0x31, 0x30, 0x30, 0x36, 0x34, 0x34))
} catch (error) {
  truncatedTreeCode = error?.code
}
check('truncated raw tree entry rejected', truncatedTreeCode === 'object-corrupt', truncatedTreeCode)

const rawOracle = (left, right) => {
  const output = fixture.git(['diff', '--raw', '--no-renames', '--abbrev=40', '-r', left, right]).trim()
  if (!output) return []
  return output.split('\n').map((line) => {
    const match = /^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40}) ([0-9a-f]{40}) ([A-Z])\t(.*)$/.exec(line)
    if (!match) throw new Error(`Unexpected git diff --raw line: ${line}`)
    return {
      status: match[5] === 'A' || match[5] === 'D' ? match[5] : 'M',
      path: match[6],
      oldMode: match[1] === '000000' ? undefined : match[1].replace(/^0/, ''),
      newMode: match[2] === '000000' ? undefined : match[2].replace(/^0/, ''),
      oldOid: /^0+$/.test(match[3]) ? undefined : match[3],
      newOid: /^0+$/.test(match[4]) ? undefined : match[4],
    }
  }).sort((leftEntry, rightEntry) => leftEntry.path.localeCompare(rightEntry.path))
}
const actualTreeDiff = async (left, right) => {
  const leftCommit = await graph.read(left)
  const rightCommit = await graph.read(right)
  return (await treeModule.compareTrees(store, leftCommit.tree, rightCommit.tree)).map((entry) => ({
    status: entry.status,
    path: entry.path,
    oldMode: entry.old?.mode,
    newMode: entry.new?.mode,
    oldOid: entry.old?.oid,
    newOid: entry.new?.oid,
  })).sort((leftEntry, rightEntry) => leftEntry.path.localeCompare(rightEntry.path))
}
for (const [name, left, right] of [...graphCases, ['mode metadata', emptyCommit, modeCommit]]) {
  const expected = rawOracle(left, right)
  const actual = await actualTreeDiff(left, right)
  check(`${name} tree diff matches git diff --raw --no-renames`, JSON.stringify(actual) === JSON.stringify(expected), `${actual.length}/${expected.length} paths`)
}

const prefixTreeInput = Buffer.from(`100644 blob ${blobOid}\treplace\0`)
const childTreeInput = Buffer.from(`100644 blob ${blobOid}\tchild.txt\0`)
const childTree = fixture.git(['mktree', '-z'], { input: childTreeInput }).trim()
const directoryTreeInput = Buffer.from(`040000 tree ${childTree}\treplace\0`)
const prefixFileTree = fixture.git(['mktree', '-z'], { input: prefixTreeInput }).trim()
const prefixDirectoryTree = fixture.git(['mktree', '-z'], { input: directoryTreeInput }).trim()
// These objects were created after the store snapshot; use a fresh snapshot/store.
const prefixLeft = commitTree(prefixFileTree, [], 'prefix file')
const prefixRight = commitTree(prefixDirectoryTree, [], 'prefix directory')
fixture.git(['update-ref', 'refs/heads/test-prefix-left', prefixLeft])
fixture.git(['update-ref', 'refs/heads/test-prefix-right', prefixRight])
const prefixProbe = await repository.probeRepository(memoryDirectoryFromSnapshot(snapshotDirectory(fixture.path)))
const prefixStore = await storeModule.GitObjectStore.open(prefixProbe.git)
const prefixGraph = await graphModule.CommitGraph.open(prefixProbe.git, prefixStore)
const prefixActual = (await treeModule.compareTrees(prefixStore, (await prefixGraph.read(prefixLeft)).tree, (await prefixGraph.read(prefixRight)).tree)).map((entry) => `${entry.status}:${entry.path}`).sort()
check('file-to-directory change expands to delete/add facts', JSON.stringify(prefixActual) === JSON.stringify(['A:replace/child.txt', 'D:replace']))

const incompleteFixture = createGitOracleRepo('lectern-git-incomplete-')
incompleteFixture.write('file.txt', 'base\n')
const missingParent = incompleteFixture.commit('base')
incompleteFixture.write('file.txt', 'child\n')
const incompleteChild = incompleteFixture.commit('child')
const incompleteTree = incompleteFixture.git(['rev-parse', `${incompleteChild}^{tree}`]).trim()
const separateRoot = incompleteFixture.git(['commit-tree', incompleteTree], {
  input: Buffer.from('separate\n'),
  env: { GIT_AUTHOR_DATE: '2000-01-01T00:05:00Z', GIT_COMMITTER_DATE: '2000-01-01T00:05:00Z' },
}).trim()
const missingPath = `.git/objects/${missingParent.slice(0, 2)}/${missingParent.slice(2)}`
const incompleteSnapshot = snapshotDirectory(incompleteFixture.path).filter((entry) => entry.path !== missingPath)
const incompleteProbe = await repository.probeRepository(memoryDirectoryFromSnapshot(incompleteSnapshot))
const incompleteStore = await storeModule.GitObjectStore.open(incompleteProbe.git)
const incompleteGraph = await graphModule.CommitGraph.open(incompleteProbe.git, incompleteStore)
const incompleteResult = await incompleteGraph.mergeBase(incompleteChild, separateRoot)
check('missing ancestor is distinct from no common history', incompleteResult.kind === 'incomplete' && incompleteResult.missingOid === missingParent)

const shallowSnapshot = snapshotDirectory(incompleteFixture.path)
shallowSnapshot.push({ path: '.git/shallow', base64: Buffer.from(`${incompleteChild}\n`).toString('base64') })
const shallowProbe = await repository.probeRepository(memoryDirectoryFromSnapshot(shallowSnapshot))
const shallowStore = await storeModule.GitObjectStore.open(shallowProbe.git)
const shallowGraph = await graphModule.CommitGraph.open(shallowProbe.git, shallowStore)
const shallowResult = await shallowGraph.mergeBase(incompleteChild, separateRoot)
check('shallow boundary is a distinct incomplete-history result', shallowResult.kind === 'incomplete' && shallowResult.shallow)

if (checks.some((ok) => !ok)) process.exitCode = 1

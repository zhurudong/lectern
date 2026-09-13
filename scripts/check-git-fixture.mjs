import { createGitOracleRepo, snapshotDirectory } from './git-fixture.mjs'

const fixture = createGitOracleRepo()
fixture.write('src/app.ts', 'export const value = 1\n')
const first = fixture.commit('initial')
fixture.write('src/app.ts', 'export const value = 2\n')
const second = fixture.commit('change')

const files = snapshotDirectory(fixture.path)
const paths = new Set(files.map((entry) => entry.path))
const fail = (message) => {
  console.error(`FAIL  ${message}`)
  process.exitCode = 1
}

if (!/^[0-9a-f]{40}$/.test(first) || !/^[0-9a-f]{40}$/.test(second) || first === second) {
  fail('fixture commits are not distinct SHA-1 object ids')
}
if (!paths.has('.git/HEAD')) fail('snapshot omitted .git/HEAD')
if (![...paths].some((path) => path.startsWith('.git/objects/'))) fail('snapshot omitted Git objects')
if (!paths.has('src/app.ts')) fail('snapshot omitted worktree content')

if (!process.exitCode) {
  console.log(`PASS  deterministic Git oracle fixture (${files.length} files, ${first.slice(0, 8)} → ${second.slice(0, 8)})`)
}

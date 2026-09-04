import { build } from 'esbuild'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PROJECT } from './paths.mjs'

const out = join(mkdtempSync(join(tmpdir(), 'lectern-git-access-')), 'access.mjs')
await build({
  entryPoints: [join(PROJECT, 'src/git/repository.ts'), join(PROJECT, 'src/git/fsa.ts'), join(PROJECT, 'src/git/errors.ts')],
  bundle: true,
  format: 'esm',
  outdir: out.slice(0, out.lastIndexOf('/')),
  entryNames: '[name]',
  platform: 'browser',
  logLevel: 'error',
})

const repository = await import(join(out.slice(0, out.lastIndexOf('/')), 'repository.js'))
const fsa = await import(join(out.slice(0, out.lastIndexOf('/')), 'fsa.js'))
const errors = await import(join(out.slice(0, out.lastIndexOf('/')), 'errors.js'))

const notFound = () => new DOMException('missing', 'NotFoundError')
const wrongKind = () => new DOMException('wrong kind', 'TypeMismatchError')

class MemoryFile {
  kind = 'file'
  constructor(name, contents) {
    this.name = name
    this.contents = typeof contents === 'string' ? new TextEncoder().encode(contents) : contents
  }
  async getFile() {
    const blob = new Blob([this.contents])
    return { name: this.name, size: blob.size, lastModified: 0, slice: (...args) => blob.slice(...args) }
  }
}

class MemoryDirectory {
  kind = 'directory'
  constructor(name, entries = {}) {
    this.name = name
    this.entriesByName = new Map(Object.entries(entries))
  }
  async getDirectoryHandle(name) {
    const value = this.entriesByName.get(name)
    if (!value) throw notFound()
    if (value.kind !== 'directory') throw wrongKind()
    return value
  }
  async getFileHandle(name) {
    const value = this.entriesByName.get(name)
    if (!value) throw notFound()
    if (value.kind !== 'file') throw wrongKind()
    return value
  }
  async *entries() {
    yield* this.entriesByName.entries()
  }
}

const dir = (entries = {}) => new MemoryDirectory('root', entries)
const file = (name, contents) => new MemoryFile(name, contents)
const checks = []
const check = (name, ok, extra = '') => {
  checks.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`)
}

const standard = await repository.probeRepository(dir({ '.git': dir({ HEAD: file('HEAD', 'ref: refs/heads/main\n') }) }))
check('standard .git directory', standard.kind === 'ready' && standard.gitDirPath === '.git')

const plain = await repository.probeRepository(dir({ 'README.md': file('README.md', 'plain') }))
check('non-Git directory', plain.kind === 'unavailable' && plain.reason === 'not-a-git-repository')

const malformed = await repository.probeRepository(dir({ '.git': file('.git', 'not a pointer\n') }))
check('malformed gitdir pointer', malformed.kind === 'unavailable' && malformed.reason === 'malformed-gitdir')

const inRoot = await repository.probeRepository(
  dir({ '.git': file('.git', 'gitdir: metadata/git\n'), metadata: dir({ git: dir({ HEAD: file('HEAD', 'abc') }) }) }),
)
check('in-root gitdir pointer', inRoot.kind === 'ready' && inRoot.gitDirPath === 'metadata/git')

for (const target of ['/external/repo.git', '../outside', 'C:\\private\\repo.git']) {
  const result = await repository.probeRepository(dir({ '.git': file('.git', `gitdir: ${target}\n`) }))
  check(`outside gitdir rejected (${target[0]})`, result.kind === 'unavailable' && result.reason === 'gitdir-outside-authorized-root')
}

const readOnly = new fsa.ReadOnlyFsa(dir({ data: file('data', '0123456789') }))
const slice = new TextDecoder().decode(await readOnly.readSlice('data', 2, 5))
check('bounded slice', slice === '234', slice)
let escaped = false
try {
  await readOnly.readAll('../data')
} catch (error) {
  // Each entry is bundled independently for this Node harness, so constructor
  // identity is not shared; the serialized error contract is the stable part.
  escaped = error?.code === 'invalid-path'
}
check('path traversal rejected', escaped)
check('adapter exposes no write operation', !('write' in readOnly) && !('remove' in readOnly))

const publicError = errors.gitError('gitdir-outside-authorized-root', {}, '/external/repo.git').toPublic()
check('public error redacts external path', !JSON.stringify(publicError).includes('/external'))

if (checks.some((ok) => !ok)) process.exitCode = 1

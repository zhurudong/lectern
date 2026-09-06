import { gitObjectOid } from './sha1'

const encoder = new TextEncoder()

interface ObjectRecord {
  type: 'blob' | 'tree' | 'commit'
  body: Uint8Array
  oid: string
}

type FixtureFile = string | Uint8Array

export type GitVisualFixtureVariant =
  | 'normal'
  | 'non-repo'
  | 'external-gitdir'
  | 'sha256'
  | 'missing-object'
  | 'corrupt-object'
  | 'no-merge-base'
  | 'multiple-merge-bases'
  | 'ambiguous-sha'
  | 'binary'
  | 'large-file'
  | 'worktree'

export interface GitVisualFixture {
  root: FileSystemDirectoryHandle
  variant: GitVisualFixtureVariant
  ambiguousPrefix?: string
}

function concat(parts: Uint8Array[]): Uint8Array {
  const size = parts.reduce((total, part) => total + part.byteLength, 0)
  const output = new Uint8Array(size)
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.byteLength
  }
  return output
}

function hexBytes(oid: string): Uint8Array {
  return Uint8Array.from({ length: 20 }, (_, index) => Number.parseInt(oid.slice(index * 2, index * 2 + 2), 16))
}

async function writeFile(root: FileSystemDirectoryHandle, path: string, bytes: Uint8Array | string): Promise<void> {
  const parts = path.split('/')
  const name = parts.pop()!
  let directory = root
  for (const part of parts) directory = await directory.getDirectoryHandle(part, { create: true })
  const handle = await directory.getFileHandle(name, { create: true })
  const writable = await handle.createWritable()
  const payload = new Uint8Array(typeof bytes === 'string' ? encoder.encode(bytes) : bytes)
  await writable.write(payload.buffer)
  await writable.close()
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const payload = new Uint8Array(bytes)
  const stream = new Blob([payload.buffer]).stream().pipeThrough(new CompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function store(root: FileSystemDirectoryHandle, object: ObjectRecord): Promise<void> {
  const header = encoder.encode(`${object.type} ${object.body.byteLength}\0`)
  await writeFile(root, `.git/objects/${object.oid.slice(0, 2)}/${object.oid.slice(2)}`, await deflate(concat([header, object.body])))
}

function object(type: ObjectRecord['type'], body: Uint8Array): ObjectRecord {
  return { type, body, oid: gitObjectOid(type, body) }
}

async function snapshotObjects(files: Record<string, FixtureFile>): Promise<{ objects: ObjectRecord[]; tree: string }> {
  const objects: ObjectRecord[] = []
  const root: Record<string, unknown> = {}
  for (const [path, source] of Object.entries(files)) {
    const blob = object('blob', typeof source === 'string' ? encoder.encode(source) : source)
    objects.push(blob)
    const segments = path.split('/')
    const name = segments.pop()!
    let cursor = root
    for (const segment of segments) cursor = (cursor[segment] ??= {}) as Record<string, unknown>
    cursor[name] = blob
  }
  const buildTree = (node: Record<string, unknown>): ObjectRecord => {
    const entries = Object.entries(node).map(([name, value]) => {
      if ('type' in (value as ObjectRecord)) return { name, mode: '100644', object: value as ObjectRecord }
      const child = buildTree(value as Record<string, unknown>)
      objects.push(child)
      return { name, mode: '40000', object: child }
    }).sort((left, right) => left.name.localeCompare(right.name))
    const body = concat(entries.flatMap((entry) => [encoder.encode(`${entry.mode} ${entry.name}\0`), hexBytes(entry.object.oid)]))
    return object('tree', body)
  }
  const tree = buildTree(root)
  objects.push(tree)
  return { objects, tree: tree.oid }
}

function commit(tree: string, message: string, parents: string[] = []): ObjectRecord {
  const body = encoder.encode(
    `tree ${tree}\n${parents.map((parent) => `parent ${parent}\n`).join('')}` +
    `author Lectern Demo <demo@local> 1788288000 +0800\n` +
    `committer Lectern Demo <demo@local> 1788288000 +0800\n\n${message}\n`,
  )
  return object('commit', body)
}

const baseFiles: Record<string, string> = {
  'README.md': '# Lectern Git demo\n\nRead-only local comparison.\n',
  'src/git/readBlob.ts': `export function readBlob(sha: string): Uint8Array {\n  const obj = readObject(sha)\n  if (obj.type !== 'blob') throw new Error('Expected blob')\n  return obj.body\n}\n`,
  'src/git/catFile.ts': `export async function catFile(oid: string) {\n  return readObject(oid)\n}\n`,
  'src/git/repo.ts': `export const repoVersion = '0.3.1'\n`,
  'src/git/looseObject.ts': `export function inflateLoose(bytes: Uint8Array) {\n  return bytes\n}\n`,
  'src/git/utils/hash.ts': `export const shortHash = (oid: string) => oid.slice(0, 8)\n`,
}

const targetFiles: Record<string, string> = {
  'README.md': baseFiles['README.md'],
  'src/git/readBlob.ts': `/**\n * Read a blob object by SHA.\n * @param sha The object id.\n * @param maxBytes Optional safe size boundary.\n */\nexport function readBlob(sha: string, maxBytes: number): Uint8Array {\n  const obj = readObject(sha)\n  if (obj.type !== 'blob') throw new Error(\`Expected blob, got \${obj.type}\`)\n  if (obj.body.byteLength > maxBytes) throw new Error('Blob exceeds limit')\n  return obj.body\n}\n`,
  'src/git/catFile.ts': `export async function catFile(oid: string, type = 'blob') {\n  const object = await readObject(oid)\n  return object.type === type ? object : null\n}\n`,
  'src/git/repo.ts': `export const repoVersion = '0.3.2'\nexport const readOnly = true\n`,
  'src/git/packIndex.ts': `export class PackIndex {\n  constructor(readonly fanout: Uint32Array) {}\n}\n`,
  'src/git/delta.ts': `export function applyDelta(base: Uint8Array, delta: Uint8Array) {\n  return new Uint8Array(base.byteLength + delta.byteLength)\n}\n`,
}

async function createRoot(variant: GitVisualFixtureVariant): Promise<FileSystemDirectoryHandle> {
  const opfs = await navigator.storage.getDirectory()
  return opfs.getDirectoryHandle(`lectern-git-${variant}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`, { create: true })
}

async function installObjects(root: FileSystemDirectoryHandle, objects: ObjectRecord[]): Promise<void> {
  for (const item of objects) await store(root, item)
}

async function writeStandardRefs(
  root: FileSystemDirectoryHandle,
  baseOid: string,
  targetOid: string,
): Promise<void> {
  await writeFile(root, '.git/HEAD', 'ref: refs/heads/feature/git-diff\n')
  await writeFile(root, '.git/refs/heads/main', `${baseOid}\n`)
  await writeFile(root, '.git/refs/heads/feature/git-diff', `${targetOid}\n`)
  await writeFile(root, '.git/refs/heads/release/0.3.2', `${baseOid}\n`)
  await writeFile(root, '.git/refs/remotes/origin/main', `${baseOid}\n`)
  await writeFile(root, '.git/refs/remotes/origin/feature/git-diff', `${targetOid}\n`)
  await writeFile(root, '.git/refs/remotes/origin/HEAD', 'ref: refs/remotes/origin/main\n')
  await writeFile(root, '.git/refs/tags/v0.3.1', `${baseOid}\n`)
  await writeFile(root, '.git/refs/tags/v0.3.2', `${targetOid}\n`)
  await writeFile(root, '.git/config', '[core]\n\trepositoryformatversion = 0\n')
}

async function writeWorktree(root: FileSystemDirectoryHandle, files: Record<string, FixtureFile>): Promise<void> {
  for (const [path, source] of Object.entries(files)) await writeFile(root, path, source)
}

async function createLinearFixture(
  root: FileSystemDirectoryHandle,
  before: Record<string, FixtureFile>,
  after: Record<string, FixtureFile>,
): Promise<{ baseCommit: ObjectRecord; targetCommit: ObjectRecord }> {
  const base = await snapshotObjects(before)
  const baseCommit = commit(base.tree, 'base')
  const target = await snapshotObjects(after)
  const targetCommit = commit(target.tree, 'feature', [baseCommit.oid])
  await installObjects(root, [...base.objects, baseCommit, ...target.objects, targetCommit])
  await writeStandardRefs(root, baseCommit.oid, targetCommit.oid)
  await writeWorktree(root, after)
  return { baseCommit, targetCommit }
}

function findAmbiguousObjects(): { prefix: string; objects: [ObjectRecord, ObjectRecord] } {
  const seen = new Map<string, ObjectRecord>()
  for (let index = 0; index < 200_000; index++) {
    const candidate = object('blob', encoder.encode(`lectern ambiguous fixture ${index}\n`))
    const prefix = candidate.oid.slice(0, 4)
    const previous = seen.get(prefix)
    if (previous && previous.oid !== candidate.oid) return { prefix, objects: [previous, candidate] }
    seen.set(prefix, candidate)
  }
  throw new Error('Could not construct an ambiguous four-character object prefix')
}

async function createDisconnectedFixture(root: FileSystemDirectoryHandle): Promise<void> {
  const left = await snapshotObjects({ 'left.txt': 'left history\n' })
  const right = await snapshotObjects({ 'right.txt': 'right history\n' })
  const leftCommit = commit(left.tree, 'left root')
  const rightCommit = commit(right.tree, 'right root')
  await installObjects(root, [...left.objects, leftCommit, ...right.objects, rightCommit])
  await writeStandardRefs(root, leftCommit.oid, rightCommit.oid)
  await writeWorktree(root, { 'right.txt': 'right history\n' })
}

async function createCrissCrossFixture(root: FileSystemDirectoryHandle): Promise<void> {
  const snapshot = await snapshotObjects({ 'history.txt': 'criss-cross history\n' })
  const rootCommit = commit(snapshot.tree, 'root')
  const left = commit(snapshot.tree, 'left', [rootCommit.oid])
  const right = commit(snapshot.tree, 'right', [rootCommit.oid])
  const leftMerge = commit(snapshot.tree, 'left merge', [left.oid, right.oid])
  const rightMerge = commit(snapshot.tree, 'right merge', [right.oid, left.oid])
  await installObjects(root, [...snapshot.objects, rootCommit, left, right, leftMerge, rightMerge])
  await writeStandardRefs(root, leftMerge.oid, rightMerge.oid)
  await writeWorktree(root, { 'history.txt': 'criss-cross history\n' })
}

async function createWorktreeFixture(root: FileSystemDirectoryHandle): Promise<void> {
  const committedFiles: Record<string, FixtureFile> = {
    '.gitignore': 'ignored.log\n',
    'stable.txt': 'stable\n',
    'tracked.txt': 'before\n',
    'deleted.txt': 'delete me\n',
  }
  const snapshot = await snapshotObjects(committedFiles)
  const head = commit(snapshot.tree, 'worktree base')
  await installObjects(root, [...snapshot.objects, head])
  await writeStandardRefs(root, head.oid, head.oid)
  await writeWorktree(root, {
    '.gitignore': 'ignored.log\n',
    'stable.txt': 'stable\n',
    'tracked.txt': 'after\n',
    'untracked.txt': 'untracked\n',
    'ignored.log': 'ignored\n',
  })
}

/** Development-only visual fixture. Production eliminates its dynamic import branch. */
export async function createGitVisualFixture(variant: GitVisualFixtureVariant = 'normal'): Promise<GitVisualFixture> {
  const root = await createRoot(variant)
  let ambiguousPrefix: string | undefined
  if (variant === 'non-repo') {
    await writeFile(root, 'README.md', 'Not a Git repository.\n')
  } else if (variant === 'external-gitdir') {
    await writeFile(root, '.git', 'gitdir: ../outside-authorized-root\n')
  } else if (variant === 'sha256') {
    const oid = 'a'.repeat(64)
    await writeFile(root, '.git/config', '[core]\n\trepositoryformatversion = 1\n[extensions]\n\tobjectformat = sha256\n')
    await writeFile(root, '.git/HEAD', 'ref: refs/heads/main\n')
    await writeFile(root, '.git/refs/heads/main', `${oid}\n`)
  } else if (variant === 'missing-object' || variant === 'corrupt-object') {
    const oid = variant === 'missing-object' ? 'd'.repeat(40) : 'c'.repeat(40)
    await writeStandardRefs(root, oid, oid)
    if (variant === 'corrupt-object') {
      await writeFile(root, `.git/objects/${oid.slice(0, 2)}/${oid.slice(2)}`, Uint8Array.of(0x13, 0x37, 0x00))
    }
  } else if (variant === 'no-merge-base') {
    await createDisconnectedFixture(root)
  } else if (variant === 'multiple-merge-bases') {
    await createCrissCrossFixture(root)
  } else if (variant === 'ambiguous-sha') {
    await createLinearFixture(root, baseFiles, targetFiles)
    const collision = findAmbiguousObjects()
    ambiguousPrefix = collision.prefix
    await installObjects(root, collision.objects)
  } else if (variant === 'binary') {
    await createLinearFixture(root, { 'asset.bin': Uint8Array.of(0, 1, 2, 3) }, { 'asset.bin': Uint8Array.of(0, 1, 9, 3) })
  } else if (variant === 'large-file') {
    const large = new Uint8Array(5 * 1024 * 1024 + 1)
    large.fill(0x78)
    await createLinearFixture(root, { 'large.txt': 'small\n' }, { 'large.txt': large })
  } else if (variant === 'worktree') {
    await createWorktreeFixture(root)
  } else {
    await createLinearFixture(root, baseFiles, targetFiles)
  }
  return { root, variant, ambiguousPrefix }
}

/** Stable development-only fingerprint used to prove the UI flow never writes. */
export async function fingerprintGitVisualFixture(root: FileSystemDirectoryHandle): Promise<string> {
  const parts: Uint8Array[] = []
  const walk = async (directory: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
    const entries: Array<[string, FileSystemHandle]> = []
    for await (const entry of directory.entries()) entries.push(entry)
    entries.sort(([left], [right]) => left.localeCompare(right))
    for (const [name, handle] of entries) {
      const path = prefix ? `${prefix}/${name}` : name
      if (handle.kind === 'directory') await walk(handle as FileSystemDirectoryHandle, path)
      else {
        const file = await (handle as FileSystemFileHandle).getFile()
        parts.push(encoder.encode(`${path}\0${file.size}\0`), new Uint8Array(await file.arrayBuffer()))
      }
    }
  }
  await walk(root, '')
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(concat(parts)).buffer))
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

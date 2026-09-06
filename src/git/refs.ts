import { gitError } from './errors'
import type { ReadOnlyFsa } from './fsa'
import type { GitObjectStore } from './objectStore'
import { assertSupportedRepositoryShape } from './repositoryShape'

export type RefGroup = 'local' | 'remote' | 'tag'

export interface GitRef {
  name: string
  shortName: string
  group: RefGroup
  oid: string
  shortOid: string
  /** Remote-tracking refs are only the locally stored snapshot. */
  localSnapshot: boolean
}

export interface GitRefsSnapshot {
  head: { oid: string; symbolicName?: string }
  refs: GitRef[]
  groups: { local: GitRef[]; remote: GitRef[]; tag: GitRef[] }
  defaultBase?: GitRef
}

interface RawRef {
  value: string
  source: 'loose' | 'packed'
  peeled?: string
}

function assertObjectId(value: string, ref: string): string {
  if (/^[0-9a-f]{64}$/.test(value)) throw gitError('unsupported-object-format', { ref }, 'Found a SHA-256 reference')
  if (!/^[0-9a-f]{40}$/.test(value)) throw gitError('invalid-ref', { ref }, `Invalid object id in ${ref}`)
  return value
}

function parseRefValue(text: string, ref: string): string {
  const value = text.trim()
  const symbolic = /^ref:\s+(.+)$/.exec(value)
  if (symbolic) {
    if (!/^refs\/[A-Za-z0-9._\/-]+$/.test(symbolic[1]) || symbolic[1].includes('..')) {
      throw gitError('invalid-ref', { ref }, `Invalid symbolic target ${symbolic[1]}`)
    }
    return `ref: ${symbolic[1]}`
  }
  return assertObjectId(value, ref)
}

async function walkRefFiles(git: ReadOnlyFsa, path: string, output: Map<string, RawRef>): Promise<void> {
  let entries
  try {
    entries = await git.list(path)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return
    throw error
  }
  for (const entry of entries) {
    const child = `${path}/${entry.name}`
    if (entry.kind === 'directory') await walkRefFiles(git, child, output)
    else output.set(child, { value: parseRefValue(await git.readText(child, 4096), child), source: 'loose' })
  }
}

async function readPackedRefs(git: ReadOnlyFsa): Promise<Map<string, RawRef>> {
  const output = new Map<string, RawRef>()
  let text: string
  try {
    text = await git.readText('packed-refs', 16 * 1024 * 1024)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return output
    throw error
  }
  let previous: RawRef | undefined
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    if (line.startsWith('^')) {
      if (!previous) throw gitError('invalid-ref', { path: 'packed-refs' }, 'Peeled id has no preceding ref')
      previous.peeled = assertObjectId(line.slice(1), 'packed-refs')
      continue
    }
    const match = /^([0-9a-f]{40}|[0-9a-f]{64}) (refs\/[A-Za-z0-9._\/-]+)$/.exec(line)
    if (!match || match[2].includes('..')) throw gitError('invalid-ref', { path: 'packed-refs' }, `Invalid packed ref: ${line}`)
    previous = { value: assertObjectId(match[1], match[2]), source: 'packed' }
    output.set(match[2], previous)
  }
  return output
}

function resolveRawRef(name: string, refs: Map<string, RawRef>): { oid: string; symbolicName?: string } {
  const seen = new Set<string>()
  let current = name
  let symbolicName: string | undefined
  while (true) {
    if (seen.has(current)) throw gitError('ref-cycle', { ref: name }, `Symbolic ref cycle at ${current}`)
    seen.add(current)
    const ref = refs.get(current)
    if (!ref) throw gitError('invalid-ref', { ref: name }, `Symbolic target ${current} is missing`)
    if (!ref.value.startsWith('ref: ')) return { oid: ref.value, symbolicName }
    current = ref.value.slice(5)
    symbolicName ??= current
  }
}

function describeRef(name: string, oid: string): GitRef | null {
  let group: RefGroup
  let shortName: string
  if (name.startsWith('refs/heads/')) {
    group = 'local'
    shortName = name.slice('refs/heads/'.length)
  } else if (name.startsWith('refs/remotes/')) {
    group = 'remote'
    shortName = name.slice('refs/remotes/'.length)
  } else if (name.startsWith('refs/tags/')) {
    group = 'tag'
    shortName = name.slice('refs/tags/'.length)
  } else return null
  return { name, shortName, group, oid, shortOid: oid.slice(0, 8), localSnapshot: group === 'remote' }
}

function chooseDefaultBase(refs: GitRef[], raw: Map<string, RawRef>, head: { oid: string; symbolicName?: string }): GitRef | undefined {
  const byName = new Map(refs.map((ref) => [ref.name, ref]))
  const remoteHeads = [...raw.entries()].filter(([name, value]) => name.startsWith('refs/remotes/') && name.endsWith('/HEAD') && value.value.startsWith('ref: '))
  for (const [, value] of remoteHeads.sort(([left], [right]) => left.localeCompare(right))) {
    const target = value.value.slice(5)
    const branchName = target.split('/').at(-1)
    if (!branchName) continue
    const local = byName.get(`refs/heads/${branchName}`)
    if (local) return local
    const remote = byName.get(target)
    if (remote) return remote
  }
  return byName.get('refs/heads/main')
    ?? byName.get('refs/heads/master')
    ?? (head.symbolicName ? byName.get(head.symbolicName) : undefined)
    ?? refs.find((ref) => ref.oid === head.oid && ref.group === 'local')
}

export async function readGitRefs(git: ReadOnlyFsa): Promise<GitRefsSnapshot> {
  await assertSupportedRepositoryShape(git)
  const packed = await readPackedRefs(git)
  const raw = new Map(packed)
  await walkRefFiles(git, 'refs', raw)
  let headText: string
  try {
    headText = await git.readText('HEAD', 4096)
  } catch (error) {
    throw gitError('invalid-ref', { ref: 'HEAD' }, `Cannot read HEAD: ${String(error)}`)
  }
  raw.set('HEAD', { value: parseRefValue(headText, 'HEAD'), source: 'loose' })
  const head = resolveRawRef('HEAD', raw)
  const refs: GitRef[] = []
  for (const name of [...raw.keys()].filter((name) => name !== 'HEAD').sort()) {
    const described = describeRef(name, resolveRawRef(name, raw).oid)
    if (described) refs.push(described)
  }
  const groups = {
    local: refs.filter((ref) => ref.group === 'local'),
    remote: refs.filter((ref) => ref.group === 'remote'),
    tag: refs.filter((ref) => ref.group === 'tag'),
  }
  return { head, refs, groups, defaultBase: chooseDefaultBase(refs, raw, head) }
}

function taggedObjectId(body: Uint8Array, oid: string): string {
  const text = new TextDecoder().decode(body)
  const match = /^object ([0-9a-f]{40}|[0-9a-f]{64})\n/.exec(text)
  if (!match) throw gitError('object-corrupt', { oid }, 'Annotated tag has no object header')
  return assertObjectId(match[1], oid)
}

export async function peelToCommit(store: GitObjectStore, oid: string): Promise<string> {
  const seen = new Set<string>()
  let current = oid
  for (let depth = 0; depth <= 32; depth++) {
    if (seen.has(current)) throw gitError('object-corrupt', { oid }, 'Annotated tag cycle detected')
    seen.add(current)
    const object = await store.read(current)
    if (object.type === 'commit') return current
    if (object.type !== 'tag') throw gitError('non-commit-object', { oid: current, objectType: object.type }, 'Object does not peel to a commit')
    current = taggedObjectId(object.body, current)
  }
  throw gitError('resource-limit', { oid }, 'Annotated tag chain exceeds 32 objects')
}

export async function resolveCommitInput(store: GitObjectStore, input: string): Promise<string> {
  const normalized = input.trim().toLowerCase()
  if (/^[0-9a-f]{64}$/.test(normalized)) throw gitError('unsupported-object-format', { oid: normalized }, 'SHA-256 input is unsupported')
  if (!/^[0-9a-f]{4,40}$/.test(normalized)) throw gitError('object-not-found', {}, 'Commit SHA must contain 4–40 hexadecimal characters')
  const matches = normalized.length === 40 ? [normalized] : await store.findPrefix(normalized, 2)
  if (matches.length === 0) throw gitError('object-not-found', {}, 'No local object matches the Commit SHA')
  if (matches.length > 1) throw gitError('ambiguous-object', {}, 'Commit SHA is ambiguous')
  return peelToCommit(store, matches[0])
}

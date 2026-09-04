import { gitError } from './errors'
import type { GitObjectStore } from './objectStore'

export type TreeEntryKind = 'tree' | 'regular' | 'executable' | 'symlink' | 'gitlink'

export interface TreeEntry {
  nameBytes: Uint8Array
  displayName: string
  mode: string
  kind: TreeEntryKind
  oid: string
}

export interface TreeFileSide {
  oid: string
  mode: string
  kind: Exclude<TreeEntryKind, 'tree'>
}

export interface ChangedTreeFile {
  status: 'A' | 'M' | 'D'
  path: string
  rawPath: Uint8Array
  old?: TreeFileSide
  new?: TreeFileSide
}

function bytesHex(bytes: Uint8Array): string {
  let output = ''
  for (const byte of bytes) output += byte.toString(16).padStart(2, '0')
  return output
}

function compareBytes(left: Uint8Array, right: Uint8Array): number {
  const length = Math.min(left.length, right.length)
  for (let i = 0; i < length; i++) if (left[i] !== right[i]) return left[i] - right[i]
  return left.length - right.length
}

function compareTreeOrder(left: TreeEntry, right: TreeEntry): number {
  const length = Math.min(left.nameBytes.length, right.nameBytes.length)
  for (let i = 0; i < length; i++) if (left.nameBytes[i] !== right.nameBytes[i]) return left.nameBytes[i] - right.nameBytes[i]
  if (left.nameBytes.length === right.nameBytes.length) return 0
  const leftNext = left.nameBytes.length === length ? (left.kind === 'tree' ? 0x2f : 0) : left.nameBytes[length]
  const rightNext = right.nameBytes.length === length ? (right.kind === 'tree' ? 0x2f : 0) : right.nameBytes[length]
  return leftNext - rightNext
}

function displaySegment(bytes: Uint8Array): string {
  let decoded: string
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return [...bytes].map((byte) => byte >= 0x20 && byte <= 0x7e && byte !== 0x5c ? String.fromCharCode(byte) : `\\x${byte.toString(16).padStart(2, '0')}`).join('')
  }
  return decoded.replaceAll('\\', '\\\\').replace(/[\u0000-\u001f\u007f]/g, (value) => `\\x${value.charCodeAt(0).toString(16).padStart(2, '0')}`)
}

function kindForMode(mode: string, oid: string): TreeEntryKind {
  switch (mode) {
    case '40000': return 'tree'
    case '100644': return 'regular'
    case '100755': return 'executable'
    case '120000': return 'symlink'
    case '160000': return 'gitlink'
    default: throw gitError('object-corrupt', { oid }, `Unsupported tree mode ${mode}`)
  }
}

export function parseTree(oid: string, body: Uint8Array): TreeEntry[] {
  const entries: TreeEntry[] = []
  let cursor = 0
  while (cursor < body.length) {
    const space = body.indexOf(0x20, cursor)
    const nul = body.indexOf(0, space + 1)
    if (space <= cursor || nul <= space + 1 || nul + 21 > body.length) {
      throw gitError('object-corrupt', { oid }, 'Truncated tree entry')
    }
    const mode = new TextDecoder('ascii', { fatal: true }).decode(body.subarray(cursor, space))
    if (!/^[0-7]{5,6}$/.test(mode)) throw gitError('object-corrupt', { oid }, `Invalid tree mode ${mode}`)
    const nameBytes = body.slice(space + 1, nul)
    if (nameBytes.includes(0x2f)) throw gitError('object-corrupt', { oid }, 'Tree entry name contains a slash')
    const objectId = bytesHex(body.subarray(nul + 1, nul + 21))
    entries.push({ nameBytes, displayName: displaySegment(nameBytes), mode, kind: kindForMode(mode, oid), oid: objectId })
    cursor = nul + 21
  }
  for (let i = 1; i < entries.length; i++) {
    if (compareTreeOrder(entries[i - 1], entries[i]) >= 0) {
      throw gitError('object-corrupt', { oid }, 'Tree entries are not strictly ordered')
    }
  }
  return entries
}

function joinRaw(parent: Uint8Array, child: Uint8Array): Uint8Array {
  if (parent.length === 0) return child.slice()
  const output = new Uint8Array(parent.length + 1 + child.length)
  output.set(parent)
  output[parent.length] = 0x2f
  output.set(child, parent.length + 1)
  return output
}

function side(entry: TreeEntry): TreeFileSide {
  if (entry.kind === 'tree') throw new Error('Tree is not a file side')
  return { oid: entry.oid, mode: entry.mode, kind: entry.kind }
}

async function readTree(store: GitObjectStore, oid: string): Promise<TreeEntry[]> {
  const object = await store.read(oid)
  if (object.type !== 'tree') throw gitError('object-corrupt', { oid, objectType: object.type }, 'Tree entry points to a non-tree object')
  return parseTree(oid, object.body)
}

export async function compareTrees(store: GitObjectStore, oldTree: string, newTree: string): Promise<ChangedTreeFile[]> {
  const changes: ChangedTreeFile[] = []
  const walkAll = async (entry: TreeEntry, status: 'A' | 'D', parentRaw: Uint8Array, parentDisplay: string): Promise<void> => {
    const rawPath = joinRaw(parentRaw, entry.nameBytes)
    const path = parentDisplay ? `${parentDisplay}/${entry.displayName}` : entry.displayName
    if (entry.kind === 'tree') {
      for (const child of await readTree(store, entry.oid)) await walkAll(child, status, rawPath, path)
    } else {
      changes.push(status === 'A' ? { status, path, rawPath, new: side(entry) } : { status, path, rawPath, old: side(entry) })
    }
  }
  const walk = async (leftOid: string, rightOid: string, parentRaw: Uint8Array, parentDisplay: string): Promise<void> => {
    if (leftOid === rightOid) return
    const left = await readTree(store, leftOid)
    const right = await readTree(store, rightOid)
    let i = 0
    let j = 0
    while (i < left.length || j < right.length) {
      const oldEntry = left[i]
      const newEntry = right[j]
      const comparison = oldEntry && newEntry ? compareTreeOrder(oldEntry, newEntry) : oldEntry ? -1 : 1
      if (comparison < 0) {
        await walkAll(oldEntry, 'D', parentRaw, parentDisplay)
        i++
        continue
      }
      if (comparison > 0) {
        await walkAll(newEntry, 'A', parentRaw, parentDisplay)
        j++
        continue
      }
      const rawPath = joinRaw(parentRaw, oldEntry.nameBytes)
      const path = parentDisplay ? `${parentDisplay}/${oldEntry.displayName}` : oldEntry.displayName
      if (oldEntry.kind === 'tree' && newEntry.kind === 'tree') {
        await walk(oldEntry.oid, newEntry.oid, rawPath, path)
      } else if (oldEntry.kind === 'tree') {
        await walkAll(oldEntry, 'D', parentRaw, parentDisplay)
        await walkAll(newEntry, 'A', parentRaw, parentDisplay)
      } else if (newEntry.kind === 'tree') {
        await walkAll(oldEntry, 'D', parentRaw, parentDisplay)
        await walkAll(newEntry, 'A', parentRaw, parentDisplay)
      } else if (oldEntry.oid !== newEntry.oid || oldEntry.mode !== newEntry.mode || oldEntry.kind !== newEntry.kind) {
        changes.push({ status: 'M', path, rawPath, old: side(oldEntry), new: side(newEntry) })
      }
      i++
      j++
    }
  }
  await walk(oldTree, newTree, new Uint8Array(), '')
  changes.sort((left, right) => compareBytes(left.rawPath, right.rawPath))
  return changes
}

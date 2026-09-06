import { GitReadError, gitError } from './errors'
import type { ReadOnlyFsa } from './fsa'
import { sha1Hex } from './sha1'

export type GitObjectType = 'commit' | 'tree' | 'blob' | 'tag'

export interface GitObject {
  oid: string
  type: GitObjectType
  size: number
  body: Uint8Array
  source: 'loose' | 'pack'
}
export const MAX_METADATA_OBJECT_BYTES = 16 * 1024 * 1024
export const MAX_BLOB_BODY_BYTES = 5 * 1024 * 1024
const MAX_HEADER_BYTES = 128
const VALID_TYPES = new Set<GitObjectType>(['commit', 'tree', 'blob', 'tag'])

function isMissing(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'NotFoundError'
}

async function inflateBounded(compressed: Uint8Array): Promise<Uint8Array> {
  const source = compressed.buffer.slice(
    compressed.byteOffset,
    compressed.byteOffset + compressed.byteLength,
  ) as ArrayBuffer
  let reader: ReadableStreamDefaultReader<Uint8Array>
  try {
    reader = new Blob([source]).stream().pipeThrough(new DecompressionStream('deflate')).getReader()
  } catch (error) {
    throw gitError('object-corrupt', {}, `Cannot initialize deflate stream: ${String(error)}`)
  }

  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_METADATA_OBJECT_BYTES + MAX_HEADER_BYTES) {
        await reader.cancel()
        throw gitError('resource-limit', {}, 'Inflated object exceeds metadata limit')
      }
      chunks.push(value)
    }
  } catch (error) {
    if (error instanceof GitReadError) throw error
    throw gitError('object-corrupt', {}, `Deflate stream failed: ${String(error)}`)
  }

  const output = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

function parseInflated(oid: string, inflated: Uint8Array): GitObject {
  const headerEnd = inflated.indexOf(0)
  if (headerEnd < 0 || headerEnd > MAX_HEADER_BYTES) {
    throw gitError('object-corrupt', { oid }, 'Loose object header is missing or too long')
  }
  const header = new TextDecoder('ascii', { fatal: true }).decode(inflated.subarray(0, headerEnd))
  const match = /^([^ ]+) ([0-9]+)$/.exec(header)
  if (!match) throw gitError('object-corrupt', { oid }, `Invalid loose object header: ${header}`)

  const type = match[1] as GitObjectType
  if (!VALID_TYPES.has(type)) throw gitError('unsupported-object-type', { oid }, `Unsupported object type: ${match[1]}`)
  const declaredSize = Number(match[2])
  if (!Number.isSafeInteger(declaredSize)) throw gitError('object-corrupt', { oid }, 'Unsafe object size')
  const body = inflated.subarray(headerEnd + 1)
  if (body.byteLength !== declaredSize) {
    throw gitError('object-corrupt', { oid }, `Declared ${declaredSize} bytes, decoded ${body.byteLength}`)
  }
  const limit = type === 'blob' ? MAX_BLOB_BODY_BYTES : MAX_METADATA_OBJECT_BYTES
  if (declaredSize > limit) throw gitError('resource-limit', { oid }, `${type} exceeds ${limit} bytes`)
  if (sha1Hex(inflated) !== oid) throw gitError('object-corrupt', { oid }, 'Object id does not match decoded content')
  return { oid, type, size: declaredSize, body: body.slice(), source: 'loose' }
}

export async function readLooseObject(git: ReadOnlyFsa, oid: string): Promise<GitObject> {
  if (!/^[0-9a-f]{40}$/.test(oid)) throw gitError('object-not-found', { oid }, 'Expected a full SHA-1 object id')
  const path = `objects/${oid.slice(0, 2)}/${oid.slice(2)}`
  let compressed: Uint8Array
  try {
    compressed = await git.readAll(path)
  } catch (error) {
    if (isMissing(error)) throw gitError('object-not-found', { oid }, 'Loose object is absent')
    throw error
  }
  return parseInflated(oid, await inflateBounded(compressed))
}

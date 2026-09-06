import { gitError } from './errors'

interface Cursor {
  offset: number
}

function readByte(bytes: Uint8Array, cursor: Cursor): number {
  if (cursor.offset >= bytes.byteLength) throw gitError('object-corrupt', {}, 'Truncated delta instruction stream')
  return bytes[cursor.offset++]
}

function readVarint(bytes: Uint8Array, cursor: Cursor, label: string): number {
  let value = 0
  let shift = 0
  while (true) {
    const byte = readByte(bytes, cursor)
    const part = byte & 0x7f
    if (shift >= 49 || part * 2 ** shift > Number.MAX_SAFE_INTEGER - value) {
      throw gitError('resource-limit', {}, `${label} exceeds the safe integer range`)
    }
    value += part * 2 ** shift
    if ((byte & 0x80) === 0) return value
    shift += 7
  }
}

/** Apply Git's pack delta bytecode with complete source/result bounds validation. */
export function applyGitDelta(base: Uint8Array, delta: Uint8Array, maxResultBytes: number): Uint8Array {
  const cursor: Cursor = { offset: 0 }
  const sourceSize = readVarint(delta, cursor, 'Delta source size')
  if (sourceSize !== base.byteLength) {
    throw gitError('object-corrupt', {}, `Delta expects ${sourceSize} source bytes, got ${base.byteLength}`)
  }
  const resultSize = readVarint(delta, cursor, 'Delta result size')
  if (resultSize > maxResultBytes) {
    throw gitError('resource-limit', { size: resultSize }, `Delta result exceeds ${maxResultBytes} bytes`)
  }
  const result = new Uint8Array(resultSize)
  let output = 0
  while (cursor.offset < delta.byteLength) {
    const opcode = readByte(delta, cursor)
    if (opcode === 0) throw gitError('object-corrupt', {}, 'Delta opcode zero is invalid')
    if ((opcode & 0x80) === 0) {
      const length = opcode
      if (cursor.offset + length > delta.byteLength || output + length > resultSize) {
        throw gitError('object-corrupt', {}, 'Delta insert exceeds input or output bounds')
      }
      result.set(delta.subarray(cursor.offset, cursor.offset + length), output)
      cursor.offset += length
      output += length
      continue
    }

    let copyOffset = 0
    let copySize = 0
    if ((opcode & 0x01) !== 0) copyOffset |= readByte(delta, cursor)
    if ((opcode & 0x02) !== 0) copyOffset |= readByte(delta, cursor) << 8
    if ((opcode & 0x04) !== 0) copyOffset |= readByte(delta, cursor) << 16
    if ((opcode & 0x08) !== 0) copyOffset = (copyOffset + readByte(delta, cursor) * 0x1000000) >>> 0
    if ((opcode & 0x10) !== 0) copySize |= readByte(delta, cursor)
    if ((opcode & 0x20) !== 0) copySize |= readByte(delta, cursor) << 8
    if ((opcode & 0x40) !== 0) copySize |= readByte(delta, cursor) << 16
    if (copySize === 0) copySize = 0x10000
    if (copyOffset + copySize > base.byteLength || output + copySize > resultSize) {
      throw gitError('object-corrupt', {}, 'Delta copy exceeds source or output bounds')
    }
    result.set(base.subarray(copyOffset, copyOffset + copySize), output)
    output += copySize
  }
  if (output !== resultSize) {
    throw gitError('object-corrupt', {}, `Delta produced ${output} bytes, expected ${resultSize}`)
  }
  return result
}

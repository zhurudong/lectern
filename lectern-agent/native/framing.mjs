import { endianness } from 'node:os'
const little = endianness() === 'LE'
export function encode(message) {
  const body = Buffer.from(JSON.stringify(message))
  if (body.length > 1024 * 1024) throw new Error('Native output exceeds Chrome limit')
  const prefix = Buffer.alloc(4)
  little ? prefix.writeUInt32LE(body.length) : prefix.writeUInt32BE(body.length)
  return Buffer.concat([prefix, body])
}
export function decoder(consume) {
  let pending = Buffer.alloc(0)
  return {
    push(chunk) {
      pending = Buffer.concat([pending, chunk])
      while (pending.length >= 4) {
        const length = little ? pending.readUInt32LE() : pending.readUInt32BE()
        if (!length || length > 65536) throw new Error('Invalid native frame length')
        if (pending.length < length + 4) return
        const message = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(pending.subarray(4, length + 4)))
        pending = pending.subarray(length + 4)
        consume(message)
      }
    },
    end() { if (pending.length) throw new Error('Truncated native message') },
  }
}

const BLOCK_BYTES = 64

function rotateLeft(value: number, bits: number): number {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0
}

/** Incremental SHA-1 for Git object identity, never for security decisions. */
export class Sha1 {
  private h0 = 0x67452301
  private h1 = 0xefcdab89
  private h2 = 0x98badcfe
  private h3 = 0x10325476
  private h4 = 0xc3d2e1f0
  private readonly pending = new Uint8Array(BLOCK_BYTES)
  private pendingLength = 0
  private totalBytes = 0n
  private finished = false

  update(input: Uint8Array): this {
    if (this.finished) throw new Error('SHA-1 instance is already finalized')
    this.totalBytes += BigInt(input.byteLength)
    let offset = 0

    if (this.pendingLength > 0) {
      const take = Math.min(BLOCK_BYTES - this.pendingLength, input.byteLength)
      this.pending.set(input.subarray(0, take), this.pendingLength)
      this.pendingLength += take
      offset += take
      if (this.pendingLength === BLOCK_BYTES) {
        this.process(this.pending, 0)
        this.pendingLength = 0
      }
    }

    while (offset + BLOCK_BYTES <= input.byteLength) {
      this.process(input, offset)
      offset += BLOCK_BYTES
    }
    if (offset < input.byteLength) {
      this.pending.set(input.subarray(offset), 0)
      this.pendingLength = input.byteLength - offset
    }
    return this
  }

  digest(): Uint8Array {
    if (this.finished) throw new Error('SHA-1 instance is already finalized')
    this.finished = true

    const tailBytes = this.pendingLength < 56 ? BLOCK_BYTES : BLOCK_BYTES * 2
    const tail = new Uint8Array(tailBytes)
    tail.set(this.pending.subarray(0, this.pendingLength))
    tail[this.pendingLength] = 0x80
    let bitLength = this.totalBytes * 8n
    for (let i = 0; i < 8; i++) {
      tail[tail.length - 1 - i] = Number(bitLength & 0xffn)
      bitLength >>= 8n
    }
    for (let offset = 0; offset < tail.length; offset += BLOCK_BYTES) this.process(tail, offset)

    const output = new Uint8Array(20)
    const view = new DataView(output.buffer)
    view.setUint32(0, this.h0)
    view.setUint32(4, this.h1)
    view.setUint32(8, this.h2)
    view.setUint32(12, this.h3)
    view.setUint32(16, this.h4)
    return output
  }

  hex(): string {
    return [...this.digest()].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  }

  private process(bytes: Uint8Array, offset: number): void {
    const words = new Uint32Array(80)
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, BLOCK_BYTES)
    for (let i = 0; i < 16; i++) words[i] = view.getUint32(i * 4)
    for (let i = 16; i < 80; i++) {
      words[i] = rotateLeft(words[i - 3] ^ words[i - 8] ^ words[i - 14] ^ words[i - 16], 1)
    }

    let a = this.h0
    let b = this.h1
    let c = this.h2
    let d = this.h3
    let e = this.h4
    for (let i = 0; i < 80; i++) {
      let f: number
      let k: number
      if (i < 20) {
        f = (b & c) | (~b & d)
        k = 0x5a827999
      } else if (i < 40) {
        f = b ^ c ^ d
        k = 0x6ed9eba1
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d)
        k = 0x8f1bbcdc
      } else {
        f = b ^ c ^ d
        k = 0xca62c1d6
      }
      const next = (rotateLeft(a, 5) + f + e + k + words[i]) >>> 0
      e = d
      d = c
      c = rotateLeft(b, 30)
      b = a
      a = next
    }
    this.h0 = (this.h0 + a) >>> 0
    this.h1 = (this.h1 + b) >>> 0
    this.h2 = (this.h2 + c) >>> 0
    this.h3 = (this.h3 + d) >>> 0
    this.h4 = (this.h4 + e) >>> 0
  }
}

export function sha1Hex(bytes: Uint8Array): string {
  return new Sha1().update(bytes).hex()
}

export function gitObjectOid(type: 'commit' | 'tree' | 'blob' | 'tag', body: Uint8Array): string {
  const header = new TextEncoder().encode(`${type} ${body.byteLength}\0`)
  return new Sha1().update(header).update(body).hex()
}

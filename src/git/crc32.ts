const TABLE = new Uint32Array(256)
for (let i = 0; i < TABLE.length; i++) {
  let value = i
  for (let bit = 0; bit < 8; bit++) value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  TABLE[i] = value >>> 0
}

export function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff
  for (const byte of bytes) value = TABLE[(value ^ byte) & 0xff] ^ (value >>> 8)
  return (value ^ 0xffffffff) >>> 0
}

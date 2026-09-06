export class MemoryFileHandle {
  kind = 'file'
  constructor(name, contents) {
    this.name = name
    this.contents = contents instanceof Uint8Array ? contents : new Uint8Array(contents)
  }
  async getFile() {
    const blob = new Blob([this.contents])
    return { name: this.name, size: blob.size, lastModified: 0, slice: (...args) => blob.slice(...args) }
  }
}
export class MemoryDirectoryHandle {
  kind = 'directory'
  constructor(name) {
    this.name = name
    this.entriesByName = new Map()
  }
  async getDirectoryHandle(name) {
    const value = this.entriesByName.get(name)
    if (!value) throw new DOMException('missing', 'NotFoundError')
    if (value.kind !== 'directory') throw new DOMException('wrong kind', 'TypeMismatchError')
    return value
  }
  async getFileHandle(name) {
    const value = this.entriesByName.get(name)
    if (!value) throw new DOMException('missing', 'NotFoundError')
    if (value.kind !== 'file') throw new DOMException('wrong kind', 'TypeMismatchError')
    return value
  }
  async *entries() {
    yield* this.entriesByName.entries()
  }
}

export function memoryDirectoryFromSnapshot(snapshot, name = 'root') {
  const root = new MemoryDirectoryHandle(name)
  for (const entry of snapshot) {
    const parts = entry.path.split('/')
    const filename = parts.pop()
    let directory = root
    for (const part of parts) {
      let child = directory.entriesByName.get(part)
      if (!child) {
        child = new MemoryDirectoryHandle(part)
        directory.entriesByName.set(part, child)
      }
      if (child.kind !== 'directory') throw new Error(`Fixture path collides at ${entry.path}`)
      directory = child
    }
    directory.entriesByName.set(filename, new MemoryFileHandle(filename, Buffer.from(entry.base64, 'base64')))
  }
  return root
}

// Markdown 相对资源的路径解析(design.md D3):
// 基于目录句柄逐段解析,支持 `..` 上溯;越出项目根或任何一段不存在均返回 null。

export interface ResolvedFile {
  handle: FileSystemFileHandle
  /** 相对项目根的路径段 */
  path: string[]
}

export async function resolveFile(
  root: FileSystemDirectoryHandle,
  baseDir: string[],
  relative: string,
): Promise<ResolvedFile | null> {
  const raw = relative.split(/[?#]/)[0]
  if (!raw) return null

  let segments: string[]
  let path: string[]
  if (raw.startsWith('/')) {
    // 以 / 开头按项目根解析
    segments = raw.split('/')
    path = []
  } else {
    segments = raw.split('/')
    path = [...baseDir]
  }

  try {
    for (const seg of segments) {
      const s = decodeURIComponent(seg)
      if (s === '' || s === '.') continue
      if (s === '..') {
        if (path.length === 0) return null // 越出项目根
        path.pop()
        continue
      }
      path.push(s)
    }
  } catch {
    return null // 非法 URI 编码
  }

  if (path.length === 0) return null

  try {
    let dir = root
    for (const seg of path.slice(0, -1)) {
      dir = await dir.getDirectoryHandle(seg)
    }
    const handle = await dir.getFileHandle(path[path.length - 1])
    return { handle, path }
  } catch {
    return null
  }
}

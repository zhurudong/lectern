import { identifyByName, looksBinary, languageFromShebang, type Channel } from './filetypes'

// 文件读取与降级(design.md D6):
// - 统一经 handle.getFile() → File,每次调用都从磁盘重新读取(不缓存)。
// - >5 MB 文本截断读取前 1 MB;二进制嗅探用前 8 KB。
// - 文本仅按 UTF-8 解码(非 fatal);截断边界回退掉末尾不完整的多字节序列。

export const SIZE_LIMIT = 5 * 1024 * 1024
export const TRUNCATE_BYTES = 1 * 1024 * 1024
const SNIFF_BYTES = 8192

export type LoadedPreview =
  | { kind: 'text'; channel: 'code' | 'markdown' | 'text'; name: string; size: number; text: string; truncated: boolean; language?: string }
  | { kind: 'image'; name: string; size: number; file: File }
  | { kind: 'binary'; name: string; size: number }

/** 截断读取时丢弃末尾不完整的 UTF-8 多字节序列,避免边界乱码替换符 */
export function trimIncompleteUtf8(bytes: Uint8Array): Uint8Array {
  let i = bytes.length - 1
  let continuations = 0
  // 从末尾回看至多 3 个连续字节(10xxxxxx)
  while (i >= 0 && (bytes[i] & 0xc0) === 0x80 && continuations < 3) {
    i--
    continuations++
  }
  if (i < 0) return bytes
  const lead = bytes[i]
  let needed = 0
  if ((lead & 0x80) === 0) needed = 1
  else if ((lead & 0xe0) === 0xc0) needed = 2
  else if ((lead & 0xf0) === 0xe0) needed = 3
  else if ((lead & 0xf8) === 0xf0) needed = 4
  else return bytes.subarray(0, i) // 非法首字节,连同丢弃
  if (continuations + 1 < needed) return bytes.subarray(0, i)
  return bytes
}

const decoder = new TextDecoder('utf-8') // 非 fatal:无效序列以 U+FFFD 呈现

export async function loadPreview(handle: FileSystemFileHandle): Promise<LoadedPreview> {
  const file = await handle.getFile()
  const name = file.name
  const size = file.size

  const byName = identifyByName(name)

  if (byName?.channel === 'image') {
    return { kind: 'image', name, size, file }
  }
  if (byName?.channel === 'binary') {
    return { kind: 'binary', name, size }
  }

  // 未知类型先嗅探;已知文本类型直接读
  let channel: Channel
  let language = byName?.language
  let sniffText: string | undefined
  if (byName == null) {
    const head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer())
    if (looksBinary(head)) {
      return { kind: 'binary', name, size }
    }
    sniffText = decoder.decode(trimIncompleteUtf8(head))
    language = languageFromShebang(sniffText)
    channel = language ? 'code' : 'text'
  } else {
    channel = byName.channel
  }

  const truncated = size > SIZE_LIMIT
  let text: string
  if (truncated) {
    const bytes = new Uint8Array(await file.slice(0, TRUNCATE_BYTES).arrayBuffer())
    text = decoder.decode(trimIncompleteUtf8(bytes))
  } else {
    text = decoder.decode(new Uint8Array(await file.arrayBuffer()))
  }

  return {
    kind: 'text',
    channel: channel as 'code' | 'markdown' | 'text',
    name,
    size,
    text,
    truncated,
    language,
  }
}

export function formatSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`
  return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`
}

import { extractSymbols, occurrencesOutsideCommentsAndStrings } from './extract'
import { identifyByName, looksBinary } from '../lib/filetypes'
import type { RawSymbol } from './symbols'

// 符号抽取 Worker(design.md D2):主线程只派发与查询,解析与遍历全部在这里完成。
// 一次收一"块"文件(默认 200 个),累计约 2,000 个符号即回传一批,减少消息往返。

const SIZE_LIMIT = 5 * 1024 * 1024 // 与 lib/fs.ts 的预览阈值同源
const TRUNCATE_BYTES = 1 * 1024 * 1024 // 超大文件只搜开头,与预览截断阈值同源(用户心智一致)
const SYMBOL_FLUSH = 2000
const SNIFF_BYTES = 8192

export interface WorkerTask {
  path: string
  handle: FileSystemFileHandle
  langId: string
}

interface ExtractRequest {
  type: 'extract'
  generation: number
  tasks: WorkerTask[]
}

/** 查找引用(design.md D3):按需扫描,不建反向索引 */
interface ReferencesRequest {
  type: 'references'
  generation: number
  name: string
  tasks: WorkerTask[]
}

export interface RefHit {
  path: string
  line: number
  /** 该行内容(已裁剪,用于结果面板展示) */
  text: string
  /** 命中在该行内的起始列(0-based),用于高亮 */
  col: number
}

const REF_FLUSH = 50
const LINE_CLIP = 400

/** 全文内容搜索(design.md D4):同一个 Worker 池的另一类任务 */
interface GrepRequest {
  type: 'grep'
  generation: number
  query: string
  caseSensitive: boolean
  tasks: WorkerTask[]
}

export interface GrepHit {
  path: string
  line: number
  text: string
  col: number
  /** 该文件超过大文件阈值,只搜了开头部分 */
  partial: boolean
}

const GREP_FLUSH = 50
/** 单文件命中上限(spec 默认 50);总命中上限由主线程跨 Worker 汇总后把关 */
const PER_FILE_LIMIT = 50

/** 单文件抽取结果;skipped 为降级原因(spec「索引规模降级」要求可见) */
export interface FileSymbols {
  path: string
  size: number
  lastModified: number
  symbols: RawSymbol[]
  skipped?: 'too-large' | 'error'
}

const decoder = new TextDecoder('utf-8')

/** 截断读取时丢弃末尾不完整的 UTF-8 多字节序列(与 lib/fs.ts 同一处理思路) */
function trimIncompleteUtf8(bytes: Uint8Array): Uint8Array {
  let i = bytes.length - 1
  let continuations = 0
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
  else return bytes.subarray(0, i)
  if (continuations + 1 < needed) return bytes.subarray(0, i)
  return bytes
}

async function readText(handle: FileSystemFileHandle): Promise<{ text: string; size: number; lastModified: number } | null> {
  const file = await handle.getFile()
  if (file.size > SIZE_LIMIT) return null
  const bytes = new Uint8Array(await file.arrayBuffer())
  return { text: decoder.decode(trimIncompleteUtf8(bytes)), size: file.size, lastModified: file.lastModified }
}

/**
 * 查找引用的三级漏斗(design.md D3):
 *  ① 候选文件已由主线程按语言组筛好
 *  ② 廉价预筛:整份文本 indexOf 不含该名字就直接跳过,不解析(绝大多数文件在这一级淘汰)
 *  ③ 精筛:只对命中文件做 Lezer 解析,落在注释/字符串节点内的出现丢弃
 */
async function handleReferences(req: ReferencesRequest): Promise<void> {
  const { generation, name, tasks } = req
  let out: RefHit[] = []

  const flush = (done: boolean) => {
    if (out.length > 0 || done) {
      self.postMessage({ type: 'refs', generation, results: out, done })
      out = []
    }
  }

  for (const task of tasks) {
    try {
      const read = await readText(task.handle)
      if (!read) continue
      // ② 廉价预筛
      if (!read.text.includes(name)) continue
      // ③ 精筛:靠语法树判定,而不是用正则猜注释与字符串
      const positions = occurrencesOutsideCommentsAndStrings(read.text, task.langId, name)
      if (positions.length === 0) continue
      const lineStarts = [0]
      for (let i = 0; i < read.text.length; i++) {
        if (read.text.charCodeAt(i) === 10) lineStarts.push(i + 1)
      }
      for (const pos of positions) {
        let lo = 0
        let hi = lineStarts.length - 1
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1
          if (lineStarts[mid] <= pos) lo = mid
          else hi = mid - 1
        }
        const start = lineStarts[lo]
        const end = lineStarts[lo + 1] ?? read.text.length
        const raw = read.text.slice(start, end).replace(/\n$/, '')
        out.push({ path: task.path, line: lo + 1, text: raw.slice(0, LINE_CLIP), col: pos - start })
        if (out.length >= REF_FLUSH) flush(false)
      }
    } catch {
      // 单个文件失败不中断整块扫描
    }
  }
  flush(true)
}

/**
 * 全文内容搜索:逐行字面量匹配(不做正则)。
 * 跳过图片与二进制;超过 5 MB 的文件只搜前 1 MB 并在结果上标记"部分搜索"。
 */
async function handleGrep(req: GrepRequest): Promise<void> {
  const { generation, query, caseSensitive, tasks } = req
  const needle = caseSensitive ? query : query.toLowerCase()
  let out: GrepHit[] = []
  let scanned = 0

  const flush = (done: boolean) => {
    if (out.length > 0 || done) {
      self.postMessage({ type: 'grep', generation, results: out, scanned, done })
      out = []
      scanned = 0
    }
  }

  for (const task of tasks) {
    scanned++
    try {
      const name = task.path.slice(task.path.lastIndexOf('/') + 1)
      const info = identifyByName(name)
      // 图片与已知二进制类型直接跳过,不读盘
      if (info?.channel === 'image' || info?.channel === 'binary') continue

      const file = await task.handle.getFile()
      const partial = file.size > SIZE_LIMIT
      const blob = partial ? file.slice(0, TRUNCATE_BYTES) : file
      const bytes = new Uint8Array(await blob.arrayBuffer())
      // 未知类型再按内容嗅探,避免二进制产生乱码命中
      if (looksBinary(bytes.subarray(0, SNIFF_BYTES))) continue

      const text = decoder.decode(trimIncompleteUtf8(bytes))
      const lines = text.split('\n')
      let perFile = 0
      for (let i = 0; i < lines.length && perFile < PER_FILE_LIMIT; i++) {
        const line = lines[i]
        const hay = caseSensitive ? line : line.toLowerCase()
        let from = 0
        for (;;) {
          const idx = hay.indexOf(needle, from)
          if (idx === -1) break
          out.push({ path: task.path, line: i + 1, text: line.slice(0, LINE_CLIP), col: idx, partial })
          perFile++
          from = idx + needle.length
          if (perFile >= PER_FILE_LIMIT) break
        }
      }
      if (out.length >= GREP_FLUSH) flush(false)
    } catch {
      // 单个文件失败不中断整块扫描
    }
  }
  flush(true)
}

self.onmessage = async (e: MessageEvent<ExtractRequest | ReferencesRequest | GrepRequest>) => {
  if (e.data.type === 'references') {
    await handleReferences(e.data)
    return
  }
  if (e.data.type === 'grep') {
    await handleGrep(e.data)
    return
  }
  if (e.data.type !== 'extract') return
  const { generation, tasks } = e.data

  let out: FileSymbols[] = []
  let pending = 0

  const flush = (done: boolean) => {
    if (out.length > 0 || done) {
      self.postMessage({ type: 'batch', generation, results: out, done })
      out = []
      pending = 0
    }
  }

  for (const task of tasks) {
    try {
      const file = await task.handle.getFile()
      if (file.size > SIZE_LIMIT) {
        // 超大文件不参与符号索引,但仍要上报以便 UI 明示覆盖受限
        out.push({ path: task.path, size: file.size, lastModified: file.lastModified, symbols: [], skipped: 'too-large' })
        continue
      }
      const bytes = new Uint8Array(await file.arrayBuffer())
      const text = decoder.decode(trimIncompleteUtf8(bytes))
      const symbols = extractSymbols(text, task.langId)
      out.push({ path: task.path, size: file.size, lastModified: file.lastModified, symbols })
      pending += symbols.length
      if (pending >= SYMBOL_FLUSH) flush(false)
    } catch {
      // 单个文件读取/解析失败不应中断整块:记为跳过,索引继续
      out.push({ path: task.path, size: 0, lastModified: 0, symbols: [], skipped: 'error' })
    }
  }

  flush(true)
}

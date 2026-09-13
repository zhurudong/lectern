import { signal } from '@preact/signals'
import { generation, nextGeneration } from '../lib/generation'
import { intelLevelByName, identifyByName } from '../lib/filetypes'
import { isInExcludedRelPath } from '../lib/excluded'
import { readSourceFile, type FileSource } from '../lib/fileSource'
import { WorkerPool, extractOne } from './pool'
import type { FileSymbols, WorkerTask } from './symbolWorker'
import { isOutlineOnlyKind, type KindId, type RawSymbol } from './symbols'

// 项目符号索引(code-intelligence spec「全项目符号索引」)。
//
// design.md D2 的列式结构:定长字段用 TypedArray、变长字段用普通数组,
// 便于 change #2 直接序列化落盘;`byLowerName` 是跳转与符号搜索的唯一查询入口。
// design.md D6:P0 只驻留内存,不落 IndexedDB,重开项目重建。

/** 符号总数上限(design.md D5:由内存约束定,判据是 10k 文件 / 支持语言占比 80% 的项目不得降级) */
export const MAX_SYMBOLS = 400_000

/**
 * 生效的符号上限。默认即 MAX_SYMBOLS;仅 dev 构建的测试钩子会把它调低,
 * 好让"达上限 → partial → 明示提示"这条降级路径能被确定性地断言 ——
 * 靠合成 400,000 个符号来触发太贵,而降级**机制**与阈值**取值**是两件事:
 * 取值由旗舰场景断言(306,000 不得降级),机制由这里的钩子断言。
 */
let symbolCap = MAX_SYMBOLS

/** 仅供 dev 构建的 E2E 使用(main.tsx 中由 __CV_TEST_HOOK__ 决定是否暴露) */
export function __setSymbolCap(n: number): void {
  symbolCap = n > 0 ? n : MAX_SYMBOLS
}

/** 仅供 dev 构建的 E2E 使用:模拟抽取 Worker 异常终止,验证降级 UI 契约 */
export function __simulateIndexFailure(): void {
  indexState.value = 'unavailable'
}

export type IndexState = 'idle' | 'building' | 'done' | 'partial' | 'unavailable'

export const indexState = signal<IndexState>('idle')
export const indexedFiles = signal(0)
export const totalSymbols = signal(0)
/** 数据变更版本号:UI 订阅它重算查询结果(列式数据本身不放进 signal) */
export const indexVersion = signal(0)

/**
 * 当前预览文件的符号(由大纲面板在取到结果时发布)。
 * 单文件模式没有项目索引,文件内跳转靠它 —— 用的仍是同一套抽取结果,
 * 不新增第二条代码路径(任务 8b.4)。
 */
export const activeFileSymbols = signal<SymbolHit[]>([])

/**
 * 当前预览文件的符号是否仍在抽取中。
 * 单文件模式没有项目索引,`indexState` 恒为 idle —— 没有这个信号的话,
 * "还没抽完" 与 "本文件里确实没有" 无法区分,跳转会错误地提示
 * "打开所在文件夹可获得跨文件跳转"(而符号其实就在本文件里)。
 */
export const activeFileParsing = signal(false)

// —— 列式存储 ——

let files: string[] = []
let fileMeta: { size: number; lastModified: number }[] = []
/** 该文件被跳过的原因(超大 / 解析失败);必须随索引一起留存 ——
 *  否则命中索引缓存时会丢掉降级原因,大纲就会把"文件过大未索引"错显成"未发现定义"。 */
let fileSkip: (('too-large' | 'error') | undefined)[] = []
let fileIdxByPath = new Map<string, number>()

let symName: string[] = []
let symKind = new Uint8Array(0)
let symFile = new Uint32Array(0)
let symLine = new Uint32Array(0)
let symContainer: (string | null)[] = []
/** Markdown 标题层级(1–6);其余种类恒为 0 */
let symLevel = new Uint8Array(0)
let symCount = 0

/** 小写符号名 → 符号下标列表(跳转与符号搜索的唯一入口) */
let byLowerName = new Map<string, number[]>()
/** 文件下标 → 该文件的符号下标(按文件内出现顺序,大纲直接使用) */
let symsByFile = new Map<number, number[]>()
/** 被墓碑标记的符号下标(指纹失配就地重抽后作废的旧条目) */
const DEAD = 0xffffffff

let pool: WorkerPool | null = null
let truncated = false
/**
 * 路径 → 文件句柄。遍历只做一次(design.md D2),句柄留在这里供
 * 查找引用与全文搜索按需读盘,避免为它们再走一遍全树。
 */
let handleByPath = new Map<string, FileSystemFileHandle>()

function grow(needed: number): void {
  if (needed <= symKind.length) return
  let cap = Math.max(4096, symKind.length * 2)
  while (cap < needed) cap *= 2
  const k = new Uint8Array(cap); k.set(symKind); symKind = k
  const f = new Uint32Array(cap); f.set(symFile); symFile = f
  const l = new Uint32Array(cap); l.set(symLine); symLine = l
  const v = new Uint8Array(cap); v.set(symLevel); symLevel = v
}

function fileIndex(
  path: string,
  meta: { size: number; lastModified: number },
  skipped?: 'too-large' | 'error',
): number {
  const existing = fileIdxByPath.get(path)
  if (existing !== undefined) {
    fileMeta[existing] = meta
    fileSkip[existing] = skipped
    return existing
  }
  const idx = files.length
  files.push(path)
  fileMeta.push(meta)
  fileSkip.push(skipped)
  fileIdxByPath.set(path, idx)
  return idx
}

function appendSymbols(fileIdx: number, symbols: RawSymbol[]): number {
  const room = symbolCap - symCount
  if (room <= 0) return 0
  const take = Math.min(room, symbols.length)
  grow(symCount + take)
  const list = symsByFile.get(fileIdx) ?? []
  for (let i = 0; i < take; i++) {
    const s = symbols[i]
    const at = symCount++
    symName[at] = s.name
    symKind[at] = s.kind
    symFile[at] = fileIdx
    symLine[at] = s.line
    symContainer[at] = s.container
    symLevel[at] = s.level ?? 0
    list.push(at)
    // 仅大纲条目不进定义与符号搜索索引,项目与单文件模式共用同一判定。
    if (!isOutlineOnlyKind(s.kind)) {
      const key = s.name.toLowerCase()
      const bucket = byLowerName.get(key)
      if (bucket) bucket.push(at)
      else byLowerName.set(key, [at])
    }
  }
  symsByFile.set(fileIdx, list)
  return take
}

/** 作废某文件的既有符号(就地重抽前调用) */
function tombstoneFile(fileIdx: number): void {
  const list = symsByFile.get(fileIdx)
  if (!list) return
  for (const at of list) {
    const key = symName[at].toLowerCase()
    const bucket = byLowerName.get(key)
    if (bucket) {
      const pos = bucket.indexOf(at)
      if (pos >= 0) bucket.splice(pos, 1)
      if (bucket.length === 0) byLowerName.delete(key)
    }
    symFile[at] = DEAD
  }
  symsByFile.set(fileIdx, [])
}

function ingest(results: FileSymbols[]): void {
  let added = 0
  for (const r of results) {
    const idx = fileIndex(r.path, { size: r.size, lastModified: r.lastModified }, r.skipped)
    if (symsByFile.has(idx)) tombstoneFile(idx)
    added += appendSymbols(idx, r.symbols)
  }
  indexedFiles.value = files.length
  totalSymbols.value = symCount
  indexVersion.value++
  if (symCount >= symbolCap && !truncated) {
    truncated = true
    pool?.drain()
    indexState.value = 'partial'
  }
  void added
}

/** 清空索引(切换项目、回到首页) */
export function clearIndex(): void {
  pool?.dispose()
  pool = null
  files = []
  fileMeta = []
  fileSkip = []
  fileIdxByPath = new Map()
  symName = []
  symKind = new Uint8Array(0)
  symFile = new Uint32Array(0)
  symLine = new Uint32Array(0)
  symContainer = []
  symLevel = new Uint8Array(0)
  symCount = 0
  byLowerName = new Map()
  symsByFile = new Map()
  handleByPath = new Map()
  truncated = false
  indexState.value = 'idle'
  indexedFiles.value = 0
  totalSymbols.value = 0
  indexVersion.value++
}

/** 开始为一个项目建索引(由 searchStore 的遍历回包驱动喂入文件) */
export function beginIndex(): void {
  clearIndex()
  indexState.value = 'building'
  pool = new WorkerPool({
    request: (tasks) => ({ type: 'extract', tasks }),
    onMessage: (data) => {
      if (indexState.value === 'idle') return
      if (data.type === 'batch' && data.results && data.results.length > 0) {
        ingest(data.results as FileSymbols[])
      }
    },
    onDone: () => {
      if (indexState.value === 'building') indexState.value = 'done'
    },
    onError: (message) => {
      console.warn('[code-intel] 符号索引不可用:', message)
      indexState.value = 'unavailable'
    },
  })
}

/** 遍历回包:把属于支持语言的文件派进抽取池 */
export function feedFiles(paths: string[], handles: FileSystemFileHandle[]): void {
  const tasks: WorkerTask[] = []
  for (let i = 0; i < paths.length; i++) {
    const path = paths[i]
    const handle = handles[i]
    if (!handle) continue
    // 被排除目录内的文件一律不进项目级索引(符号 / 文件名 / 全文三者一致)。
    // 遍历侧已经跳过它们,这里再判一次是为了:即便将来遍历改了,
    // 索引这条仍守住同一条判定 —— 用的还是 lib/excluded 的同一个函数。
    if (isInExcludedRelPath(path)) continue
    // 所有文件的句柄都留存:全文搜索要扫的范围比符号索引更宽(含纯文本)
    handleByPath.set(path, handle)
    if (truncated) continue
    const name = path.slice(path.lastIndexOf('/') + 1)
    if (intelLevelByName(name) === 'none') continue
    const langId = identifyByName(name)?.language
    if (!langId) continue
    tasks.push({ path, handle, langId })
  }
  if (pool && !truncated && tasks.length > 0) pool.push(tasks)
}

/** 已知的全部文件句柄(遍历阶段收集),供引用扫描与全文搜索使用 */
export function allFileHandles(): Map<string, FileSystemFileHandle> {
  return handleByPath
}

/** 参与代码理解的候选文件(查找引用漏斗的第一级:按语言组筛选) */
export function intelCandidateFiles(): WorkerTask[] {
  const out: WorkerTask[] = []
  for (const [path, handle] of handleByPath) {
    const name = path.slice(path.lastIndexOf('/') + 1)
    if (intelLevelByName(name) !== 'full') continue
    const langId = identifyByName(name)?.language
    if (!langId) continue
    out.push({ path, handle, langId })
  }
  return out
}

/** 遍历结束:队列排空后索引即完成 */
export function endFeed(): void {
  pool?.end()
}

// —— 查询接口 ——

export interface SymbolHit {
  name: string
  kind: KindId
  line: number
  container: string | null
  path: string
  /** Markdown 标题层级(1–6);其余种类为 0 */
  level: number
}

function hitAt(at: number): SymbolHit | null {
  const fileIdx = symFile[at]
  if (fileIdx === DEAD) return null
  return {
    name: symName[at],
    kind: symKind[at] as KindId,
    line: symLine[at],
    container: symContainer[at],
    path: files[fileIdx],
    level: symLevel[at],
  }
}

/** 精确名匹配(跳转到定义):不区分大小写 */
export function lookupDefinitions(name: string): SymbolHit[] {
  const bucket = byLowerName.get(name.toLowerCase())
  if (!bucket) return []
  const out: SymbolHit[] = []
  for (const at of bucket) {
    // 大小写完全一致的优先,但保留不一致的作为候选
    const hit = hitAt(at)
    if (hit) out.push(hit)
  }
  return out
}

/** 符号名子串匹配(全局符号搜索):不区分大小写 */
export function searchSymbols(query: string, limit = 50): SymbolHit[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const out: SymbolHit[] = []
  const exact: SymbolHit[] = []
  for (const [key, bucket] of byLowerName) {
    if (!key.includes(q)) continue
    for (const at of bucket) {
      const hit = hitAt(at)
      if (!hit) continue
      if (key === q) exact.push(hit)
      else out.push(hit)
      if (exact.length + out.length >= limit * 4) break
    }
    if (exact.length + out.length >= limit * 4) break
  }
  // 完全匹配排前,其余按名称长度(越短越贴近查询)
  out.sort((a, b) => a.name.length - b.name.length)
  return [...exact, ...out].slice(0, limit)
}

/** 某文件已索引的符号(按文件内出现顺序),未索引返回 null */
export function fileSymbols(path: string): SymbolHit[] | null {
  const idx = fileIdxByPath.get(path)
  if (idx === undefined) return null
  const list = symsByFile.get(idx)
  if (!list) return null
  const out: SymbolHit[] = []
  for (const at of list) {
    const hit = hitAt(at)
    if (hit) out.push(hit)
  }
  return out
}

/** 索引中记录的该文件降级原因(超大 / 解析失败) */
export function fileSkipReason(path: string): 'too-large' | 'error' | undefined {
  const idx = fileIdxByPath.get(path)
  return idx === undefined ? undefined : fileSkip[idx]
}

/** 索引中记录的文件指纹(用于就地重抽判定) */
export function fileFingerprint(path: string): { size: number; lastModified: number } | null {
  const idx = fileIdxByPath.get(path)
  return idx === undefined ? null : fileMeta[idx]
}

/**
 * 取某文件的符号:索引命中且指纹一致直接返回;否则就地抽取并写回索引。
 * 大纲、单文件模式与"外部修改后重新预览"共用这一条路径(任务 8b.4 / 9.4)。
 */
export async function ensureFileSymbols(
  path: string,
  handle: FileSource,
  langId: string,
): Promise<{ symbols: SymbolHit[]; skipped?: 'too-large' | 'error' }> {
  const cached = fileSymbols(path)
  const fp = fileFingerprint(path)
  if (cached && fp) {
    try {
      const file = await readSourceFile(handle)
      if (file.size === fp.size && file.lastModified === fp.lastModified) {
        // 降级原因必须一并返回,否则大纲会把"文件过大未索引"错显成"未发现定义"
        return { symbols: cached, skipped: fileSkipReason(path) }
      }
    } catch {
      return { symbols: cached, skipped: fileSkipReason(path) }
    }
  }
  const result = await extractOne({ path, handle, langId })
  if (!result) return { symbols: [] }
  // 项目模式下写回索引,使后续跳转/符号搜索也反映最新内容。
  //
  // **但被排除目录内的文件不能写回** —— 否则"可浏览但不被索引"会从这条路漏掉:
  // 用户只要预览一次依赖包里的文件,它的符号就进了项目索引,之后能被符号搜索命中。
  // design 里"树与索引是两条独立遍历所以免费"的推理只覆盖了**遍历**,
  // 而这里是第三条写入路径(按需抽取 + 就地重抽),它绕过了遍历。
  if (indexState.value !== 'idle' && !isInExcludedRelPath(path)) {
    ingest([result])
  }
  const idx = fileIdxByPath.get(path)
  if (idx !== undefined) {
    return { symbols: fileSymbols(path) ?? [], skipped: result.skipped ?? fileSkipReason(path) }
  }
  // 单文件模式(无项目索引):直接把抽取结果映射为查询形状
  return {
    symbols: result.symbols.map((s) => ({
      name: s.name, kind: s.kind, line: s.line, container: s.container, path, level: s.level ?? 0,
    })),
    skipped: result.skipped,
  }
}

/** 项目切换 / 目录树刷新:推进全局代次,使所有在途任务与回包作废 */
export function invalidateAll(): number {
  return nextGeneration()
}

export function currentGeneration(): number {
  return generation()
}

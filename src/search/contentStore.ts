import { signal } from '@preact/signals'
import { allFileHandles } from '../intel/indexStore'
import { WorkerPool } from '../intel/pool'
import type { GrepHit, WorkerTask } from '../intel/symbolWorker'

// 全文内容搜索(content-search spec / design.md D4)。
//
// 复用符号 Worker 池的 `grep` 任务类型:解码、二进制嗅探、逐行匹配全在 Worker 内完成,
// 主线程只汇总与去重上限。**不缓存正文**(design.md D4):全文搜索是低频操作,
// 22 MB 级的正文常驻内存会与符号索引叠加,重新读盘可接受。
//
// 取消与 references 同构:每次查询持有自己的 runId,丢弃旧池即取消;
// 池同时捕获全局代次,所以切项目 / 刷新目录树也会把它一起作废。

/** 总命中上限(spec 默认 2,000);单文件上限 50 由 Worker 侧把关 */
export const CONTENT_LIMIT = 2000
/** 少于该长度不启动全项目扫描 */
export const MIN_QUERY = 2

export type ContentStatus = 'idle' | 'too-short' | 'scanning' | 'done' | 'cancelled' | 'truncated'

export const contentQuery = signal('')
export const contentHits = signal<GrepHit[]>([])
export const contentStatus = signal<ContentStatus>('idle')
export const contentScanned = signal(0)
export const contentTotal = signal(0)
export const contentPanelOpen = signal(false)
export const caseSensitive = signal(false)

let pool: WorkerPool | null = null
let runId = 0

/** 取消在途搜索(新查询 / 切大小写 / 关面板 / 刷新目录树 / 切项目) */
export function cancelContentSearch(markCancelled = false): void {
  runId++
  pool?.dispose()
  pool = null
  if (markCancelled && contentStatus.value === 'scanning') contentStatus.value = 'cancelled'
}

export function closeContentSearch(): void {
  cancelContentSearch()
  contentPanelOpen.value = false
  contentHits.value = []
  contentStatus.value = 'idle'
  contentScanned.value = 0
  contentTotal.value = 0
  contentQuery.value = ''
}

export function runContentSearch(query: string): void {
  cancelContentSearch()
  const myRun = ++runId
  const q = query
  contentQuery.value = q
  contentHits.value = []
  contentScanned.value = 0
  contentPanelOpen.value = true

  if (q.trim().length < MIN_QUERY) {
    // 关键词过短:不启动全项目扫描,只给提示
    contentStatus.value = 'too-short'
    contentTotal.value = 0
    return
  }

  const tasks: WorkerTask[] = []
  for (const [path, handle] of allFileHandles()) {
    tasks.push({ path, handle, langId: '' })
  }
  contentTotal.value = tasks.length
  contentStatus.value = 'scanning'

  const cs = caseSensitive.value
  pool = new WorkerPool({
    request: (chunk) => ({ type: 'grep', query: q, caseSensitive: cs, tasks: chunk }),
    onMessage: (data) => {
      if (myRun !== runId || data.type !== 'grep') return
      const d = data as unknown as { results?: GrepHit[]; scanned?: number }
      if (d.scanned) contentScanned.value += d.scanned
      const batch = d.results ?? []
      if (batch.length > 0 && contentStatus.value === 'scanning') {
        const merged = [...contentHits.value, ...batch]
        if (merged.length >= CONTENT_LIMIT) {
          contentHits.value = merged.slice(0, CONTENT_LIMIT)
          contentStatus.value = 'truncated'
          cancelContentSearch()
          return
        }
        contentHits.value = merged
      }
    },
    onDone: () => {
      if (myRun !== runId) return
      if (contentStatus.value === 'scanning') contentStatus.value = 'done'
    },
    onError: () => {
      if (myRun !== runId) return
      if (contentStatus.value === 'scanning') contentStatus.value = 'done'
    },
  })
  pool.push(tasks)
  pool.end()
}

/** 切换大小写开关:重新执行当前查询(spec 要求) */
export function toggleCaseSensitive(): void {
  caseSensitive.value = !caseSensitive.value
  if (contentQuery.value) runContentSearch(contentQuery.value)
}

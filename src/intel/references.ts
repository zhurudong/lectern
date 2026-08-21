import { signal } from '@preact/signals'
import { intelCandidateFiles } from './indexStore'
import { WorkerPool } from './pool'
import type { RefHit } from './symbolWorker'

// 查找引用(code-intelligence spec「查找引用」/ design.md D3):
// **按需扫描,不建反向索引** —— 反向索引要存所有标识符出现位置(10k 项目里数百万条),
// 而查找引用是低频操作,用构建期换查询期不划算。
//
// 取消不走全局 generation:那个代次是索引的失效标记,搜索一次就 ++ 会把符号索引一起作废。
// 这里改为"丢弃旧的扫描池 + 各自的 runId 判定",可见行为(过期结果不混排、切项目即停)不变。

/** 命中数上限(spec 默认 1,000) */
export const REF_LIMIT = 1000
/** 扫描文件数预算:超出即截断,避免超大项目里一次引用查找无限扫下去 */
const SCAN_BUDGET = 20_000

export type RefStatus = 'idle' | 'scanning' | 'done' | 'truncated' | 'cancelled'

export const refName = signal('')
export const refHits = signal<RefHit[]>([])
export const refStatus = signal<RefStatus>('idle')
export const refScanned = signal(0)
export const refPanelOpen = signal(false)

let pool: WorkerPool | null = null
let runId = 0

/** 取消在途扫描(新查询 / 关面板 / 切项目 / 刷新目录树) */
export function cancelReferences(markCancelled = false): void {
  runId++
  pool?.dispose()
  pool = null
  if (markCancelled && refStatus.value === 'scanning') refStatus.value = 'cancelled'
}

export function closeReferences(): void {
  cancelReferences()
  refPanelOpen.value = false
  refHits.value = []
  refStatus.value = 'idle'
  refScanned.value = 0
  refName.value = ''
}

export async function findReferences(name: string): Promise<void> {
  cancelReferences()
  const myRun = ++runId

  const candidates = intelCandidateFiles()
  refName.value = name
  refHits.value = []
  refScanned.value = 0
  refStatus.value = 'scanning'
  refPanelOpen.value = true

  const budgeted = candidates.slice(0, SCAN_BUDGET)
  const overBudget = candidates.length > SCAN_BUDGET

  pool = new WorkerPool({
    request: (tasks) => ({ type: 'references', name, tasks }),
    onMessage: (data) => {
      if (myRun !== runId) return
      if (data.type !== 'refs') return
      const batch = (data.results ?? []) as RefHit[]
      if (batch.length > 0 && refStatus.value === 'scanning') {
        const merged = [...refHits.value, ...batch]
        if (merged.length >= REF_LIMIT) {
          refHits.value = merged.slice(0, REF_LIMIT)
          refStatus.value = 'truncated'
          cancelReferences()
          return
        }
        refHits.value = merged
      }
      if (data.done) refScanned.value += 1
    },
    onDone: () => {
      if (myRun !== runId) return
      if (refStatus.value === 'scanning') {
        refStatus.value = overBudget ? 'truncated' : 'done'
      }
    },
    onError: () => {
      if (myRun !== runId) return
      if (refStatus.value === 'scanning') refStatus.value = 'done'
    },
  })
  pool.push(budgeted)
  pool.end()
}

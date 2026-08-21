import { signal } from '@preact/signals'
import { generation, nextGeneration } from '../lib/generation'
import { beginIndex, clearIndex, endFeed, feedFiles } from '../intel/indexStore'

// 文件名搜索索引(file-tree spec"文件名快速搜索"):
// Worker 后台建 "相对路径" 索引;主线程按文件名子串匹配(不区分大小写)。
//
// 代次机制(design.md D2):改用 lib/generation 的**全局**代次 —— 文件名索引、
// 符号索引、全文搜索共用同一个失效标记,刷新目录树 / 切换项目时一次 ++ 全部作废,
// 不再出现三套各自漂移的失效逻辑。
//
// 同一次遍历同时驱动两件事:回传路径供 ⌘K 匹配,回传句柄供符号索引抽取(不再走第二遍全树)。

export const indexPaths = signal<string[]>([])
export const indexing = signal(false)
export const indexDone = signal(false)

let worker: Worker | null = null

export function startIndex(root: FileSystemDirectoryHandle): void {
  stopIndex()
  const myGen = nextGeneration()
  indexPaths.value = []
  indexing.value = true
  indexDone.value = false
  beginIndex()
  worker = new Worker(new URL('./indexWorker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (
    e: MessageEvent<{ type: string; token: number; paths?: string[]; handles?: FileSystemFileHandle[] }>,
  ) => {
    if (e.data.token !== myGen) return
    if (e.data.type === 'batch' && e.data.paths) {
      indexPaths.value = [...indexPaths.value, ...e.data.paths]
      feedFiles(e.data.paths, e.data.handles ?? [])
    } else if (e.data.type === 'done') {
      indexing.value = false
      indexDone.value = true
      endFeed()
    } else if (e.data.type === 'error') {
      indexing.value = false
      endFeed()
    }
  }
  worker.postMessage({ type: 'index', root, token: myGen })
}

export function stopIndex(): void {
  nextGeneration() // 使在途回包全部过期(文件名 + 符号 + 全文共用)
  worker?.terminate()
  worker = null
  clearIndex()
  indexPaths.value = []
  indexing.value = false
  indexDone.value = false
}

/** 当前代次(供其他索引/搜索模块判定回包是否过期) */
export function currentGeneration(): number {
  return generation()
}

/** 文件名子串匹配(不区分大小写),返回相对路径,cap 限制结果数 */
export function searchFiles(query: string, limit = 50): string[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const out: string[] = []
  for (const path of indexPaths.value) {
    const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase()
    if (name.includes(q)) {
      out.push(path)
      if (out.length >= limit) break
    }
  }
  return out
}

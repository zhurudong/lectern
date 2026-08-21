import { generation } from '../lib/generation'
import type { FileSymbols, WorkerTask } from './symbolWorker'

// Worker 池(design.md D2):N = min(4, max(1, hardwareConcurrency - 1))。
// 任务按"块"派发,Worker 空闲即领下一块;队列可在遍历进行中持续追加
// (文件名索引是分批到达的,不必等全树遍历完才开始抽取)。
//
// 池是**通用**的:符号抽取、查找引用、全文搜索都复用同一个 `symbolWorker` 入口 ——
// 那份 Worker chunk 里带着五套 Lezer 语法(约 345 KB),再开第二个 Worker 文件会把它整份复制一遍。
// 差异只体现在 `request()` 构造的消息类型上。

const CHUNK = 200

export const POOL_SIZE = Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 2) - 1))

export interface PoolMessage {
  type: string
  generation: number
  results?: unknown[]
  done?: boolean
}

export interface PoolOptions {
  /** 由一块任务构造发给 Worker 的消息(不含 generation,池会补上) */
  request: (tasks: WorkerTask[]) => Record<string, unknown>
  /** 代次匹配的回包;每块处理完时 done 为 true */
  onMessage: (data: PoolMessage) => void
  /** 队列排空且已声明无后续输入 */
  onDone: () => void
  /** Worker 异常终止(spec「索引任务失败降级」) */
  onError: (message: string) => void
  size?: number
}

function spawn(): Worker {
  return new Worker(new URL('./symbolWorker.ts', import.meta.url), { type: 'module' })
}

/**
 * 索引暂停开关(仅 dev 构建的测试钩子会拨动它)。
 *
 * 为什么需要它:"索引仍在构建中" 这条提示分支的自然触发窗口只有 2 秒,
 * 写成断言就是靠 sleep 抢窗口的竞态 —— 那种断言比没有更糟。
 * 把它做成可暂停的,验收就从"抢时间窗"变成确定性流程:暂停 → 断言提示 → 恢复 → 断言正常。
 */
let indexPaused = false
const livePools = new Set<WorkerPool>()

export function __setIndexPaused(v: boolean): void {
  indexPaused = v
  if (!v) for (const p of livePools) p.resume()
}

export class WorkerPool {
  private workers: Worker[] = []
  private idle: Worker[] = []
  private queue: WorkerTask[] = []
  private inFlight = 0
  private ended = false
  private disposed = false
  /** 构造时的全局代次:切项目 / 刷新目录树后本池的一切回包作废 */
  private readonly gen: number

  constructor(private opts: PoolOptions) {
    this.gen = generation()
    const size = opts.size ?? POOL_SIZE
    for (let i = 0; i < size; i++) {
      const w = spawn()
      w.onmessage = (e: MessageEvent<PoolMessage>) => {
        if (this.disposed || e.data.generation !== this.gen) return
        this.opts.onMessage(e.data)
        if (e.data.done) {
          this.inFlight--
          this.idle.push(w)
          this.pump()
        }
      }
      w.onerror = (ev) => {
        if (this.disposed) return
        this.opts.onError(ev.message || 'Worker 异常终止')
      }
      this.workers.push(w)
      this.idle.push(w)
    }
    livePools.add(this)
  }

  /** 暂停解除后由 __setIndexPaused 调用 */
  resume(): void {
    this.pump()
  }

  /** 追加待处理文件(可在遍历进行中多次调用) */
  push(tasks: WorkerTask[]): void {
    if (this.disposed || this.ended) return
    this.queue.push(...tasks)
    this.pump()
  }

  /** 声明无后续输入;队列排空后触发 onDone */
  end(): void {
    if (this.disposed) return
    this.ended = true
    this.pump()
  }

  private pump(): void {
    if (this.disposed) return
    // 暂停只卡在**派发边界**:已派发的块跑完,新块不再下发
    if (indexPaused) return
    while (this.idle.length > 0 && this.queue.length > 0) {
      const w = this.idle.pop()!
      const chunk = this.queue.splice(0, CHUNK)
      this.inFlight++
      w.postMessage({ ...this.opts.request(chunk), generation: this.gen })
    }
    if (this.ended && this.queue.length === 0 && this.inFlight === 0) {
      this.opts.onDone()
    }
  }

  /** 停止收录(达上限时):清空队列,已派发的块跑完即止 */
  drain(): void {
    this.queue = []
  }

  get pending(): number {
    return this.queue.length + this.inFlight
  }

  dispose(): void {
    this.disposed = true
    livePools.delete(this)
    this.queue = []
    for (const w of this.workers) w.terminate()
    this.workers = []
    this.idle = []
  }
}

// —— 单文件按需抽取(大纲 / 单文件模式 / 指纹失配后就地重抽) ——
// 复用同一个 symbolWorker 与同一套抽取代码(任务 8b.4:不新增第二条代码路径)。

/** 单文件抽取的暂停开关(仅 dev 构建的测试钩子会拨动),用于确定性地断言"解析中"分支 */
let extractPaused = false
let extractGate: Promise<void> = Promise.resolve()
let releaseGate: (() => void) | null = null

export function __setExtractPaused(v: boolean): void {
  if (v === extractPaused) return
  extractPaused = v
  if (v) extractGate = new Promise<void>((r) => { releaseGate = r })
  else { releaseGate?.(); releaseGate = null; extractGate = Promise.resolve() }
}

let adhoc: Worker | null = null
/** 串行化:symbolWorker 的 onmessage 是 async 的,并发请求会在 await 处交错、
 *  导致回包与请求对不上。这里用一条 promise 链保证同一时刻只有一个在途请求。 */
let adhocChain: Promise<unknown> = Promise.resolve()

export function extractOne(task: WorkerTask): Promise<FileSymbols | null> {
  const run = async () => {
    if (extractPaused) await extractGate
    return new Promise<FileSymbols | null>((resolve) => {
      if (!adhoc) adhoc = spawn()
      const worker = adhoc
      const onMessage = (e: MessageEvent<{ type: string; results?: FileSymbols[]; done?: boolean }>) => {
        if (e.data.type !== 'batch' || !e.data.done) return
        worker.removeEventListener('message', onMessage)
        resolve(e.data.results?.[0] ?? null)
      }
      worker.addEventListener('message', onMessage)
      worker.postMessage({ type: 'extract', generation: -1, tasks: [task] })
    })
  }
  const next = adhocChain.then(run, run)
  adhocChain = next
  return next
}

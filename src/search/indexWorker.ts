// 文件名索引 Web Worker(design.md D4 / D2):
// 接收目录句柄(句柄可结构化克隆传入 Worker),后台增量遍历全树,
// 分批回传 "相对路径" 列表,不阻塞主线程首屏与目录树交互。
//
// design.md D2「遍历只做一次」:除相对路径外一并回传文件句柄,
// 主线程按语言过滤后直接派进符号 Worker 池,避免为符号索引再走一遍全树。
// paths 字段与回包格式保持不变(现有 ⌘K 不受影响),handles 为并列新增字段。

import { isExcludedDirName } from '../lib/excluded'

interface IndexRequest {
  type: 'index'
  root: FileSystemDirectoryHandle
  /** 代次标记:主线程用它丢弃过期回包(刷新/切换项目后) */
  token: number
}

const BATCH = 500

self.onmessage = async (e: MessageEvent<IndexRequest>) => {
  const { root, token } = e.data
  if (e.data.type !== 'index') return
  let batch: string[] = []
  let handles: FileSystemFileHandle[] = []
  let total = 0

  const flush = () => {
    if (batch.length > 0) {
      self.postMessage({ type: 'batch', token, paths: batch, handles })
      batch = []
      handles = []
    }
  }

  const walk = async (dir: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind === 'file') {
        batch.push(prefix + name)
        handles.push(handle as FileSystemFileHandle)
        total++
        if (batch.length >= BATCH) flush()
      } else if (!isExcludedDirName(name)) {
        // 与目录树、符号派发共用 lib/excluded 的**同一个函数**,不各自维护名单
        await walk(handle as FileSystemDirectoryHandle, prefix + name + '/')
      }
    }
  }

  try {
    await walk(root, '')
    flush()
    self.postMessage({ type: 'done', token, total })
  } catch (err) {
    flush()
    self.postMessage({ type: 'error', token, message: String(err) })
  }
}

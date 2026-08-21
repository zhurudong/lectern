import { idbGetAll, idbPut, idbDelete, STORE_RECENT } from './idb'

// 最近项目列表:仅记录目录句柄(单文件不入列,见 project-access spec),
// 最多保留 MAX_RECENT 个,按最近打开时间排序。

export const MAX_RECENT = 10

export interface RecentProject {
  id: string
  name: string
  handle: FileSystemDirectoryHandle
  lastOpened: number
}

export async function listRecent(): Promise<RecentProject[]> {
  try {
    const all = await idbGetAll<RecentProject>(STORE_RECENT)
    return all.sort((a, b) => b.lastOpened - a.lastOpened)
  } catch {
    // IDB 不可用时静默降级为空列表,不阻塞打开流程
    return []
  }
}

/** 记录一次目录打开:同一目录去重(isSameEntry),超出上限淘汰最旧。 */
export async function addRecent(handle: FileSystemDirectoryHandle): Promise<void> {
  try {
    const all = await listRecent()
    let existing: RecentProject | undefined
    for (const rec of all) {
      try {
        if (await handle.isSameEntry(rec.handle)) {
          existing = rec
          break
        }
      } catch {
        // 句柄比较失败(如已失效)时当作不同条目
      }
    }
    const entry: RecentProject = {
      id: existing?.id ?? crypto.randomUUID(),
      name: handle.name,
      handle,
      lastOpened: Date.now(),
    }
    await idbPut(STORE_RECENT, entry)
    const rest = all.filter((r) => r.id !== entry.id)
    for (const stale of rest.slice(MAX_RECENT - 1)) {
      await idbDelete(STORE_RECENT, stale.id)
    }
  } catch {
    // 持久化失败不影响本次浏览
  }
}

export async function removeRecent(id: string): Promise<void> {
  try {
    await idbDelete(STORE_RECENT, id)
  } catch {
    /* 忽略 */
  }
}

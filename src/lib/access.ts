import { beginWorkspaceOpen, enterProject, enterSingleFile } from '../state'
import { addRecent, type RecentProject } from './recent'

// project-access 能力:打开目录/文件、最近项目重连与权限续期。
// 从用户手势(按钮点击或拖放)进入,满足 picker / requestPermission 的手势要求。

type LocalHandle = FileSystemDirectoryHandle | FileSystemFileHandle

/** picker、拖放共用打开流程;单文件不计入最近项目。 */
async function openHandle(handle: LocalHandle, isCurrent: () => boolean): Promise<void> {
  if (!isCurrent()) return
  if (handle.kind === 'directory') {
    await addRecent(handle)
    if (isCurrent()) enterProject(handle)
  } else {
    enterSingleFile(handle)
  }
}

/** 用户取消选择时 picker 抛 AbortError,按规格静默处理 */
function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}

export async function openFolder(): Promise<void> {
  const isCurrent = beginWorkspaceOpen()
  let handle: FileSystemDirectoryHandle
  try {
    // id 是持久化标识(Chrome 靠它记住"上次选的目录"),**改名时不要跟着改**:
    // 一改,用户下次打开又得从头翻目录树。同 idb.ts 的 DB_NAME,用户看不到这个字符串。
    handle = await window.showDirectoryPicker({ id: 'code-viewer-project', mode: 'read' })
  } catch (err) {
    if (isAbort(err)) return
    throw err
  }
  await openHandle(handle, isCurrent)
}

export async function openSingleFile(): Promise<void> {
  const isCurrent = beginWorkspaceOpen()
  let handle: FileSystemFileHandle
  try {
    // 同上:持久化标识,不随产品名变动
    const picked = await window.showOpenFilePicker({ id: 'code-viewer-file' })
    handle = picked[0]
    if (!handle) return
  } catch (err) {
    if (isAbort(err)) return
    throw err
  }
  await openHandle(handle, isCurrent)
}

/** 必须直接从 drop 回调调用:读取拖放句柄之前不能让出当前事件。 */
export async function openDroppedItems(data: DataTransfer): Promise<void> {
  const isCurrent = beginWorkspaceOpen()
  try {
    // 目录的 DataTransferItem.kind 也是 file,拿到 handle 后才能区分。
    const items = Array.from(data.items).filter((item) => item.kind === 'file')
    if (items.length !== 1) throw new Error('请每次拖入一个文件或文件夹。')
    const item = items[0]
    if (typeof item.getAsFileSystemHandle !== 'function') {
      throw new Error('当前浏览器无法通过拖放打开,请使用“打开文件夹”或“打开文件”。')
    }
    // 在任何 await 之前调用;否则浏览器会收回对拖放数据的访问。
    const pending = item.getAsFileSystemHandle()
    const handle = await pending
    if (!isCurrent()) return
    if (!handle) throw new Error('无法读取拖入的文件或文件夹,请重新拖入或使用打开按钮。')

    // 先确认可读再切换,失败时保留当前项目/预览。
    if (handle.kind === 'directory') await handle.keys().next()
    else await handle.getFile()
    await openHandle(handle, isCurrent)
  } catch (err) {
    if (!isCurrent()) return
    if (err instanceof DOMException) {
      throw new Error('无法访问拖入的文件或文件夹,请检查读取权限或使用打开按钮。')
    }
    throw err
  }
}

export type ReconnectResult = 'ok' | 'denied' | 'gone'

/**
 * 重连最近项目:先 queryPermission,需要时在用户手势内 requestPermission;
 * 授权通过后探测目录是否仍可读(已删除/移动的目录句柄权限可能仍显示 granted)。
 */
export async function reconnectRecent(rec: RecentProject): Promise<ReconnectResult> {
  const isCurrent = beginWorkspaceOpen()
  const desc = { mode: 'read' as const }
  let perm: PermissionState
  try {
    perm = await rec.handle.queryPermission(desc)
    if (perm !== 'granted') {
      perm = await rec.handle.requestPermission(desc)
    }
  } catch {
    return 'gone'
  }
  if (perm !== 'granted') return 'denied'

  try {
    // 探测一次目录读取,确认句柄背后的目录仍然存在
    await rec.handle.keys().next()
  } catch {
    return 'gone'
  }

  await openHandle(rec.handle, isCurrent)
  return 'ok'
}

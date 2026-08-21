import { enterProject, enterSingleFile } from '../state'
import { addRecent, type RecentProject } from './recent'

// project-access 能力:打开目录/文件、最近项目重连与权限续期。
// 全部在用户手势内调用(按钮点击),满足 requestPermission 的手势要求。

/** 用户取消选择时 picker 抛 AbortError,按规格静默处理 */
function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}

export async function openFolder(): Promise<void> {
  let handle: FileSystemDirectoryHandle
  try {
    // id 是持久化标识(Chrome 靠它记住"上次选的目录"),**改名时不要跟着改**:
    // 一改,用户下次打开又得从头翻目录树。同 idb.ts 的 DB_NAME,用户看不到这个字符串。
    handle = await window.showDirectoryPicker({ id: 'code-viewer-project', mode: 'read' })
  } catch (err) {
    if (isAbort(err)) return
    throw err
  }
  await addRecent(handle)
  enterProject(handle)
}

export async function openSingleFile(): Promise<void> {
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
  // 单文件不计入最近项目(见 project-access spec)
  enterSingleFile(handle)
}

export type ReconnectResult = 'ok' | 'denied' | 'gone'

/**
 * 重连最近项目:先 queryPermission,需要时在用户手势内 requestPermission;
 * 授权通过后探测目录是否仍可读(已删除/移动的目录句柄权限可能仍显示 granted)。
 */
export async function reconnectRecent(rec: RecentProject): Promise<ReconnectResult> {
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

  await addRecent(rec.handle)
  enterProject(rec.handle)
  return 'ok'
}

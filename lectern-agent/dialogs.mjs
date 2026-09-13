import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const exec = promisify(execFile)
// Arguments are passed as argv, never interpolated into AppleScript source.
async function dialog(source, args, signal) {
  if (process.platform !== 'darwin') throw new Error('Automatic pairing and folder selection currently require macOS')
  try {
    const { stdout } = await exec('/usr/bin/osascript', ['-e', source, ...args], { timeout: 120000, signal })
    return stdout.trim()
  } catch (error) {
    if (signal?.aborted || /\(-128\)|User canceled/.test(error.stderr ?? '')) return null
    throw error
  }
}
export const confirmPairing = async (origin, signal) => await dialog(`on run argv
  display dialog "Lectern 请求连接本机 AI 终端。\\n仅在你刚刚打开读码台 AI 终端时允许。\\n\\n扩展：" & item 1 of argv & "\\n\\n允许后，此扩展可按你的用户权限启动 Agent，读取和修改文件。" with title "Lectern 本机配对" buttons {"取消", "允许连接"} default button "取消" cancel button "取消" giving up after 120
  if gave up of result then return "cancel"
  return "allow"
end run`, [origin], signal) === 'allow'
export const chooseProject = (name, signal) => dialog(`on run argv
  set selectedFolder to choose folder with prompt ("为 Lectern 项目「" & item 1 of argv & "」选择同一个本机目录（仅首次需要）")
  return POSIX path of selectedFolder
end run`, [name], signal)

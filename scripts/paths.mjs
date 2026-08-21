// 脚本共用的路径与可执行文件解析(prep-open-source「可移植化」)。
//
// **这里是仓库里唯一一处推导仓库根的地方。** 五个脚本曾各自写死
// `/Users/<name>/Documents/coding-viewer` —— 那在别人机器上第一行就跑不过,
// 而这类失败看起来像"环境问题",很难归因到脚本本身。
//
// 为什么不是"每个脚本各写一次自推导":同一个模式抄五份,
// 下次改目录结构就要改五处,而**漏掉的那处不会报错,只会在别人机器上炸**。
// 根因不是"漏了五个文件",是把可移植化当成了一次修改而不是一条性质。
import { existsSync } from 'node:fs'
import { platform } from 'node:os'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 本文件所在目录,即 `scripts/`(截图等产物也落在这里) */
export const SCRIPTS = dirname(fileURLToPath(import.meta.url))

/** 仓库根:由本文件位置上溯一级 */
export const PROJECT = dirname(SCRIPTS)

const CHROME_DEFAULTS = {
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
  linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'],
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ],
}

/**
 * Chrome 可执行文件:环境变量 `CHROME` 优先,其次按平台探测。
 * 找不到时**明确报错并给出下一步**,不静默继续 ——
 * puppeteer 在可执行文件不存在时抛的错不会告诉你"设 CHROME 环境变量"。
 */
export function resolveChrome() {
  const found = process.env.CHROME ?? (CHROME_DEFAULTS[platform()] ?? []).find((p) => existsSync(p))
  if (!found || !existsSync(found)) {
    console.error(
      `找不到 Chrome 可执行文件${found ? `:${found}` : `(平台 ${platform()})`}。\n` +
        '请设置环境变量后重试,例如:CHROME="/path/to/chrome" node scripts/<脚本>.mjs',
    )
    process.exit(1)
  }
  return found
}

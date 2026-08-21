import { signal } from '@preact/signals'
import { caretLine, gotoLine, navigateTo, rootHandle, selectedFile, viewportLine } from '../state'
import { resolveFile } from '../lib/resolve'
import { focusEditorWhenReady } from '../lib/focusEditor'
import { revealPath } from '../tree/treeStore'

// 阅读导航栈(code-intelligence spec「导航栈与前进后退」)。
//
// **界面上的后退/前进按钮是主入口**,`⌥←`/`⌥→` 只是 macOS 上的补充键位 ——
// Windows/Linux 的 `Alt+←/→` 是浏览器前进后退的默认绑定,按保守假定不绑定也不提示。
//
// 栈里存的是"路径 + 行"而非句柄:后退时重新解析句柄,与既有的"点击即重读、不展示过期缓存"一致。

interface NavEntry {
  path: string
  line: number
}

let stack: NavEntry[] = []
let cursor = -1

export const canGoBack = signal(false)
export const canGoForward = signal(false)

/**
 * 记录最近一次导航键位的处理结果,供 E2E 断言处理器确实调用了 `preventDefault`。
 * **注意验收边界**:CDP 合成按键只进渲染进程、不触发浏览器 UI,所以这只能证明
 * "我们调了 preventDefault",**证明不了浏览器有没有被拦住** —— 后者只能真机核验(任务 12.3)。
 */
export const lastNavKey = { key: '', defaultPrevented: false }

function sync(): void {
  canGoBack.value = cursor > 0
  canGoForward.value = cursor >= 0 && cursor < stack.length - 1
}

function currentEntry(fromLine?: number): NavEntry | null {
  const cur = selectedFile.value
  if (!cur) return null
  // "离开时的位置"取 **caret 行**,没有 caret 才退回视口顶行(2.8)。
  //
  // 为什么不一律用视口顶行:用户的心智锚点是"我刚才在读哪一行",那是光标;
  // 而视口顶行只是滚动的副产物 —— 后退回到视口顶行,常常回到目标上方十几行。
  // 为什么保留视口顶行兜底:用户可能只是滚动浏览、从未把光标放到哪儿,
  // 那时没有有意义的 caret,视口顶行才是他"刚才在看"的最好近似。
  //
  // **这条与去程是两套机制**:去程靠各入口传 caret 线索,回程靠这里记录 ——
  // 只接去程会让"回来"落在文件开头或视口顶行,而那不是用户离开的地方。
  const line = fromLine ?? (caretLine.value > 0 ? caretLine.value : viewportLine.value)
  return { path: cur.path.join('/'), line }
}

/** 打开"路径 + 行";单文件模式下只允许本文件内定位 */
type Caret = { word?: string; col?: number }

async function openTarget(path: string, line: number, caret?: Caret): Promise<boolean> {
  const root = rootHandle.value
  const cur = selectedFile.value
  if (!root) {
    if (cur && cur.path.join('/') === path) {
      gotoLine(line, caret)
      return true
    }
    return false
  }
  const resolved = await resolveFile(root, [], path)
  if (!resolved) return false
  navigateTo(resolved.handle, resolved.path, line, caret)
  void revealPath(resolved.path)
  return true
}

/**
 * 统一的"记录当前位置 → 跳到目标"通道(任务 6.9)。
 * 跳转到定义、引用结果、大纲、符号搜索、全文搜索结果全部走这里。
 * fromLine 为触发跳转时所在行(如 ⌘+点击的那一行);缺省用视口顶部行。
 */
// 诊断用(dev-only):导航栈的实际内容。
// 回程落点不对时,"栈里记的是什么"是唯一能分清"记错了"与"回错了"的证据。
if (__CV_TEST_HOOK__) {
  ;(window as unknown as { __cvNavStack?: () => unknown }).__cvNavStack = () => ({
    stack: stack.map((e) => `${e.path}@${e.line}`),
    cursor,
  })
}

export async function navigateWithHistory(
  targetPath: string,
  targetLine: number,
  fromLine?: number,
  /**
   * caret 落点线索:让 caret 停在**目标符号**上,而不只是目标行。
   * 各入口把自己已经知道的信息传进来(符号名 / 命中列),不另开通道。
   */
  caret?: Caret,
): Promise<boolean> {
  const from = currentEntry(fromLine)
  if (from) {
    // 栈为空时先把当前位置作为起点;否则刷新当前条目的行(用户可能已滚动过)
    if (cursor < 0) {
      stack = [from]
      cursor = 0
    } else {
      stack[cursor] = from
    }
  }
  const ok = await openTarget(targetPath, targetLine, caret)
  if (!ok) return false
  stack = stack.slice(0, cursor + 1)
  stack.push({ path: targetPath, line: targetLine })
  cursor = stack.length - 1
  sync()
  return true
}

/** 后退:栈端点处无操作、不报错、不清空当前预览 */
export async function goBack(): Promise<void> {
  if (cursor <= 0) return
  // 先记住当前条目的最新行,再后退
  const from = currentEntry()
  if (from) stack[cursor] = from
  cursor--
  const entry = stack[cursor]
  await openTarget(entry.path, entry.line)
  // 回程也要把焦点交回代码区:**到达了但不能就地继续,等于没到**。
  // 去程四个资源(视图/标识/焦点/caret)都接了,回程原先只接了 caret 一半 ——
  // 用户回来之后按 ↓ 不动,因为焦点掉在 body 上。
  focusEditorWhenReady()
  sync()
}

/** 前进 */
export async function goForward(): Promise<void> {
  if (cursor < 0 || cursor >= stack.length - 1) return
  const from = currentEntry()
  if (from) stack[cursor] = from
  cursor++
  const entry = stack[cursor]
  await openTarget(entry.path, entry.line)
  focusEditorWhenReady() // 同 goBack
  sync()
}

/** 切换项目 / 回到首页:清空导航历史 */
export function clearNavStack(): void {
  stack = []
  cursor = -1
  sync()
}

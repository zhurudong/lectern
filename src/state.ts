import { signal } from '@preact/signals'

// 全局应用状态:保持极简(见 design.md D5),不引入重状态库。

/** 应用模式:欢迎页 / 项目浏览(有目录树) / 单文件预览(无目录树) */
export type AppMode = 'welcome' | 'project' | 'single'

/** 当前选中待预览的文件 */
export interface SelectedFile {
  handle: FileSystemFileHandle
  /** 相对项目根的路径段(单文件模式为 [文件名]) */
  path: string[]
  name: string
  /** 单调递增,用于强制重读(点击即重读,不缓存) */
  nonce: number
}

/**
 * 按行定位请求(file-preview spec「按行定位与高亮」)。
 * 与 selectedFile 分开,是为了让"当前文件内定位"能只滚动、不触发重读:
 * Preview 只订阅 selectedFile.nonce,CodeView 单独订阅本信号。
 * seq 保证连续两次定位到同一行也能触发。
 */
/**
 * `word` / `col`:caret 的落点线索(fix-navigation-caret-landing)。
 *
 * 只滚动 + 高亮是不够的 —— **到达之后必须能就地继续**:caret 不跟过去,
 * 用户按 `↓` 是在文件开头挪,按 `⌘⇧↩` 查的是错误位置的引用。
 * `word` 让 caret 落在**目标符号上**而不是行首:行首往往是缩进或 `func` 这类关键字,
 * 落在那里会让"查引用"查到一个与用户意图无关的词。
 */
export const targetLine = signal<
  { line: number; seq: number; word?: string; col?: number } | null
>(null)

let lineSeq = 0

/**
 * 预览区当前视口顶部行号(1-based),由 CodeView 更新。
 * 导航栈用它记录"跳出行":用户在某处触发跳转后,后退应回到那一处而不是文件开头。
 */
export const viewportLine = signal(1)

/**
 * 当前 caret 所在行(1-based;0 表示尚不可知)。
 *
 * 导航栈用它记录"离开时的位置":**用户"我刚才在读哪儿"的锚点是光标,不是视口顶行**。
 * 但用户也可能只是滚动浏览、从没把光标放到哪儿 —— 那时没有有意义的 caret,
 * 退回视口顶行才对。所以取值规则是"**有 caret 用 caret,没有则退回视口顶行**"。
 */
export const caretLine = signal(0)

/** 在当前已打开文件内定位到某行(不重读文件) */
export function gotoLine(line: number, caret?: { word?: string; col?: number }): void {
  targetLine.value = { line, seq: ++lineSeq, word: caret?.word, col: caret?.col }
}

export const mode = signal<AppMode>('welcome')
export const rootHandle = signal<FileSystemDirectoryHandle | null>(null)
export const rootName = signal('')
export const selectedFile = signal<SelectedFile | null>(null)

let selectNonce = 0

/** 选中一个文件用于预览;每次调用都会触发重新读取(不缓存) */
export function selectFile(
  handle: FileSystemFileHandle,
  path: string[],
  line?: number,
  caret?: { word?: string; col?: number },
) {
  selectedFile.value = { handle, path, name: path[path.length - 1] ?? handle.name, nonce: ++selectNonce }
  caretLine.value = 0 // 换文件:上一个文件的 caret 行对新文件没有意义
  targetLine.value =
    line == null ? null : { line, seq: ++lineSeq, word: caret?.word, col: caret?.col }
}

/**
 * 统一的"打开文件 + 定位行"通道(任务 6.9):
 * 大纲、符号搜索、跳转到定义、查找引用、全文搜索结果全部走这里。
 * 目标就是当前文件时只滚动、不重读(spec 要求"不出现内容闪烁")。
 */
export function navigateTo(
  handle: FileSystemFileHandle,
  path: string[],
  line?: number,
  caret?: { word?: string; col?: number },
): void {
  const cur = selectedFile.value
  if (cur && cur.path.join('/') === path.join('/')) {
    if (line != null) gotoLine(line, caret)
    return
  }
  selectFile(handle, path, line, caret)
}

/** 进入项目浏览模式 */
export function enterProject(handle: FileSystemDirectoryHandle) {
  rootHandle.value = handle
  rootName.value = handle.name
  selectedFile.value = null
  mode.value = 'project'
}

/** 进入单文件模式 */
export function enterSingleFile(handle: FileSystemFileHandle) {
  rootHandle.value = null
  rootName.value = ''
  mode.value = 'single'
  selectFile(handle, [handle.name])
}

/** 回到欢迎页 */
export function goWelcome() {
  rootHandle.value = null
  rootName.value = ''
  selectedFile.value = null
  targetLine.value = null
  mode.value = 'welcome'
}

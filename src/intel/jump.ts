import { signal } from '@preact/signals'
import { mode, selectedFile } from '../state'
import { activeFileParsing, activeFileSymbols, indexState, lookupDefinitions, type SymbolHit } from './indexStore'
import { KIND, isOutlineOnlyKind } from './symbols'
import { navigateWithHistory } from './navStack'
import { focusEditorWhenReady } from '../lib/focusEditor'

// 跳转到定义(code-intelligence spec「跳转到定义」)。
//
// 启发式:只按符号名 + 语法树抽取的定义位匹配,不做类型推断 / 作用域解析 / 导入解析 / 宏展开。
// 同名多候选时**必须给列表让用户选**,MUST NOT 静默跳到其中任意一个。

/** 一次性提示(找不到定义 / 索引未就绪 / 单文件模式越界) */
export const jumpNotice = signal<string | null>(null)

/**
 * 预览区右键菜单(**跳转与查找引用的主入口之一,不依赖任何浏览器保留键**)。
 * F12 是 Chrome DevTools 的浏览器级保留键,页面拦不住,所以只能是可选补充键位。
 */
export const contextMenu = signal<{ x: number; y: number; word: string; line: number } | null>(null)

export function openContextMenu(x: number, y: number, word: string, line: number): void {
  contextMenu.value = { x, y, word, line }
}

export function closeContextMenu(): void {
  contextMenu.value = null
}

/** 多候选列表;null 表示未打开 */
export const candidateList = signal<{ name: string; hits: SymbolHit[]; fromLine?: number } | null>(null)

let noticeTimer: ReturnType<typeof setTimeout> | null = null

export function showNotice(text: string): void {
  jumpNotice.value = text
  if (noticeTimer) clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => {
    jumpNotice.value = null
  }, 4000)
}

export function dismissNotice(): void {
  if (noticeTimer) clearTimeout(noticeTimer)
  jumpNotice.value = null
}

export function closeCandidates(): void {
  candidateList.value = null
}

/** 候选排序:定义 > 声明,再按 同文件 > 同目录 > 其余(spec 要求的启发式优先级) */
function rankCandidates(hits: SymbolHit[], fromPath: string): SymbolHit[] {
  const dirOf = (p: string) => p.slice(0, p.lastIndexOf('/') + 1)
  const fromDir = dirOf(fromPath)
  const declScore = (h: SymbolHit) => (h.kind === KIND.declaration ? 1 : 0)
  const placeScore = (h: SymbolHit) => (h.path === fromPath ? 0 : dirOf(h.path) === fromDir ? 1 : 2)
  return [...hits].sort(
    (a, b) =>
      declScore(a) - declScore(b) ||
      placeScore(a) - placeScore(b) ||
      a.path.localeCompare(b.path) ||
      a.line - b.line,
  )
}

/**
 * 对某个标识符触发跳转。
 * fromLine 是触发处所在行,用于导航栈记录"跳出行"。
 */
export async function jumpToDefinition(name: string, fromLine?: number): Promise<void> {
  dismissNotice()
  closeCandidates()
  const trimmed = name.trim()
  if (!trimmed) return

  const cur = selectedFile.value
  const fromPath = cur ? cur.path.join('/') : ''
  const single = mode.value === 'single'

  // 两种模式**只差候选来源**,判定逻辑必须完全一致:
  // spec 要求"同一个文件、同一个标识符,单文件模式与项目模式的跳转行为 SHALL 一致,
  // 用户 MUST NOT 因为换了打开方式而得到不同结果"。所以下面不再分叉。
  //
  // 单文件模式复用大纲已抽取的结果(同一套抽取代码);按小写比较以对齐项目模式的
  // `byLowerName` 语义,并排除仅大纲条目(它不参与跳转与引用)。
  const hits = definitionsFor(trimmed)

  if (hits.length === 0) {
    showNotice(
      single
        ? activeFileParsing.value
          ? '文件符号仍在解析中,可稍后重试'
          : '单文件模式下仅支持文件内跳转,打开所在文件夹可获得跨文件跳转'
        : indexState.value === 'building'
          ? '符号索引仍在构建中,可稍后重试'
          : indexState.value === 'unavailable'
            ? '符号索引不可用,无法跳转'
            : `未在项目内找到 “${trimmed}” 的定义`,
    )
    return
  }

  // 定义优先:同一名字既有定义又有声明(C/C++ 的原型)且定义唯一时,直接跳定义。
  // 声明与定义指的是**同一个符号**,择其定义不构成"猜",不违背"不许静默猜一个"。
  const defs = hits.filter((h) => h.kind !== KIND.declaration)
  const primary = defs.length > 0 ? defs : hits
  if (primary.length === 1) {
    await navigateWithHistory(primary[0].path, primary[0].line, fromLine, { word: trimmed })
    // 跨文件跳转会让 CodeView 重挂,焦点随旧实例一起消失 ——
    // 用户从代码区跳出去,落地却不在代码区,按 ↓ / ⌘⇧↩ 都不生效。
    // **"到达之后必须可就地继续"**:焦点与 caret 一样要跟过去。
    focusEditorWhenReady()
    return
  }

  // 真多候选:只展示列表,等用户选择后才跳(MUST NOT 静默猜一个)。
  // 单文件模式同样适用 —— Java / C++ 的同名重载在同一个文件里是常态。
  candidateList.value = { name: trimmed, hits: rankCandidates(hits, fromPath), fromLine }
}

/**
 * **提示与跳转共用的唯一一条候选查询。**
 *
 * `add-jump-affordance` 要给"按住修饰键悬停"加可跳转提示,而提示必须与跳转**同源**:
 * 一旦提示自己查一遍、跳转再查一遍,两套查询迟早给出不同答案 —— 那时**提示会撒谎,
 * 而且没人会发现**:用户看到下划线、点下去没反应,他不会怀疑"提示错了",
 * 只会觉得这工具不稳。**一个会食言的提示,比没有提示更伤。**
 *
 * 所以模式分叉只留在这一个函数里(它决定"候选从哪来"),
 * `jumpToDefinition` 与提示都调用它,**MUST NOT 在别处再写一份 `mode === 'single' ? ... : ...`**。
 */
export function definitionsFor(name: string): SymbolHit[] {
  const trimmed = name.trim()
  if (!trimmed) return []
  return mode.value === 'single' ? localDefinitions(trimmed) : lookupDefinitions(trimmed)
}

/** 单文件模式的候选来源:当前文件已抽取的符号,语义对齐项目模式的 `lookupDefinitions` */
function localDefinitions(name: string): SymbolHit[] {
  const lower = name.toLowerCase()
  return activeFileSymbols.value.filter(
    (s) => !isOutlineOnlyKind(s.kind) && s.name.toLowerCase() === lower,
  )
}

/** 用户在候选列表中选定后才真正跳转 */
export async function pickCandidate(hit: SymbolHit): Promise<void> {
  const fromLine = candidateList.value?.fromLine
  closeCandidates()
  await navigateWithHistory(hit.path, hit.line, fromLine, { word: hit.name })
  focusEditorWhenReady()
}

// **键位定义的唯一一处。**(add-keyboard-first-navigation 3b.1)
//
// 实际绑定与界面标注**都从这里取**,MUST NOT 在右键菜单或帮助面板里另手写一份键位文本。
//
// 为什么这条值得单独立一个模块:两份各写一份,**改键位时界面会说谎,而说谎的那一刻
// 两边都不报错** —— 用户照着界面提示按键却没反应,他不会认为"标注过期了",
// 只会认为功能坏了。这与符号清单、语言清单是同一个形状,只是这次的两份副本
// 一份在代码里、一份在 UI 文案里。
//
// 展示文本是**算出来的**,不是另写的:`display()` 由同一个 CM6 key 串推导,
// 所以"同源"不是靠人记得同步,而是结构上只有一个来源。
import { isMac, verifiedShortcuts } from './platform'

/** 一条键盘操作。`key` 用 CM6 keymap 的写法(`Mod` = macOS ⌘ / 其它平台 Ctrl)。 */
export interface KeyDef {
  /** 面向用户的操作名 */
  readonly label: string
  /** CM6 keymap 键串;`null` 表示这条能力由**浏览器原生行为**提供(如 Tab 切面板) */
  readonly key: string | null
  /** 原生键的展示文本(仅当 key 为 null 时使用) */
  readonly nativeDisplay?: string
  /** 归类,供帮助面板分组 */
  readonly group: '面板' | '代码区' | '目录树' | '大纲' | '搜索' | '变更'
  /**
   * 是否属于"需真机核验才提示"的补充键位。
   * 原生键(Tab / 方向键)不需要核验 —— 它们不是我们绑的。
   */
  readonly needsVerification: boolean
}

export const KEYS = {
  switchPanel: {
    label: '在目录树 / 代码区 / 大纲之间切换焦点',
    key: null, nativeDisplay: 'Tab / Shift+Tab', group: '面板', needsVerification: false,
  },
  closeHelp: {
    // `needsVerification` 标的是**"这个键位可用与否尚不确定、需真机核验"**,
    // 不是"重要程度"。`Esc` 关对话框是通用约定,不与浏览器键位竞争,可用性无疑问,
    // 所以是 false —— 它会照常在本面板里列出来。
    label: '关闭本面板',
    key: 'Escape', group: '面板', needsVerification: false,
  },
  moveCursor: {
    label: '移动光标(上下左右 / 翻页 / 行首行尾)',
    key: null, nativeDisplay: '↑ ↓ ← → / PageUp PageDown / Home End', group: '代码区', needsVerification: false,
  },
  jumpToDefinition: {
    label: '跳转到定义', key: 'Mod-Enter', group: '代码区', needsVerification: true,
  },
  findReferences: {
    label: '查找引用', key: 'Mod-Shift-Enter', group: '代码区', needsVerification: true,
  },
  treeNav: {
    label: '移动 / 展开 / 折叠 / 打开',
    key: null, nativeDisplay: '↑ ↓ → ← / Enter', group: '目录树', needsVerification: false,
  },
  outlineNav: {
    label: '选择条目 / 定位到该行',
    key: null, nativeDisplay: '↑ ↓ / Enter', group: '大纲', needsVerification: false,
  },
  fileSearch: { label: '文件名搜索', key: 'Mod-k', group: '搜索', needsVerification: true },
  symbolSearch: { label: '符号搜索', key: 'Mod-Shift-o', group: '搜索', needsVerification: true },
  contentSearch: { label: '全文搜索', key: 'Mod-Shift-f', group: '搜索', needsVerification: true },
  previousHunk: { label: '上一处差异', key: 'Alt-ArrowUp', group: '变更', needsVerification: false },
  nextHunk: { label: '下一处差异', key: 'Alt-ArrowDown', group: '变更', needsVerification: false },
} as const satisfies Record<string, KeyDef>

export type KeyId = keyof typeof KEYS

const MAC_SYMBOL: Record<string, string> = {
  Mod: '⌘', Shift: '⇧', Alt: '⌥', Ctrl: '⌃', Enter: '↩', Escape: 'Esc',
}
const PC_WORD: Record<string, string> = {
  Mod: 'Ctrl', Shift: 'Shift', Alt: 'Alt', Ctrl: 'Ctrl', Escape: 'Esc',
}

/**
 * 把 CM6 键串渲染成展示文本。**唯一的展示来源** —— 界面各处都调它,
 * 不允许任何地方直接写 "⌘↩" 这样的字面量。
 */
export function display(id: KeyId): string {
  const def: KeyDef = KEYS[id]
  if (def.key === null) return def.nativeDisplay ?? ''
  const parts = def.key.split('-')
  if (isMac()) {
    return parts.map((p) => MAC_SYMBOL[p] ?? p.toUpperCase()).join('')
  }
  return parts.map((p) => PC_WORD[p] ?? p.toUpperCase()).join('+')
}

/**
 * 该键位此刻是否应当**被绑定并被提示**。
 *
 * 原生键永远算"有"(它们本就存在,不是我们绑的);补充键位在未核验平台上
 * 既不绑定也不提示 —— 提示一个按了没反应的键位比不提示更糟。
 */
export function isActive(id: KeyId): boolean {
  const def: KeyDef = KEYS[id]
  if (!def.needsVerification) return true
  return verifiedShortcuts()
}

/** 供界面标注:未启用时返回 null,调用方据此**不显示**任何键位文本 */
export function hint(id: KeyId): string | null {
  return isActive(id) ? display(id) : null
}

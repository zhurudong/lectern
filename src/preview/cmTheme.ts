import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import type { Extension } from '@codemirror/state'
import type { Theme } from '../theme'

// CM6 双主题:B 方案「阅读器风」(restyle-reader/design.md D1),两套各自独立调校。
//
// **色值必须与 styles.css 的 `--tok-*` 一致** —— 代码区由这里着色,
// Markdown 代码块与大纲徽标由 CSS 变量着色;两处若漂移,同一份代码在
// 预览区和 Markdown 里会是两种配色。E2E 有交叉断言盯这件事。
//
// 只定 6 个语法角色(kw/fn/st/cm/ty/pa),下面按语义把各 tag 归入这 6 个,
// 不额外发明第七种颜色。
//
// **注释色是对 mockup 的有意偏离**:B mockup 的暖灰注释 #AB9D86 压 #F5F1E8 只有
// 约 2.5。低对比注释是**编辑器**的取向 —— 在编辑器里你在写代码,注释是次要的;
// 而**阅读器**里注释承载原作者的意图,常常是屏幕上信息密度最高的文本,
// 把它做成最难读的元素与产品目的相反。已提到 4.96 / 5.59(AA 正文线 4.5),
// 保持暖色相、并仍明显暗于正文(正文 10.93 / 13.60),维持"次要但清晰"的层次。

/** 等宽字体栈:全部为系统自带。移除了 "JetBrains Mono" —— 它不是任何平台的
 *  系统字体,留在栈里对绝大多数用户只是空占位,制造"设计稿有、真机没有"的错觉。 */
const mono =
  'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Cascadia Mono", "Liberation Mono", monospace'

interface Palette {
  bg: string
  fg: string
  dim: string
  gutter: string
  selection: string
  kw: string
  fn: string
  st: string
  cm: string
  ty: string
  pa: string
}

const LIGHT: Palette = {
  bg: '#f5f1e8', fg: '#3a342a', dim: '#6f6656', gutter: '#a89b83', selection: '#e8d9bd',
  kw: '#9c5228', fn: '#256d75', st: '#567032', cm: '#74673f', ty: '#7d5f28', pa: '#b04426',
}

const DARK: Palette = {
  bg: '#1a1714', fg: '#e7e0d3', dim: '#a99f8c', gutter: '#6a6153', selection: '#3a3020',
  kw: '#db8a4c', fn: '#63a6c4', st: '#93ba7e', cm: '#9a8f78', ty: '#d8b77e', pa: '#e39070',
}

function editorTheme(dark: boolean): Extension {
  const p = dark ? DARK : LIGHT
  return EditorView.theme(
    {
      '&': { backgroundColor: p.bg, color: p.fg, fontSize: '12.5px' },
      '.cm-content': {
        fontFamily: mono,
        // 原生 caret 保持透明:光标由 `drawSelection()` 自己画(下面的 .cm-cursor),
        // 两者同时出现会得到两个光标。
        caretColor: 'transparent',
        padding: '8px 0',
        lineHeight: '22px', // 密度令牌:代码行 22px(B 沿用 A 的密度,只换色)
      },
      '.cm-line': { padding: '0 16px 0 8px' },
      '.cm-gutters': {
        backgroundColor: p.bg,
        color: p.gutter,
        border: 'none',
        fontFamily: mono,
        lineHeight: '22px',
      },
      '.cm-lineNumbers .cm-gutterElement': { minWidth: '40px', padding: '0 12px 0 8px' },
      '.cm-activeLine': { backgroundColor: 'transparent' },
      '.cm-activeLineGutter': { backgroundColor: 'transparent' },
      '&.cm-focused': { outline: 'none' },
      '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
        backgroundColor: `${p.selection} !important`,
      },
      // 只读态下光标也要看得见(2a.4):键盘用户要知道自己读到哪一行、
      // 按方向键时是什么在动。加粗到 2px 是因为只读场景没有闪烁输入的语境提示,
      // 光标是唯一的位置线索。
      '.cm-cursor, .cm-cursor-primary': {
        borderLeftColor: p.fg,
        borderLeftWidth: '2px',
      },
      '.cm-scroller': { overflow: 'auto' },
    },
    { dark },
  )
}

/** 两套主题共用同一张 tag → 角色映射,只换调色板,避免两处各写一遍导致漂移 */
function buildHighlight(p: Palette): HighlightStyle {
  return HighlightStyle.define([
    { tag: [t.keyword, t.modifier, t.operatorKeyword], color: p.kw },
    { tag: [t.controlKeyword, t.moduleKeyword], color: p.kw },
    { tag: [t.bool, t.null, t.atom], color: p.kw },
    { tag: [t.meta, t.processingInstruction, t.annotation], color: p.kw },
    { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: p.fn },
    { tag: [t.constant(t.variableName), t.standard(t.variableName)], color: p.fn },
    { tag: [t.link, t.url], color: p.fn },
    { tag: [t.string, t.special(t.string), t.character], color: p.st },
    { tag: [t.regexp, t.escape], color: p.st },
    { tag: [t.number, t.integer, t.float], color: p.st },
    { tag: t.monospace, color: p.st },
    // 注释在两套里**都是斜体** —— A/B 两稿都这么定,不是可选装饰
    { tag: [t.comment, t.blockComment, t.lineComment], color: p.cm, fontStyle: 'italic' },
    { tag: [t.typeName, t.className, t.namespace], color: p.ty },
    { tag: [t.attributeName], color: p.ty },
    { tag: [t.tagName], color: p.pa },
    { tag: [t.angleBracket], color: p.pa },
    { tag: t.invalid, color: p.pa },
    { tag: t.heading, color: p.pa, fontWeight: 'bold' },
    { tag: [t.variableName, t.propertyName, t.definition(t.variableName)], color: p.fg },
    { tag: [t.operator, t.punctuation, t.separator, t.bracket], color: p.dim },
    { tag: t.strong, fontWeight: 'bold' },
    { tag: t.emphasis, fontStyle: 'italic' },
    { tag: t.strikethrough, textDecoration: 'line-through' },
  ])
}

const lightHighlight = buildHighlight(LIGHT)
const darkHighlight = buildHighlight(DARK)

export function appTheme(current: Theme): Extension {
  return current === 'dark'
    ? [editorTheme(true), syntaxHighlighting(darkHighlight)]
    : [editorTheme(false), syntaxHighlighting(lightHighlight)]
}

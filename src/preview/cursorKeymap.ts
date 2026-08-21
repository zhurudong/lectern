// 只读预览区的**光标移动**键位(add-keyboard-first-navigation 2a.1)。
//
// **这里一条编辑命令都没有** —— 只有移动与选区扩展。文档的只读由
// `EditorState.readOnly.of(true)` 保证,不靠"不给编辑键位"来保证:
// 少绑一个键不是安全机制,真正的锁是 readOnly 本身。
//
// 为什么不引入 `@codemirror/commands`:移动的难点(换行、虚拟滚动之外的行、
// 双向文本)都由 `EditorView` 自己的 `moveByChar` / `moveVertically` /
// `moveToLineBoundary` 处理,而它们就在已有依赖里。**用库自己的几何原语,
// 既不新增依赖,也不是自己重写一遍难的部分。**
import { EditorSelection, type SelectionRange } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { KEYS, isActive } from '../lib/keys'
import { jumpToDefinition } from '../intel/jump'
import { findReferences } from '../intel/references'

type Move = (view: EditorView, range: SelectionRange) => SelectionRange

/** 把一个"求下一个位置"的函数变成命令;extend 为真时保持 anchor(扩选) */
function move(by: Move, extend: boolean) {
  return (view: EditorView): boolean => {
    const sel = view.state.selection
    const ranges = sel.ranges.map((r) => {
      const head = by(view, r).head
      return extend ? EditorSelection.range(r.anchor, head) : EditorSelection.cursor(head)
    })
    view.dispatch({
      selection: EditorSelection.create(ranges, sel.mainIndex),
      scrollIntoView: true,
      userEvent: 'select',
    })
    return true
  }
}

const byChar = (fwd: boolean): Move => (v, r) => v.moveByChar(r, fwd)
const byLine = (fwd: boolean): Move => (v, r) => v.moveVertically(r, fwd)
const toBoundary = (fwd: boolean): Move => (v, r) => v.moveToLineBoundary(r, fwd)
const byPage = (fwd: boolean): Move => (v, r) => v.moveVertically(r, fwd, v.dom.clientHeight)
const toDocEdge = (fwd: boolean): Move => (v, r) =>
  EditorSelection.cursor(fwd ? v.state.doc.length : 0, r.assoc)

/** 一组键位:普通移动 + Shift 扩选 */
function pair(key: string, by: Move) {
  return [
    { key, run: move(by, false), preventDefault: true },
    { key: `Shift-${key}`, run: move(by, true), preventDefault: true },
  ]
}

/**
 * 代码理解键位(3.2 / 3.3):跳转到定义、查找引用。
 *
 * **只在代码区持有焦点时生效** —— 它们绑在 CM6 的 keymap 上,而 CM6 的 keymap
 * 只在编辑器持有焦点时参与分发。**不做全局注册**:焦点归属就是路由,
 * 不需要写"我现在在不在代码区"的条件判断。
 *
 * 复用既有通道:取词用 `wordAtCursor`(同一套 `state.wordAt`),
 * 跳转走 `jumpToDefinition`(它内部用唯一的 `definitionsFor` + `navigateWithHistory`),
 * 引用走 `findReferences`。**没有第二条查询或导航通道。**
 *
 * 键位取自 `lib/keys.ts` 的单一映射,**不在这里另写键串**。
 */
function wordAtCursor(view: EditorView): { word: string; line: number } | null {
  const pos = view.state.selection.main.head
  const range = view.state.wordAt(pos)
  if (!range) return null
  const word = view.state.sliceDoc(range.from, range.to)
  if (!word || /^\d/.test(word)) return null
  return { word, line: view.state.doc.lineAt(range.from).number }
}

function runAtCursor(action: (word: string, line: number) => void) {
  return (view: EditorView): boolean => {
    const hit = wordAtCursor(view)
    if (!hit) return false // 光标不在标识符上:不拦截,让按键落回默认行为
    action(hit.word, hit.line)
    return true
  }
}

export const intelKeymap = keymap.of(
  [
    KEYS.jumpToDefinition.key && isActive('jumpToDefinition')
      ? {
          key: KEYS.jumpToDefinition.key,
          run: runAtCursor((word, line) => void jumpToDefinition(word, line)),
          preventDefault: true,
        }
      : null,
    KEYS.findReferences.key && isActive('findReferences')
      ? {
          key: KEYS.findReferences.key,
          run: runAtCursor((word) => void findReferences(word)),
          preventDefault: true,
        }
      : null,
  ].filter((b): b is NonNullable<typeof b> => b !== null),
)

export const readOnlyCursorKeymap = keymap.of([
  ...pair('ArrowLeft', byChar(false)),
  ...pair('ArrowRight', byChar(true)),
  ...pair('ArrowUp', byLine(false)),
  ...pair('ArrowDown', byLine(true)),
  ...pair('Home', toBoundary(false)),
  ...pair('End', toBoundary(true)),
  ...pair('PageUp', byPage(false)),
  ...pair('PageDown', byPage(true)),
  ...pair('Mod-Home', toDocEdge(false)),
  ...pair('Mod-End', toDocEdge(true)),
])

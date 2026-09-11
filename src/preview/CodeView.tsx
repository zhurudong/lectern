import { useEffect, useRef, useState } from 'preact/hooks'
import { EditorState, StateEffect, StateField } from '@codemirror/state'
import {
  EditorView,
  lineNumbers,
  highlightSpecialChars,
  drawSelection,
  Decoration,
  type DecorationSet,
} from '@codemirror/view'
import { syntaxTreeAvailable, syntaxParserRunning } from '@codemirror/language'
import { theme } from '../theme'
import { targetLine, viewportLine, caretLine } from '../state'
import { intelLevelByName } from '../lib/filetypes'
import { jumpToDefinition, openContextMenu, closeContextMenu, definitionsFor } from '../intel/jump'
import { appTheme } from './cmTheme'
import { languageExtension } from './languages'
import { readOnlyCursorKeymap, intelKeymap } from './cursorKeymap'

// 代码/纯文本渲染通道(file-preview spec):
// CodeMirror 6 只读模式 —— 行号、语法高亮、视口虚拟化(大文件不卡),
// EditorState.readOnly + editable(false) 双保险只读,原生选择/复制可用,内容逐字呈现。
// 主题切换时重建编辑器实例(只读场景无状态可丢,重建最简单)。
//
// 按行定位(file-preview spec「按行定位与高亮」):跳转 / 大纲 / 搜索结果共用同一条通道,
// 定位只滚动 + 短暂高亮,不重建实例、不重读文件。

const setHighlight = StateEffect.define<number | null>()

const highlightLine = Decoration.line({ class: 'cm-target-line' })

const highlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (e.is(setHighlight)) {
        if (e.value == null) return Decoration.none
        const line = tr.state.doc.line(e.value)
        return Decoration.set([highlightLine.range(line.from)])
      }
    }
    return deco.map(tr.changes)
  },
  provide: (f) => EditorView.decorations.from(f),
})

// 「按住修饰键可跳转」提示(add-jump-affordance)。
// 与 `.cm-target-line`(落点行高亮)是**两个独立的装饰**,不共用 effect:
// 二者会在同一行上同时出现(刚跳过去、落点还亮着,又按住修饰键悬停该行),
// 共用一个 effect 会让它们互相清除。
const setHint = StateEffect.define<{ from: number; to: number } | null>()

const hintMark = Decoration.mark({ class: 'cm-jump-hint' })

const hintField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (e.is(setHint)) {
        if (e.value == null) return Decoration.none
        return Decoration.set([hintMark.range(e.value.from, e.value.to)])
      }
    }
    return deco.map(tr.changes)
  },
  provide: (f) => EditorView.decorations.from(f),
})

/** 高亮持续时间:足够看清落点,又不至于长期干扰阅读 */
const HIGHLIGHT_MS = 1600

/**
 * 取指定屏幕坐标处的标识符;不在标识符上返回 null。
 *
 * 只要坐标不要完整事件:按住修饰键但**不移动鼠标**时也要能出提示,
 * 那一刻手上只有上一次记下的指针位置,没有 MouseEvent。
 * 点击、右键菜单、按住提示三处共用这一个取词函数 —— 取词规则只此一份。
 */
function wordAtPoint(
  view: EditorView,
  pt: { clientX: number; clientY: number },
): { word: string; line: number; from: number; to: number } | null {
  const pos = view.posAtCoords({ x: pt.clientX, y: pt.clientY })
  if (pos == null) return null
  const range = view.state.wordAt(pos)
  if (!range) return null
  const word = view.state.sliceDoc(range.from, range.to)
  if (!word || /^\d/.test(word)) return null // 纯数字开头的不是标识符
  return { word, line: view.state.doc.lineAt(range.from).number, from: range.from, to: range.to }
}

export function CodeView({ text, language, fileName }: { text: string; language?: string; fileName?: string }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const currentTheme = theme.value
  const target = targetLine.value
  const [notice, setNotice] = useState<string | null>(null)

  // 临时诊断(chase-dockerfile-highlight-flake 1.1):同一瞬间取齐"正文是否已出现 /
  // 高亮类计数 / 语法树解析是否已跑到文末" —— 三者分开取会得出互相矛盾的结论。
  // `syntaxTreeAvailable` 是 legacy-modes(StreamLanguage)与 Lezer 语言共用的判据:
  // CM6 的解析是增量、可能延后到 idle 时机完成的,树未跑到文末就等于"还没上色"。
  if (__CV_TEST_HOOK__) {
    ;(window as unknown as { __cvCodeState?: () => unknown }).__cvCodeState = () => {
      const view = viewRef.current
      if (!view) return null
      const spans = [...view.contentDOM.querySelectorAll('.cm-line span')]
      return {
        language,
        hasText: view.state.doc.length > 0,
        spanCount: spans.length,
        distinctSpanClasses: new Set(spans.map((s) => s.className).filter(Boolean)).size,
        treeAvailable: syntaxTreeAvailable(view.state, view.state.doc.length),
        parserRunning: syntaxParserRunning(view),
      }
    }
  }

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const view = new EditorView({
      state: EditorState.create({
        doc: text,
        extensions: [
          lineNumbers(),
          highlightSpecialChars(),
          // **只读的锁是 `readOnly`,不是 `editable(false)`。**
          // `editable(false)` 关掉的是 contentEditable —— 而光标正依赖它存在。
          // 对"防改"来说那是第二道冗余锁(readOnly 已完全禁止文档变更),
          // 它唯一的额外效果就是砍掉键盘用户读代码时最基本的东西:一个能移动的光标。
          // 去掉它之后所有写入路径仍然不改文档,这一点由 E2E 逐条证明(2a.2),
          // **不是靠"应该没问题"**。
          EditorState.readOnly.of(true),
          readOnlyCursorKeymap,
          // 只有支持代码理解的语言才装这组键位:.yaml 之类根本没有"定义"可跳。
          // 与光标键位不冲突(⌘↩ / ⌘⇧↩ vs 方向键),先后顺序在这里无所谓。
          ...(intelOn ? [intelKeymap] : []),
          drawSelection(),
          highlightField,
          hintField,
          // 记录视口顶部行,供导航栈保存"跳出行"
          EditorView.updateListener.of((u) => {
            // caret 行:导航栈据此记录"离开时的位置"。
            //
            // **不能"选区一变就同步"**:编辑器失焦时(比如用户点进搜索框),
            // CM6 会跟着 DOM 选区把状态选区归零 —— 那不是用户移动了光标,
            // 而是浏览器收走了选区。照单更新会把用户真正读到的位置抹成第 1 行,
            // 于是后退回到文件开头。(实测:栈里记成了 `deep.go@1`,而离开时 caret 在 49。)
            //
            // 所以只认两种来源:**编辑器持有焦点时的选区变化**(用户自己动的),
            // 以及**我们自己的导航定位**(带 `select.navigate` 标记)。
            const fromNavigation = u.transactions.some((tr) => tr.isUserEvent('select.navigate'))
            if (u.docChanged || fromNavigation || (u.selectionSet && u.view.hasFocus)) {
              caretLine.value = u.state.doc.lineAt(u.state.selection.main.head).number
            }
            if (!u.geometryChanged && !u.viewportChanged && !u.docChanged) return
            const top = u.view.lineBlockAtHeight(u.view.scrollDOM.scrollTop).from
            viewportLine.value = u.state.doc.lineAt(top).number
          }),
          appTheme(currentTheme),
          languageExtension(language),
        ],
      }),
      parent: host,
    })
    // 2a.3:contentEditable 一旦为真,浏览器会对代码区做拼写检查(满屏红波浪线),
    // 还会把它当成可输入区做自动大写/自动更正。这些都是 contentEditable 的附带面,
    // 与 readOnly 无关,必须显式关掉。
    view.contentDOM.setAttribute('spellcheck', 'false')
    view.contentDOM.setAttribute('autocorrect', 'off')
    view.contentDOM.setAttribute('autocapitalize', 'off')
    view.contentDOM.setAttribute('aria-readonly', 'true')
    viewRef.current = view
    return () => {
      viewRef.current = null
      view.destroy()
    }
  }, [text, language, currentTheme])

  // 定位到目标行:实例重建(换文件)与 target 变化(同文件内定位)都要生效
  useEffect(() => {
    const view = viewRef.current
    if (!view || !target) return
    const total = view.state.doc.lines
    // 目标行超出文件行数(或落在被截断文件的未加载部分):定位到最近位置并提示
    const clamped = Math.min(Math.max(1, target.line), total)
    const outOfRange = clamped !== target.line
    const line = view.state.doc.line(clamped)
    // caret 落点(fix-navigation-caret-landing 1.1):
    //   ① 入口给了列 → 用它;
    //   ② 入口给了符号名 → 落在该行内**符号出现的位置**;
    //   ③ 都没有 → 落在首个非空白字符(行首往往是缩进)。
    //
    // 为什么不图省事一律落行首:`⌘⇧↩` 查引用取的是 caret 处的词,
    // 落在缩进上取不到词、落在 `func` 这类关键字上会查一个与用户意图无关的词。
    // **"到了目标行"不等于"到了目标符号"。**
    const text = view.state.sliceDoc(line.from, line.to)
    let caret = line.from
    if (target.col != null) {
      caret = Math.min(line.from + target.col, line.to)
    } else if (target.word) {
      const idx = text.indexOf(target.word)
      caret = idx >= 0 ? line.from + idx : line.from + Math.max(0, text.search(/\S/))
    } else {
      caret = line.from + Math.max(0, text.search(/\S/))
    }
    view.dispatch({
      // **与滚动、高亮同一次 dispatch** —— 不新增第二条定位路径(1.2),
      // 也避免"先设选区再滚动"之类的时序问题。
      selection: { anchor: caret },
      // 标记来源:让 caret 行的同步逻辑能把"导航定位"与"失焦归零"区分开
      userEvent: 'select.navigate',
      effects: [
        EditorView.scrollIntoView(line.from, { y: 'center' }),
        setHighlight.of(clamped),
      ],
    })
    setNotice(
      outOfRange
        ? `目标行 ${target.line} 超出当前可定位范围(共 ${total} 行,大文件已截断展示),已定位到最近位置`
        : null,
    )
    const timer = setTimeout(() => {
      // 实例可能已在计时期间被替换,取最新的一个再撤高亮
      viewRef.current?.dispatch({ effects: setHighlight.of(null) })
    }, HIGHLIGHT_MS)
    return () => clearTimeout(timer)
  }, [target?.seq, text, language, currentTheme])

  // 换文件时清掉上一次的越界提示
  useEffect(() => {
    if (!target) setNotice(null)
  }, [text])

  // 跳转/引用的两条主入口都挂在这里,均不依赖浏览器保留键:
  //  ① Cmd/Ctrl + 点击标识符  ② 右键菜单
  const intelOn = intelLevelByName(fileName ?? '') === 'full'

  // ---- 按住修饰键的可跳转提示(add-jump-affordance)----
  // 最近一次指针位置:按住修饰键但不移动鼠标时,取词只能靠它。
  const lastPointRef = useRef<{ clientX: number; clientY: number } | null>(null)
  // 最近一次**已判定过**的标识符范围。它记的是"查过了",不是"有提示" ——
  // 否则指针在一个不可跳转的词里移动时会每次 mousemove 都重查。
  const lastRangeRef = useRef<string | null>(null)

  const clearHint = () => {
    lastRangeRef.current = null
    viewRef.current?.dispatch({ effects: setHint.of(null) })
  }

  const updateHint = (pt: { clientX: number; clientY: number } | null, held: boolean) => {
    if (!intelOn) return // 1.5:不支持代码理解的语言直接短路,不取词不查询
    if (!held || !pt) return clearHint()
    const view = viewRef.current
    if (!view) return
    const hit = wordAtPoint(view, pt)
    if (!hit) return clearHint()
    const key = `${hit.from}-${hit.to}`
    // 1.3:只有"指针下的标识符变了"才重算装饰(查表是微秒级,重建装饰不是)
    if (key === lastRangeRef.current) return
    lastRangeRef.current = key
    // 1.2:与跳转**同一条**查询入口
    const canJump = definitionsFor(hit.word).length > 0
    view.dispatch({ effects: setHint.of(canJump ? { from: hit.from, to: hit.to } : null) })
  }

  useEffect(() => {
    if (!intelOn) return
    const held = (e: KeyboardEvent) => e.metaKey || e.ctrlKey
    const onKeyDown = (e: KeyboardEvent) => held(e) && updateHint(lastPointRef.current, true)
    const onKeyUp = (e: KeyboardEvent) => !held(e) && clearHint()
    // 1.4 第三条清除路径,**必须单独成立**:按住修饰键 ⌘Tab 切走时,
    // keyup 可能**永远不会送达本页面**,只靠 keyup 会让下划线滞留在界面上。
    const onBlur = () => clearHint()
    const onVisibility = () => document.visibilityState === 'hidden' && clearHint()
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [intelOn, text, language, currentTheme])

  const onMouseMove = (e: MouseEvent) => {
    lastPointRef.current = { clientX: e.clientX, clientY: e.clientY }
    updateHint(lastPointRef.current, e.metaKey || e.ctrlKey)
  }

  const onMouseLeave = () => {
    lastPointRef.current = null
    clearHint()
  }

  const onClick = (e: MouseEvent) => {
    if (!intelOn || !(e.metaKey || e.ctrlKey)) return
    const view = viewRef.current
    if (!view) return
    const hit = wordAtPoint(view, e)
    if (!hit) return
    e.preventDefault()
    closeContextMenu()
    void jumpToDefinition(hit.word, hit.line)
  }

  const onContextMenu = (e: MouseEvent) => {
    if (!intelOn) return
    const view = viewRef.current
    if (!view) return
    const hit = wordAtPoint(view, e)
    if (!hit) return
    e.preventDefault()
    openContextMenu(e.clientX, e.clientY, hit.word, hit.line)
  }

  return (
    <>
      {notice && <div class="preview-notice preview-notice-warn">{notice}</div>}
      <div
        class={`code-view${intelOn ? ' code-view-intel' : ''}`}
        ref={hostRef}
        onClick={(e) => onClick(e as unknown as MouseEvent)}
        onContextMenu={(e) => onContextMenu(e as unknown as MouseEvent)}
        onMouseMove={(e) => onMouseMove(e as unknown as MouseEvent)}
        onMouseLeave={onMouseLeave}
      />
    </>
  )
}

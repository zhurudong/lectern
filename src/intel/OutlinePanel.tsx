import { useEffect, useState } from 'preact/hooks'
import { mode, selectedFile } from '../state'
import { identifyByName, intelLevelByName, languageLabel } from '../lib/filetypes'
import { activeFileParsing, activeFileSymbols, ensureFileSymbols, type SymbolHit } from './indexStore'
import { navigateWithHistory } from './navStack'
import { focusEditorWhenReady } from '../lib/focusEditor'
import { KIND, KIND_BADGE, KIND_LABEL } from './symbols'

// 文件大纲(code-intelligence spec「文件大纲」):
// 按文件内出现顺序列出结构,点击定位到行;切换文件同步更新、不残留上一个文件的条目;
// 不支持代码理解的语言展示明确说明而非空白;折叠态持久化。

const COLLAPSE_KEY = 'cv-outline-collapsed'

// 每种状态都带 path:渲染时与当前选中文件比对,不一致一律按"解析中"呈现。
// 这样"切换文件后残留上一个文件的条目"在结构上不可能发生(spec 明确要求),
// 而不是依赖 effect 先跑完来清空。
type OutlineState =
  | { status: 'empty'; path: '' }
  | { status: 'loading'; path: string }
  | { status: 'unsupported'; path: string; language: string }
  | { status: 'ready'; path: string; symbols: SymbolHit[]; skipped?: 'too-large' | 'error' }

export function OutlinePanel() {
  const sel = selectedFile.value
  const [state, setState] = useState<OutlineState>({ status: 'empty', path: '' })
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1')

  // 键盘导航(2b):**照搬目录树那套模式,但不抽公共组件** ——
  // 树是层级 + 路径,大纲是平铺 + 符号,现在抽只会造出一个两边都不合身的中间层。
  // 抽象要由重复驱动,不由预感驱动;等两边的键盘逻辑真的长成一样再说。
  //
  // 活动项用**稳定标识**(行号 + 种类 + 名字)而不是列表下标:切文件、重解析后
  // 下标会指向另一个符号,而标识不会 —— 与目录树用 path 而非行索引同理。
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const curPath = sel ? sel.path.join('/') : ''
  const rows: SymbolHit[] =
    state.status === 'ready' && state.path === curPath ? state.symbols : []
  const keyOf = (s: SymbolHit) => `${s.line}-${s.kind}-${s.name}`

  // 2b.3:切换预览文件后大纲重建,活动态**不能指向不相干的条目** —— 直接清空。
  useEffect(() => {
    setActiveKey(null)
  }, [sel?.nonce])

  const moveActive = (delta: number) => {
    if (rows.length === 0) return
    const cur = rows.findIndex((s) => keyOf(s) === activeKey)
    const next = cur < 0 ? (delta > 0 ? 0 : rows.length - 1) : Math.min(rows.length - 1, Math.max(0, cur + delta))
    const key = keyOf(rows[next])
    setActiveKey(key)
    document.getElementById(`cv-ol-${key}`)?.scrollIntoView({ block: 'nearest' })
  }

  const onOutlineKeyDown = (e: KeyboardEvent) => {
    if (rows.length === 0) return
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); moveActive(1); return
      case 'ArrowUp': e.preventDefault(); moveActive(-1); return
      case 'Home': e.preventDefault(); setActiveKey(keyOf(rows[0])); return
      case 'End': e.preventDefault(); setActiveKey(keyOf(rows[rows.length - 1])); return
      case 'Enter': {
        const s = rows.find((r) => keyOf(r) === activeKey)
        if (!s) return
        e.preventDefault()
        // 大纲上按 Enter 的语义是"带我去那段代码" —— 把当前持有焦点的容器传进去,
        // 让交接守卫知道这不是抢焦点,是持有者自己交出。
        const from = document.activeElement
        void navigateWithHistory(s.path, s.line, undefined, { word: s.name }).then(() =>
          focusEditorWhenReady(from),
        )
        return
      }
    }
  }

  const toggle = () => {
    setCollapsed((c) => {
      localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1')
      return !c
    })
  }

  useEffect(() => {
    if (!sel) {
      setState({ status: 'empty', path: '' })
      activeFileSymbols.value = []
      activeFileParsing.value = false
      return
    }
    const path = sel.path.join('/')
    const level = intelLevelByName(sel.name)
    const langId = identifyByName(sel.name)?.language
    if (level === 'none' || !langId) {
      setState({ status: 'unsupported', path, language: languageLabel(langId) })
      activeFileSymbols.value = []
      activeFileParsing.value = false
      return
    }
    let cancelled = false
    setState({ status: 'loading', path })
    activeFileSymbols.value = []
    activeFileParsing.value = true
    ensureFileSymbols(path, sel.handle, langId)
      .then((res) => {
        if (cancelled) return
        setState({ status: 'ready', path, symbols: res.symbols, skipped: res.skipped })
        activeFileSymbols.value = res.symbols
        activeFileParsing.value = false
      })
      .catch(() => {
        if (cancelled) return
        setState({ status: 'ready', path, symbols: [], skipped: 'error' })
        activeFileSymbols.value = []
        activeFileParsing.value = false
      })
    return () => {
      cancelled = true
    }
  }, [sel?.nonce])

  if (collapsed) {
    return (
      <div class="outline outline-collapsed">
        <button class="outline-toggle" title="展开大纲" onClick={toggle}>
          ‹ 大纲
        </button>
      </div>
    )
  }

  return (
    <aside class="outline">
      <div class="outline-header">
        <span class="outline-title">大纲</span>
        <button class="outline-toggle" title="折叠大纲" onClick={toggle}>
          ›
        </button>
      </div>
      <div
        class="outline-body"
        tabIndex={0}
        aria-label="大纲"
        role="listbox"
        aria-activedescendant={activeKey ? `cv-ol-${activeKey}` : undefined}
        onKeyDown={(e) => onOutlineKeyDown(e as unknown as KeyboardEvent)}
      >
        <OutlineBody state={state} forPath={curPath} activeKey={activeKey} />
      </div>
      {/* 单文件模式的范围明示(spec「单文件模式下的代码理解」要求 MUST NOT 让用户靠试错推断) */}
      {mode.value === 'single' && (
        <div class="outline-single-note">
          单文件模式:跳转仅限本文件内;<strong>查找引用与全局符号搜索需要打开所在文件夹</strong>。
        </div>
      )}
    </aside>
  )
}

function OutlineBody({
  state,
  forPath,
  activeKey,
}: {
  state: OutlineState
  forPath: string
  activeKey?: string | null
}) {
  if (state.status === 'empty' || !forPath) {
    return <div class="outline-note">未打开文件</div>
  }
  // 状态还停留在上一个文件上(effect 尚未跑):按解析中呈现,绝不显示旧条目
  if (state.path !== forPath || state.status === 'loading') {
    return <div class="outline-note">解析中…</div>
  }
  if (state.status === 'unsupported') {
    return (
      <div class="outline-note">
        {state.language} 暂不支持大纲
        <div class="outline-note-sub">该语言不参与代码理解,语法高亮与预览不受影响。</div>
      </div>
    )
  }
  if (state.skipped === 'too-large') {
    return (
      <div class="outline-note">
        文件过大,符号未被索引
        <div class="outline-note-sub">超过 5 MB 的文件不参与符号抽取,大纲与跳转不覆盖该文件。</div>
      </div>
    )
  }
  if (state.skipped === 'error') {
    return <div class="outline-note">该文件解析失败,无法生成大纲</div>
  }
  if (state.symbols.length === 0) {
    return <div class="outline-note">该文件未发现可列出的定义</div>
  }
  return (
    <>
      {state.symbols.map((s, i) => {
        // 层级:Markdown 按标题级别缩进;代码按"是否属于某个容器"缩进一级
        const indent = s.kind === KIND.heading ? Math.max(0, s.level - 1) : s.container ? 1 : 0
        return (
          <div
            key={`${s.name}-${s.line}-${i}`}
            id={`cv-ol-${s.line}-${s.kind}-${s.name}`}
            role="option"
            aria-selected={activeKey === `${s.line}-${s.kind}-${s.name}`}
            class={`outline-row${activeKey === `${s.line}-${s.kind}-${s.name}` ? ' active' : ''}`}
            style={{ paddingLeft: `${8 + indent * 14}px` }}
            title={`${KIND_LABEL[s.kind]}${s.container ? ` · ${s.container}` : ''} · 第 ${s.line} 行`}
            onClick={() => void navigateWithHistory(s.path, s.line, undefined, { word: s.name })}
          >
            <span class={`outline-kind kind-${s.kind}`}>{KIND_BADGE[s.kind]}</span>
            <span class="outline-name">{s.name}</span>
            <span class="outline-line">{s.line}</span>
          </div>
        )
      })}
    </>
  )
}

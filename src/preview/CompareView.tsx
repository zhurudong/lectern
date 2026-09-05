import { useEffect, useRef, useState } from 'preact/hooks'
import { EditorState, type Extension } from '@codemirror/state'
import { keymap, lineNumbers, drawSelection } from '@codemirror/view'
import { MergeView, goToNextChunk, goToPreviousChunk } from '@codemirror/merge'
import { theme } from '../theme'
import { t } from '../i18n'
import { selectedFile } from '../state'
import { loadPreview } from '../lib/fs'
import { KEYS, isActive, display } from '../lib/keys'
import { appTheme } from './cmTheme'
import { languageExtension } from './languages'
import { readOnlyCursorKeymap } from './cursorKeymap'
import {
  compareStats,
  compareTestOverrides,
  exitCompare,
  type CompareTarget,
} from './compareStore'

// 文件对比(C1)的并排视图(design.md D2 / D3 / D8,spec「文件对比视图」)。
//
// 只做并排(side-by-side),**不做 unified**(D2):C1 没有基线,unified 内在假设了基线。
// 用 `@codemirror/merge` 的 MergeView(D9 已拍板),两侧各自只读、各按自身文件类型高亮。
//
// **只读的两道口径**(D3 / task 4):
//   ① 拒绝修改:两侧编辑器都 `EditorState.readOnly.of(true)`。
//   ② 不呈现写入控件:**不传 `revertControls`** —— 侧栏 MergeView 仅在该项为真时才渲染
//      回退控件(见 node_modules/@codemirror/merge index.js:1278 `!!config.revertControls`)。
//      不给这个选项,界面上就没有"接受/回退/合并"入口。验收走**负向断言**(task 4.3),
//      不靠"我们没开那个选项"这种配置断言。
//
// **工作量自限、精度自报**(D8 / task 8):`diffConfig` 只给 `timeout`,**不带 scanLimit** ——
// MergeView 默认的 `scanLimit:500` 按字符计,16 KB 以上会悄悄退化成"整份都变了"(task 8.3)。
// 给时间预算,超了库自己降级,并把 `Chunk.precise===false` 明示给用户(结论不可靠)。

/** 精算的时间预算(ms):超出则库自己退回近似,并经 precise 自报(design 实测:2000 行 10% ≈ 38ms) */
const DIFF_TIMEOUT_MS = 1000

/**
 * 差异间键盘通道(task 7.1):绑在两侧编辑器上,只在编辑器持有焦点时生效 —— 与代码区键位同口径。
 * 0.3.4 合流:复用与 git 变更对比同一份 `nextHunk`/`previousHunk`(⌥↓/↑),不另立键位。
 */
const compareNavKeymap = keymap.of(
  [
    KEYS.nextHunk.key && isActive('nextHunk')
      ? { key: KEYS.nextHunk.key, run: goToNextChunk, preventDefault: true }
      : null,
    KEYS.previousHunk.key && isActive('previousHunk')
      ? { key: KEYS.previousHunk.key, run: goToPreviousChunk, preventDefault: true }
      : null,
  ].filter((b): b is NonNullable<typeof b> => b !== null),
)

function readonlyExtensions(language: string | undefined, currentTheme: 'light' | 'dark'): Extension {
  return [
    lineNumbers(),
    // 只读的锁是 readOnly 本身(与 CodeView 同口径):不靠"少绑编辑键位"充当安全机制。
    EditorState.readOnly.of(true),
    drawSelection(),
    readOnlyCursorKeymap, // 方向键移动光标:只读也要能用键盘读
    compareNavKeymap, // ⌥↑/↓ 差异间跳转
    appTheme(currentTheme),
    languageExtension(language), // 各侧按自身文件类型高亮(spec / task 3.1)
  ]
}

interface Loaded {
  text: string
  language?: string
  truncated: boolean
  isText: boolean
}

async function loadSide(handle: FileSystemFileHandle): Promise<Loaded> {
  const data = await loadPreview(handle)
  if (data.kind !== 'text') {
    return { text: '', language: undefined, truncated: false, isText: false }
  }
  return { text: data.text, language: data.language, truncated: data.truncated, isText: true }
}

export function CompareView({ target }: { target: CompareTarget }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const mergeRef = useRef<MergeView | null>(null)
  const currentTheme = theme.value
  const sel = selectedFile.value
  const [error, setError] = useState<string | null>(null)
  const [reliability, setReliability] = useState<string | null>(null)
  const [narrow, setNarrow] = useState(false)

  const curPath = sel ? sel.path.join('/') : ''
  const curName = sel?.name ?? ''
  const targetPath = target.path.join('/')

  useEffect(() => {
    const host = hostRef.current
    if (!host || !sel) return
    let cancelled = false
    setError(null)
    setReliability(null)
    compareStats.value = null

    ;(async () => {
      let a: Loaded
      let b: Loaded
      try {
        // A = 当前文件,B = 对比目标。两侧都经 lib/fs.loadPreview 读取:
        // 截断阈值(SIZE_LIMIT / TRUNCATE_BYTES)**复用同一处**,不在对比侧另写一套(task 6.1)。
        ;[a, b] = await Promise.all([loadSide(sel.handle), loadSide(target.handle)])
      } catch (err) {
        if (cancelled) return
        // 目标读不到(已删除 / 移动 / 授权失效):可解释地缺席,不报错白屏(D5 / task 5.1)。
        // 退出即回到当前文件的普通预览(spec 场景「对比目标在选定后被删除」)。
        setError(
          t('compare.errUnreadable', {
            name: target.name,
            message: err instanceof Error ? err.message : String(err),
          }),
        )
        return
      }
      if (cancelled) return
      if (!b.isText) {
        setError(t('compare.errNotText', { name: target.name }))
        return
      }

      const useDefault = compareTestOverrides.useDefaultScanLimit
      const forceRevert = compareTestOverrides.forceRevertControls
      // 生产配置只给 timeout(不带 scanLimit):超预算时库走 crudeMatch → 自报 precise:false,
      // 可检出(spec「降级 SHALL 是可检出的」)。E2E 两个注入点:
      //  - tinyTimeout(1ms):必定超预算 → precise:false,验证"近似披露"(8.2)。
      //  - useDefaultScanLimit:退回默认 scanLimit:500 → 8 处改动被并成 1 大块,
      //    **且 precise 仍为 true(悄悄退化)** —— 这正是 task 8.3 禁用它的理由(8.4)。
      const diffConfig = compareTestOverrides.tinyTimeout
        ? { timeout: 1 }
        : useDefault
          ? undefined
          : { timeout: DIFF_TIMEOUT_MS }
      const mv = new MergeView({
        a: { doc: a.text, extensions: readonlyExtensions(a.language, currentTheme) },
        b: { doc: b.text, extensions: readonlyExtensions(b.language, currentTheme) },
        parent: host,
        gutter: true,
        highlightChanges: true,
        // 长段未改内容折叠,保留改动上下文;纯阅读场景更聚焦差异。
        collapseUnchanged: { margin: 3, minSize: 6 },
        // **默认不传 revertControls** → 不渲染回退控件(只读红线,task 4.2)。
        // forceRevert 仅 E2E 注入,用来证明负向断言抓得到(task 4.4)。
        ...(forceRevert ? { revertControls: 'a-to-b' as const } : {}),
        // diffConfig undefined 时 MergeView 用其默认 {scanLimit:500}(仅 useDefault 注入路径)。
        ...(diffConfig ? { diffConfig } : {}),
      })
      mergeRef.current = mv

      const chunks = mv.chunks
      const imprecise = chunks.some((c) => !c.precise)
      const aDoc = mv.a.state.doc
      const bDoc = mv.b.state.doc
      // "整份都变了":单块且覆盖文档超过一半的行 —— 默认 scanLimit 把 8 处分散小改动
      // 并成一大块(实测覆盖 line 120..961 / 1001 ≈ 84%)就是这个形状。**不能只看 fromA===0**:
      // 退化后的大块起止未必贴着文档两端,却已把"几行改动"放大成"大半份都变了"。
      let spansWhole = false
      if (chunks.length === 1) {
        const c = chunks[0]
        const fromLine = aDoc.lineAt(Math.min(Math.max(0, c.fromA), aDoc.length)).number
        const toLine = aDoc.lineAt(Math.min(c.endA, aDoc.length)).number
        spansWhole = (toLine - fromLine + 1) / Math.max(1, aDoc.lines) > 0.5
      }
      compareStats.value = {
        chunkCount: chunks.length,
        imprecise,
        truncatedA: a.truncated,
        truncatedB: b.truncated,
        aLines: aDoc.lines,
        bLines: bDoc.lines,
        spansWhole,
      }

      // 结论不可靠的两个来源,归一为**同一条**提示(task 6.2b):用户看到的是同一件事。
      const parts: string[] = []
      if (a.truncated || b.truncated) {
        const which =
          a.truncated && b.truncated
            ? t('compare.truncWhichBoth')
            : a.truncated
              ? t('compare.truncWhichCur')
              : t('compare.truncWhichTarget')
        parts.push(t('compare.truncated', { which }))
      }
      if (imprecise) {
        parts.push(t('compare.approx'))
      }
      setReliability(
        cancelled || parts.length === 0 ? null : t('compare.reliabilityPrefix') + parts.join(' '),
      )
    })()

    return () => {
      cancelled = true
      mergeRef.current?.destroy()
      mergeRef.current = null
    }
    // target.nonce:同一路径再次选取也要重建;currentTheme:主题切换重建(只读无状态可丢)
  }, [sel?.nonce, target.path.join('/'), target.nonce, currentTheme])

  // 窄容器的**可解释降级**(D2 / task 3.3):三栏里再切两栏,窄屏会挤。
  // 并排两栏仍并排(各自 cm-scroller 横向可滚,内容不被压到不可读),同时给一条
  // 说得出原因的提示 —— MUST NOT 只是"没报错",要告诉用户为什么挤、怎么腾地方。
  const NARROW_PX = 720
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const measure = () => setNarrow(host.getBoundingClientRect().width < NARROW_PX)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(host)
    return () => ro.disconnect()
  }, [error])

  // Esc 退出对比(task 7 / keys.exitCompare)。打开期间才挂,关掉即卸载。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        exitCompare()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const nav = (cmd: typeof goToNextChunk) => {
    const mv = mergeRef.current
    if (!mv) return
    // 在当前持有焦点的一侧执行;都没焦点则默认在 A 侧,并把焦点带过去。
    const view = mv.b.hasFocus ? mv.b : mv.a
    cmd(view)
    view.focus()
  }

  const nextKey = isActive('nextHunk') ? display('nextHunk') : null
  const prevKey = isActive('previousHunk') ? display('previousHunk') : null

  return (
    <div class="compare-view">
      <div class="compare-toolbar">
        <span class="compare-badge">{t('compare.badge')}</span>
        <span class="compare-side" title={curPath}>
          A · {curName}
        </span>
        <span class="compare-vs">↔</span>
        <span class="compare-side" title={targetPath}>
          B · {target.name}
        </span>
        <span class="spacer" />
        {!error && (
          <>
            <button
              class="compare-nav"
              title={prevKey ? t('compare.navPrevTitleKey', { key: prevKey }) : t('keys.previousHunk')}
              onClick={() => nav(goToPreviousChunk)}
            >
              {t('compare.navPrev')}
            </button>
            <button
              class="compare-nav"
              title={nextKey ? t('compare.navNextTitleKey', { key: nextKey }) : t('keys.nextHunk')}
              onClick={() => nav(goToNextChunk)}
            >
              {t('compare.navNext')}
            </button>
          </>
        )}
        <button class="compare-exit" title={t('compare.exitTitle')} onClick={exitCompare}>
          {t('keys.exitCompare')}
        </button>
      </div>
      {reliability && (
        <div class="preview-notice compare-reliability">{reliability}</div>
      )}
      {!error && narrow && (
        <div class="preview-notice compare-narrow">
          {t('compare.narrow')}
        </div>
      )}
      {error ? (
        <div class="preview-error compare-error">{error}</div>
      ) : (
        <div class="compare-host" ref={hostRef} />
      )}
    </div>
  )
}

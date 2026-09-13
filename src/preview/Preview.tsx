import { useEffect, useState } from 'preact/hooks'
import { t } from '../i18n'
import { selectedFile } from '../state'
import { loadPreview, formatSize, type LoadedPreview, TRUNCATE_BYTES } from '../lib/fs'
import { useResizable } from '../lib/useResizable'
import { isInExcludedPath } from '../lib/excluded'
import { IntelBadge } from '../intel/IntelBadge'
import { IntelOverlay, NavButtons } from '../intel/IntelOverlay'
import { OutlinePanel } from '../intel/OutlinePanel'
import { ReferencePanel } from '../intel/ReferencePanel'
import { refPanelOpen } from '../intel/references'
import { ContentPanel } from '../search/ContentPanel'
import { contentPanelOpen } from '../search/contentStore'
import { CodeView } from './CodeView'
import { MarkdownView } from './MarkdownView'
import { ImageView } from './ImageView'
import { BinaryView } from './BinaryView'
import { CompareView } from './CompareView'
import { ComparePicker } from './ComparePicker'
import { compareTarget, openComparePicker, resetCompare } from './compareStore'

// 渲染分发器(file-preview spec):代码 / Markdown / 图片 / 二进制提示 / 纯文本 五通道。
// 读取全程异步,不阻塞界面;selectedFile.nonce 变化即重新读取(点击即重读,不缓存)。

type LoadState =
  | { status: 'idle' }
  | { status: 'loading'; name: string }
  | { status: 'error'; name: string; message: string }
  | { status: 'ready'; data: LoadedPreview }

const OUTLINE_KEY = 'cv-outline-width'

export function Preview() {
  const sel = selectedFile.value
  const [state, setState] = useState<LoadState>({ status: 'idle' })
  // 对比是**当前文件**的临时视图态:换文件即退出(它对新文件不成立)。
  // 订阅同一个 nonce,与下面的读取生命周期一致。
  const compare = compareTarget.value
  useEffect(() => {
    resetCompare()
  }, [sel?.nonce])

  // 大纲面板宽度:与左侧目录树共用同一套实现,只是增宽方向相反(见 lib/useResizable)。
  // 宽度经 CSS 变量下发给 `.outline`,这样 OutlinePanel(src/intel/)完全不需要改动。
  const { width: outlineWidth, onResizeStart: onOutlineResize } = useResizable({
    storageKey: OUTLINE_KEY,
    min: 160,
    max: 520,
    defaultWidth: 220,
    grow: 'left',
  })

  useEffect(() => {
    if (!sel) {
      setState({ status: 'idle' })
      return
    }
    let cancelled = false
    setState({ status: 'loading', name: sel.name })
    loadPreview(sel.handle)
      .then((data) => {
        if (!cancelled) setState({ status: 'ready', data })
      })
      .catch((err) => {
        if (!cancelled) {
          setState({
            status: 'error',
            name: sel.name,
            message: err instanceof Error ? err.message : String(err),
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [sel?.nonce])

  if (!sel || state.status === 'idle') {
    return (
      <div class="preview-placeholder">
        <div style="font-size: 32px">📄</div>
        <div>{t('preview.placeholder')}</div>
      </div>
    )
  }

  return (
    <>
      <div class="preview-header">
        <NavButtons />
        <span class="file-path">{sel.path.join('/')}</span>
        <span class="spacer" />
        {/* 文件对比入口(D1):仅当前文件是文本时呈现 —— 对比是文本文件的能力。
            单文件模式下按钮照常出现,点击后由选择器给出"需要先打开项目"的可解释缺席,
            **不做成一个点了没反应或无解释消失的入口**(task 5.3)。 */}
        {/* 对比态下按钮**保持挂载**:退出对比要把焦点交还到它身上(task 7.2),
            若在对比期间把它从 DOM 摘掉,退出那一刻焦点归还就落空(el 已 disconnected)。 */}
        {state.status === 'ready' && state.data.kind === 'text' && (
          <button
            class={`compare-entry${compare ? ' active' : ''}`}
            title={compare ? t('preview.compareActive') : t('preview.compareEntry')}
            onClick={(e) => openComparePicker(e.currentTarget as HTMLElement)}
          >
            {t('preview.compareBtn')}
          </button>
        )}
        <IntelBadge fileName={sel.name} />
      </div>
      {/* 3.3:"能打开却搜不到"必须是**被解释过的行为**,不能让用户当成缺陷 */}
      {isInExcludedPath(sel.path) && (
        <div class="preview-notice preview-notice-scope">
          {t('preview.excludedNotice')}
        </div>
      )}
      <div class="preview-main" style={{ '--outline-width': `${outlineWidth}px` }}>
        <div class="preview-stack">
          {/* 面板级可聚焦容器(1.1):按 DOM 顺序 树 → 预览 → 大纲 排进原生 Tab 序。
              基线只用原生 Tab,不依赖任何自定义键位 —— 便捷键位若在某平台被浏览器抢占,
              能力也不会跟着没(1.5)。 */}
          {/* 预览面板的 Tab 停靠点**只能有一个**:
              - 代码文件:CodeMirror 的 `.cm-content` 本身就是可聚焦的(contentEditable),
                它就是那个停靠点 —— 焦点直接落进编辑器,光标键与 ⌘↩ 立刻可用;
              - 图片 / 二进制 / Markdown 富文本:里面没有可聚焦元素,
                这时容器自己充当停靠点,至少能用方向键滚动。

              **不要两个都设 tabIndex={0} 再做焦点转交**:那样 Shift+Tab 会在
              容器与编辑器之间来回弹(实测出现过 `preview → preview → …` 的死循环)。
              这个条件取决于**渲染出哪个视图**,不是运行期的"我现在在哪"判断。 */}
          <div
            class="preview-body"
            tabIndex={compare || hasFocusableView(state) ? -1 : 0}
            aria-label={t('preview.bodyLabel')}
          >
            {compare ? (
              <CompareView target={compare} />
            ) : (
              <PreviewBody state={state} path={sel.path} />
            )}
          </div>
          {refPanelOpen.value && <ReferencePanel />}
          {contentPanelOpen.value && <ContentPanel />}
        </div>
        <div
          class="resizer resizer-outline"
          onMouseDown={(e) => onOutlineResize(e as unknown as MouseEvent)}
        />
        <OutlinePanel />
      </div>
      <IntelOverlay />
      <ComparePicker />
    </>
  )
}

/** 该预览视图内部是否已有可聚焦元素(目前只有 CodeMirror 的代码区) */
function hasFocusableView(state: LoadState): boolean {
  if (state.status !== 'ready') return false
  const d = state.data
  return d.kind === 'text' && d.channel !== 'markdown'
}

function PreviewBody({ state, path }: { state: LoadState; path: string[] }) {
  if (state.status === 'idle' || state.status === 'loading') {
    return <div class="preview-placeholder">{t('welcome.loading')}</div>
  }
  if (state.status === 'error') {
    return (
      <div class="preview-error">
        {t('preview.readFailed', { name: state.name, message: state.message })}
        <br />
        {t('preview.readFailedHint')}
      </div>
    )
  }
  const data = state.data
  switch (data.kind) {
    case 'image':
      return <ImageView file={data.file} name={data.name} size={data.size} />
    case 'binary':
      return <BinaryView name={data.name} size={data.size} />
    case 'text': {
      const notice = data.truncated && (
        <div class="preview-notice">
          {t('preview.truncated', { size: formatSize(data.size), limit: formatSize(TRUNCATE_BYTES) })}
          <span class="preview-notice-intel">
            {t('preview.truncatedIntel')}
          </span>
        </div>
      )
      if (data.channel === 'markdown') {
        return (
          <>
            {notice}
            <MarkdownView text={data.text} path={path} />
          </>
        )
      }
      return (
        <>
          {notice}
          <CodeView text={data.text} language={data.language} fileName={data.name} />
        </>
      )
    }
  }
}

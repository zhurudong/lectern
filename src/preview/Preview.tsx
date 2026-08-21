import { useEffect, useState } from 'preact/hooks'
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
        <div>在左侧选择一个文件开始预览</div>
      </div>
    )
  }

  return (
    <>
      <div class="preview-header">
        <NavButtons />
        <span class="file-path">{sel.path.join('/')}</span>
        <span class="spacer" />
        <IntelBadge fileName={sel.name} />
      </div>
      {/* 3.3:"能打开却搜不到"必须是**被解释过的行为**,不能让用户当成缺陷 */}
      {isInExcludedPath(sel.path) && (
        <div class="preview-notice preview-notice-scope">
          此目录默认不参与项目级搜索与跳转(依赖包 / 版本库等重目录)——
          文件可以正常预览与查看大纲,但**不会**出现在文件名搜索、符号搜索与全文搜索结果中。
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
            tabIndex={hasFocusableView(state) ? -1 : 0}
            aria-label="预览区"
          >
            <PreviewBody state={state} path={sel.path} />
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
    return <div class="preview-placeholder">加载中…</div>
  }
  if (state.status === 'error') {
    return (
      <div class="preview-error">
        读取 {state.name} 失败:{state.message}
        <br />
        文件可能已被外部删除或移动,可刷新目录树后重试。
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
          文件过大({formatSize(data.size)}),已截断展示前 {formatSize(TRUNCATE_BYTES)}
          <span class="preview-notice-intel">
            ;该文件超过 5 MB,符号索引受限,大纲与跳转不覆盖此文件
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

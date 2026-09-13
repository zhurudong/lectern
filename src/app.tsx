import { useEffect, useLayoutEffect, useState } from 'preact/hooks'
import { lazy, Suspense } from 'preact/compat'
import { mode, projectView, rootHandle, rootName, goWelcome, selectedFile } from './state'
import { theme, toggleTheme } from './theme'
import { openFolder, openSingleFile } from './lib/access'
import { useResizable } from './lib/useResizable'
import { startIndex, stopIndex } from './search/searchStore'
import { SearchBox } from './search/SearchBox'
import { indexState, indexedFiles, totalSymbols } from './intel/indexStore'
import { clearNavStack } from './intel/navStack'
import { closeReferences } from './intel/references'
import { closeContentSearch } from './search/contentStore'
import { Welcome } from './welcome/Welcome'
import { FileDrop } from './welcome/FileDrop'
import { KeyboardHelp, openHelp } from './help/KeyboardHelp'
import { Tree } from './tree/Tree'
import { Preview } from './preview/Preview'
import { switchProjectView } from './lib/projectViewFocus'
import { LocalFileSettings, openLocalFileSettings } from './local-files/Settings'
import { localFileEntry, LocalFileEntry, syncLocalFileSelection } from './local-files/LocalFileEntry'

const GitComparison = lazy(() => import('./git/GitComparison').then((module) => ({ default: module.GitComparison })))

const AiTerminalEntry = __AI_TERMINAL__
  ? lazy(() => import('./ai/AiTerminal').then((module) => ({ default: module.AiTerminalEntry })))
  : null

const SIDEBAR_KEY = 'cv-sidebar-width'
const SIDEBAR_MIN = 180
const SIDEBAR_MAX = 600

/**
 * 项目级符号索引状态(code-intelligence spec「全项目符号索引」要求展示进度与完成状态,
 * 「索引规模降级」要求降级 MUST NOT 静默发生)。放在顶栏而不是只放预览区 header,
 * 是因为它描述的是整个项目的状态,未打开文件时同样需要可见。
 */
function IndexStatus() {
  const st = indexState.value
  if (st === 'idle') return null
  const text =
    st === 'building'
      ? `索引构建中…已索引 ${indexedFiles.value} 个文件`
      : st === 'done'
        ? `索引已完成(${indexedFiles.value} 个文件 / ${totalSymbols.value} 个符号)`
        : st === 'partial'
          ? `项目过大,符号索引仅部分完成(已索引 ${indexedFiles.value} 个文件)`
          : '符号索引不可用'
  return (
    <span class={`intel-index intel-index-${st}`} title="符号索引状态">
      {text}
    </span>
  )
}

function TopBar({ aiOpen, onOpenAi }: { aiOpen: boolean; onOpenAi: () => void }) {
  const m = mode.value
  return (
    <header class="topbar">
      <span class="app-title">Lectern</span>
      {m === 'project' && <span class="project-name">{rootName.value}</span>}
      {m === 'project' && <IndexStatus />}
      <span class="spacer" />
      {__AI_TERMINAL__ && <button class="ai-toggle" aria-expanded={aiOpen} aria-controls="ai-terminal-panel" onClick={onOpenAi}>AI 终端</button>}
      {m === 'project' && <SearchBox />}
      {m !== 'welcome' && (
        <>
          <button onClick={() => void openFolder()}>打开文件夹</button>
          <button onClick={() => void openSingleFile()}>打开文件</button>
          <button onClick={goWelcome} title="回到入口页">
            首页
          </button>
        </>
      )}
      {/* 3b.4:帮助入口的基线是**界面上可点的按钮**,不依赖任何自定义键位 */}
      <button onClick={openLocalFileSettings}>自动打开</button>
      <button class="help-toggle" title="键盘操作" aria-label="键盘操作" onClick={openHelp}>
        ?
      </button>
      <button class="theme-toggle" title="切换浅色/暗色主题" onClick={toggleTheme}>
        {theme.value === 'light' ? '🌙 暗色' : '☀️ 浅色'}
      </button>
    </header>
  )
}

export function App() {
  const [aiOpen, setAiOpen] = useState(false)
  const m = mode.value
  const activeProjectView = projectView.value
  const root = rootHandle.value
  const selected = selectedFile.value
  useLayoutEffect(() => syncLocalFileSelection(m, selected), [m, selected])
  const [gitSessionRoot, setGitSessionRoot] = useState<FileSystemDirectoryHandle | null>(null)

  // 项目进入/离开时同步文件名索引生命周期,并清空导航栈与引用面板(任务 9.6)
  useEffect(() => {
    clearNavStack()
    closeReferences()
    closeContentSearch()
    if (root) startIndex(root)
    else stopIndex()
  }, [root])

  // Git remains lazy, but once opened its component/worker belong to the current
  // project session rather than the currently visible tab. Hiding it preserves
  // endpoints, the selected diff and CodeMirror's exact reading position.
  useEffect(() => {
    if (m !== 'project' || !root) {
      setGitSessionRoot(null)
      return
    }
    if (activeProjectView === 'changes') {
      setGitSessionRoot(root)
      return
    }
    setGitSessionRoot((current) => current === root ? current : null)
  }, [m, activeProjectView, root])

  // The project-view tab that was clicked is unmounted during the switch.
  // Focus its selected replacement after the new tree commits instead of
  // letting the browser fall back to <body>.
  useEffect(() => {
    if (m !== 'project') return
    let cancelled = false
    let timer = 0
    const focusSelectedView = () => {
      const target = document.querySelector<HTMLButtonElement>(
        `[data-project-view="${activeProjectView}"][aria-current="page"]`,
      )
      if (target) {
        target.focus()
        return
      }
      if (!cancelled) timer = window.setTimeout(focusSelectedView, 25)
    }
    timer = window.setTimeout(focusSelectedView, 0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [m, activeProjectView])

  // 侧栏宽度:与大纲面板共用同一套拖拽 + 持久化实现(见 lib/useResizable)
  const { width: sidebarWidth, onResizeStart } = useResizable({
    storageKey: SIDEBAR_KEY,
    min: SIDEBAR_MIN,
    max: SIDEBAR_MAX,
    defaultWidth: 280,
    grow: 'right',
  })
  const keepGitSession = m === 'project'
    && root != null
    && (activeProjectView === 'changes' || gitSessionRoot === root)

  return (
    <div class="layout">
      <FileDrop />
      <TopBar aiOpen={aiOpen} onOpenAi={() => setAiOpen(true)} />
      <KeyboardHelp />
      <LocalFileSettings />
      <div class="main">
        {m === 'project' && activeProjectView === 'files' && (
          <>
            <aside class="sidebar" style={{ width: `${sidebarWidth}px` }}>
              <nav class="project-view-tabs project-view-tabs-files" aria-label="项目视图">
                <button type="button" class="active" aria-current="page" data-project-view="files" autoFocus>文件</button>
                <button
                  type="button"
                  data-project-view="changes"
                  onClick={() => {
                    if (root) setGitSessionRoot(root)
                    switchProjectView('changes')
                  }}
                >变更</button>
              </nav>
              <Tree />
            </aside>
            <div class="resizer" onMouseDown={(e) => onResizeStart(e as unknown as MouseEvent)} />
          </>
        )}
        {m === 'project' ? (
          <section class="preview" hidden={activeProjectView === 'changes'}><Preview /></section>
        ) : (
          <section class="preview">{m === 'welcome' ? localFileEntry.value ? <LocalFileEntry /> : <Welcome /> : <Preview />}</section>
        )}
        {keepGitSession && root && (
          <div
            class="git-project-view"
            hidden={activeProjectView !== 'changes'}
            key={root}
          >
            <Suspense fallback={<section class="git-comparison"><div class="git-page-state" role="status">正在载入 Git 对比…</div></section>}>
              <GitComparison
                root={root}
                sidebarWidth={sidebarWidth}
                onSidebarResizeStart={onResizeStart}
              />
            </Suspense>
          </div>
        )}
        {__AI_TERMINAL__ && AiTerminalEntry && aiOpen && (
          <Suspense fallback={null}><AiTerminalEntry onClose={() => setAiOpen(false)} /></Suspense>
        )}
      </div>
    </div>
  )
}

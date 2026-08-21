import { useEffect } from 'preact/hooks'
import { mode, rootHandle, rootName, goWelcome } from './state'
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
import { KeyboardHelp, openHelp } from './help/KeyboardHelp'
import { Tree } from './tree/Tree'
import { Preview } from './preview/Preview'

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

function TopBar() {
  const m = mode.value
  return (
    <header class="topbar">
      <span class="app-title">Lectern</span>
      {m === 'project' && <span class="project-name">{rootName.value}</span>}
      {m === 'project' && <IndexStatus />}
      <span class="spacer" />
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
  const m = mode.value
  const root = rootHandle.value

  // 项目进入/离开时同步文件名索引生命周期,并清空导航栈与引用面板(任务 9.6)
  useEffect(() => {
    clearNavStack()
    closeReferences()
    closeContentSearch()
    if (root) startIndex(root)
    else stopIndex()
  }, [root])

  // 侧栏宽度:与大纲面板共用同一套拖拽 + 持久化实现(见 lib/useResizable)
  const { width: sidebarWidth, onResizeStart } = useResizable({
    storageKey: SIDEBAR_KEY,
    min: SIDEBAR_MIN,
    max: SIDEBAR_MAX,
    defaultWidth: 280,
    grow: 'right',
  })

  return (
    <div class="layout">
      <TopBar />
      <KeyboardHelp />
      <div class="main">
        {m === 'project' && (
          <>
            <aside class="sidebar" style={{ width: `${sidebarWidth}px` }}>
              <Tree />
            </aside>
            <div class="resizer" onMouseDown={(e) => onResizeStart(e as unknown as MouseEvent)} />
          </>
        )}
        <section class="preview">{m === 'welcome' ? <Welcome /> : <Preview />}</section>
      </div>
    </div>
  )
}

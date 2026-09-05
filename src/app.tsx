import { useEffect } from 'preact/hooks'
import { lazy, Suspense } from 'preact/compat'
import { mode, projectView, rootHandle, rootName, goWelcome } from './state'
import { theme, toggleTheme } from './theme'
import { lang, toggleLang, t } from './i18n'
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
import { startGitWorker, stopGitWorker } from './git/workerClient'
import { switchProjectView } from './lib/projectViewFocus'

const GitComparison = lazy(() => import('./git/GitComparison').then((module) => ({ default: module.GitComparison })))

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
      ? t('index.building', { n: indexedFiles.value })
      : st === 'done'
        ? t('index.done', { files: indexedFiles.value, symbols: totalSymbols.value })
        : st === 'partial'
          ? t('index.partial', { n: indexedFiles.value })
          : t('index.unavailable')
  return (
    <span class={`intel-index intel-index-${st}`} title={t('index.statusTitle')}>
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
          <button onClick={() => void openFolder()}>{t('welcome.openFolder')}</button>
          <button onClick={() => void openSingleFile()}>{t('welcome.openFile')}</button>
          <button onClick={goWelcome} title={t('topbar.homeTitle')}>
            {t('topbar.home')}
          </button>
        </>
      )}
      {/* 3b.4:帮助入口的基线是**界面上可点的按钮**,不依赖任何自定义键位 */}
      <button class="help-toggle" title={t('topbar.helpTitle')} aria-label={t('topbar.helpTitle')} onClick={openHelp}>
        ?
      </button>
      <button class="theme-toggle" title={t('topbar.themeTitle')} onClick={toggleTheme}>
        {theme.value === 'light' ? t('topbar.themeDark') : t('topbar.themeLight')}
      </button>
      {/* i18n 语言开关(样板):切换即时重渲染已接入 i18n 的面板(当前为入口页)。
          最终态见 add-english-ui-i18n 方案 —— 全量迁移后此开关切换整个界面语言。 */}
      <button class="lang-toggle" title={t('topbar.langToggleTitle')} aria-label={t('topbar.langToggleTitle')} onClick={toggleLang}>
        {lang.value === 'zh' ? 'EN' : '中'}
      </button>
    </header>
  )
}

export function App() {
  const m = mode.value
  const activeProjectView = projectView.value
  const root = rootHandle.value

  // 项目进入/离开时同步文件名索引生命周期,并清空导航栈与引用面板(任务 9.6)
  useEffect(() => {
    clearNavStack()
    closeReferences()
    closeContentSearch()
    if (root) startIndex(root)
    else stopIndex()
  }, [root])

  // Git parsing is a separate, lazy worker path. Merely opening a project keeps
  // the normal file reader unchanged; entering/leaving changes owns its worker.
  useEffect(() => {
    if (m !== 'project' || activeProjectView !== 'changes' || !root) {
      stopGitWorker()
      return
    }
    startGitWorker()
    return stopGitWorker
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

  return (
    <div class="layout">
      <TopBar />
      <KeyboardHelp />
      <div class="main">
        {m === 'project' && activeProjectView === 'files' && (
          <>
            <aside class="sidebar" style={{ width: `${sidebarWidth}px` }}>
              <nav class="project-view-tabs project-view-tabs-files" aria-label={t('app.projectViewLabel')}>
                <button type="button" class="active" aria-current="page" data-project-view="files" autoFocus>{t('app.tabFiles')}</button>
                <button type="button" data-project-view="changes" onClick={() => switchProjectView('changes')}>{t('app.tabChanges')}</button>
              </nav>
              <Tree />
            </aside>
            <div class="resizer" onMouseDown={(e) => onResizeStart(e as unknown as MouseEvent)} />
          </>
        )}
        {m === 'project' && activeProjectView === 'changes' && root ? (
          <Suspense fallback={<section class="git-comparison"><div class="git-page-state" role="status">{t('app.loadingGit')}</div></section>}>
            <GitComparison root={root} />
          </Suspense>
        ) : (
          <section class="preview">{m === 'welcome' ? <Welcome /> : <Preview />}</section>
        )}
      </div>
    </div>
  )
}

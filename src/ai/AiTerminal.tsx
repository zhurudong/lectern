import { t, lang } from '../i18n'
import { useEffect, useRef, useState } from 'preact/hooks'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { useOverlayKeyboard } from '../lib/useOverlayKeyboard'
import { useResizable } from '../lib/useResizable'
import { rootHandle } from '../state'
import { theme } from '../theme'
import { connectAgent, type AgentSettings } from './agentClient'
import { projectIdentity, type AgentProject } from './projects'
import '@xterm/xterm/css/xterm.css'
import './ai.css'

const KEY = 'lectern-ai-settings-v1'
const DOCK_KEY = 'lectern-ai-terminal-dock'
const INTRO_KEY = 'lectern-ai-terminal-intro-seen'
type Dock = 'right' | 'bottom'
type Status = { kind: 'waiting' | 'ready' | 'exit' | 'error'; key: string; params?: Record<string, string | number> }
function savedDock(): Dock {
  try { return localStorage.getItem(DOCK_KEY) === 'bottom' ? 'bottom' : 'right' }
  catch { return 'right' }
}
function terminalTheme() {
  const css = getComputedStyle(document.documentElement)
  const token = (name: string) => css.getPropertyValue(name).trim()
  return { background: token('--bg'), foreground: token('--fg'), cursor: token('--fg'),
    cursorAccent: token('--bg'), selectionBackground: token('--bg-selected') }
}
function Icon({ name }: { name: 'terminal' | 'reconnect' | 'settings' | 'bottom' | 'right' | 'close' }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    {name === 'terminal' && <><path d="m4 6 5 5-5 5" /><path d="M12 17h8" /></>}
    {name === 'reconnect' && <><path d="M20 7v5h-5" /><path d="M19 12a7 7 0 1 0-2 5M20 12a8 8 0 0 0-2-6" /></>}
    {name === 'settings' && <><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="2" fill="var(--bg-sidebar)" /><circle cx="15" cy="17" r="2" fill="var(--bg-sidebar)" /></>}
    {(name === 'bottom' || name === 'right') && <><rect x="3" y="4" width="18" height="16" rx="2" /><path d={name === 'bottom' ? 'M3 14h18' : 'M14 4v16'} /></>}
    {name === 'close' && <path d="m6 6 12 12M18 6 6 18" />}
  </svg>
}
function savedSettings(): AgentSettings {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (value && typeof value.cmd === 'string') {
      // Deliberately discard v1's global cwd: it was not associated with a root.
      return { cmd: value.cmd }
    }
  } catch { /* show installation guidance when storage is unavailable */ }
  return { cmd: 'codex' }
}

export function AiTerminalEntry({ onClose }: { onClose: () => void }) {
  const root = rootHandle.value
  return <AiTerminal key={root ?? 'standalone'} root={root} onClose={onClose} />
}

function AiTerminal({ root, onClose }: { root: FileSystemDirectoryHandle | null; onClose: () => void }) {
  const [settings, setSettings] = useState(savedSettings)
  const [session, setSession] = useState(() => ({ ...savedSettings(), reselect: false }))
  const [project, setProject] = useState<AgentProject | null>(null)
  const [cwd, setCwd] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'waiting', key: 'release.identifying_the_current_project' })
  const [errorCode, setErrorCode] = useState('')
  const [agents, setAgents] = useState<string[]>([])
  const [version, setVersion] = useState('')
  const [dock, setDock] = useState(savedDock)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [showIntro, setShowIntro] = useState(() => {
    try { return localStorage.getItem(INTRO_KEY) !== '1' } catch { return true }
  })
  const host = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const currentTheme = theme.value
  const [available, setAvailable] = useState(() => ({ width: Math.max(0, innerWidth - 124), height: Math.max(0, innerHeight - 164) }))
  const horizontal = useResizable({
    storageKey: 'lectern-ai-terminal-width', min: Math.min(280, available.width), max: available.width, defaultWidth: 480, grow: 'left',
  })
  const vertical = useResizable({
    storageKey: 'lectern-ai-terminal-height', min: Math.min(160, available.height), max: available.height, defaultWidth: 300, grow: 'up',
  })
  const resize = dock === 'right' ? horizontal : vertical
  const keyboard = useOverlayKeyboard({ open: true, count: 0, idPrefix: 'ai-terminal', onActivate: () => {}, onClose })
  useEffect(() => {
    const workspace = keyboard.containerRef.current?.parentElement
    if (!workspace) return
    const measure = () => {
      // The tree is outside this workspace. Reserve 120 px of reading space
      // and the 4 px divider on either axis, even after the viewport shrinks.
      setAvailable({ width: Math.max(0, workspace.clientWidth - 124), height: Math.max(0, workspace.clientHeight - 124) })
    }
    const observer = new ResizeObserver(measure)
    observer.observe(workspace)
    measure()
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    let cancelled = false
    void projectIdentity(root).then((value) => { if (!cancelled) setProject(value) },
      () => { if (!cancelled) setStatus({ kind: 'error', key: 'release.cannot_save_the_project_association_check' }) })
    return () => { cancelled = true }
  }, [root])
  useEffect(() => {
    if (!project || !host.current) return
    if (!/Mac/.test(navigator.platform)) { setStatus({ kind: 'error', key: 'ai.unsupported' }); return }
    const terminal = new Terminal({ cursorBlink: true, fontSize: 13, scrollback: 5000,
      theme: terminalTheme(), minimumContrastRatio: 4.5 })
    terminalRef.current = terminal
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(host.current)
    fit.fit()
    let client: ReturnType<typeof connectAgent> | undefined
    setCwd('')
    setErrorCode('')
    try {
      client = connectAgent(session, project, terminal.cols, terminal.rows, (message) => {
        if (message.type === 'data') terminal.write(message.data)
        if (message.type === 'waiting') setStatus({ kind: 'waiting', key: message.code === 'starting' ? 'ai.starting' : message.code === 'reconnecting' ? 'ai.reconnecting' : 'ai.wait' })
        if (message.type === 'project') setCwd(message.cwd)
        if (message.type === 'hello') { setAgents(message.agents); setVersion(message.version) }
        if (message.type === 'ready') {
          setStatus({ kind: 'ready', key: 'release.connected' })
          client?.resize(terminal.cols, terminal.rows)
          // A dock does not own the entire page: a late connection must not
          // steal focus from code the user has already returned to reading.
          if (keyboard.containerRef.current?.contains(document.activeElement)) terminal.focus()
        }
        if (message.type === 'exit') setStatus({ kind: 'exit', key: 'ai.exit', params: { code: message.code } })
        if (message.type === 'error') {
          setStatus({ kind: 'error', key: `ai.error.${['version', 'agent_missing', 'host_missing', 'host_forbidden', 'host_start', 'cancelled'].includes(message.code ?? '') ? message.code : 'operation'}`, params: { cmd: session.cmd } })
          setErrorCode(message.code ?? '')
          if (message.code === 'agent_missing') setSettingsOpen(true)
        }
      }, session.reselect)
    } catch { setStatus({ kind: 'error', key: 'ai.error.operation' }) }
    const input = terminal.onData((data) => client?.input(data))
    const resize = terminal.onResize(({ cols, rows }) => client?.resize(cols, rows))
    const observer = new ResizeObserver(() => fit.fit())
    observer.observe(host.current)
    return () => { observer.disconnect(); input.dispose(); resize.dispose(); client?.dispose(); terminalRef.current = null; terminal.dispose() }
  }, [session, project])
  useEffect(() => {
    if (terminalRef.current) terminalRef.current.options.theme = terminalTheme()
  }, [currentTheme])
  const reconnect = (reselect = false) => {
    const next = { ...settings }
    try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { setStatus({ kind: 'error', key: 'release.cannot_save_terminal_settings' }); return }
    setSettings(next)
    setSettingsOpen(false)
    setSession({ ...next, reselect })
  }
  const switchDock = () => {
    const next = dock === 'right' ? 'bottom' : 'right'
    setDock(next)
    try { localStorage.setItem(DOCK_KEY, next) } catch { /* keep layout usable without persistence */ }
  }
  const dismissIntro = () => {
    setShowIntro(false)
    try { localStorage.setItem(INTRO_KEY, '1') } catch { /* show it again next time */ }
  }
  const statusText = t(status.key, status.params)
  const dockLabel = t(dock === 'right' ? 'ai.dockBottom' : 'ai.dockRight')
  const resizeLabel = t(dock === 'right' ? 'release.resize_terminal' : 'ai.resizeHeight')
  return <>
    <div class="resizer ai-resizer" data-dock={dock} role="separator" aria-label={resizeLabel} title={resizeLabel}
      aria-orientation={dock === 'right' ? 'vertical' : 'horizontal'} tabIndex={0}
      aria-valuenow={Math.round(resize.width)} aria-valuemin={Math.min(dock === 'right' ? 280 : 160, dock === 'right' ? available.width : available.height)}
      aria-valuemax={Math.round(dock === 'right' ? available.width : available.height)} aria-controls="ai-terminal-panel"
      onMouseDown={resize.onResizeStart} onKeyDown={resize.onResizeKeyDown} />
    <div id="ai-terminal-panel" class="ai-panel" data-dock={dock} role="complementary"
      style={{ '--ai-terminal-width': `${horizontal.width}px`, '--ai-terminal-height': `${vertical.width}px` }} aria-label={t('release.ai_terminal')} tabIndex={-1} ref={keyboard.containerRef}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (!(event.target as HTMLElement).closest('.xterm') && event.key === 'Escape') {
          if (settingsOpen) { event.preventDefault(); setSettingsOpen(false); keyboard.containerRef.current?.querySelector<HTMLButtonElement>('.ai-settings-toggle')?.focus() }
          else keyboard.onKeyDown(event)
        }
      }}>
      <div class="ai-heading">
        <span class="ai-title" title={cwd || root?.name || t('release.standalone_terminal')}><Icon name="terminal" /><strong>{session.cmd.split(/[\\/]/).pop()}</strong><span class="ai-project">{root?.name ?? t('release.standalone_terminal')}</span></span>
        <span class={`ai-status ai-status-${status.kind}`} role="status" title={statusText} aria-label={statusText}><span class="ai-visually-hidden">{statusText}</span></span>
        <div class="ai-actions">
          <button class="ai-reconnect" aria-label={t('release.reconnect')} title={t('ai.reconnectHint')} onClick={() => reconnect()}><Icon name="reconnect" /></button>
          <button class="ai-dock-toggle" aria-label={dockLabel} title={dockLabel} onClick={switchDock}><Icon name={dock === 'right' ? 'bottom' : 'right'} /></button>
          <button class="ai-settings-toggle" aria-label={t('ai.settings')} title={t('ai.settings')} aria-expanded={settingsOpen} aria-controls="ai-settings" onClick={() => setSettingsOpen(!settingsOpen)}><Icon name="settings" /></button>
          <button aria-label={t('release.close_ai_terminal')} title={t('release.close_end_session')} onClick={keyboard.close}><Icon name="close" /></button>
        </div>
      </div>
      <div class="ai-context">
      {showIntro && <div class="ai-intro"><span>{t('ai.localNotice')}</span><button aria-label={t('ai.dismissNotice')} onClick={dismissIntro}><Icon name="close" /></button></div>}
      {status.kind !== 'ready' && <div class={`ai-message ai-message-${status.kind}`}>{statusText}</div>}
      {['host_missing', 'host_start', 'host_forbidden', 'version'].includes(errorCode) && <div class="ai-onboarding">
        <strong>{t('release.install_the_local_companion_once')}</strong>
        <p>{t('release.download_and_open_the_macos_installer')}</p>
        <a href={lang.value === 'en' ? 'native-setup.en.html' : 'native-setup.html'} target="_blank" rel="noopener noreferrer">{t('release.installation_and_update_guide')}</a>
      </div>}
      {errorCode === 'agent_missing' && <div class="ai-onboarding">
        <strong>{t('release.set_up_an_ai_cli')}</strong>
        <p>{t('release.detected_on_this_mac')}{agents.join('、') || t('release.none')}{t('release.connect_here_after_installation_and_follow')}</p>
        <a href="https://developers.openai.com/codex/cli/" target="_blank" rel="noopener noreferrer">{t('release.install_codex')}</a>{' · '}
        <a href="https://code.claude.com/docs/en/quickstart" target="_blank" rel="noopener noreferrer">{t('release.install_claude_code')}</a>
      </div>}
      {settingsOpen && <div id="ai-settings" class="ai-settings">
        <strong>{t('release.agent_and_folder_settings')}</strong>
        <form onSubmit={(event) => { event.preventDefault(); reconnect() }}>
          <label>{t('release.agent_executable')}<input name="cmd" list="ai-agents" required value={settings.cmd} onInput={(e) => setSettings({ ...settings, cmd: e.currentTarget.value })} /></label>
          <datalist id="ai-agents"><option value="codex" /><option value="claude" /></datalist>
          <span>{t('release.enter_codex_claude_or_the_absolute')}</span>
          <button type="submit">{t('release.save_and_connect')}</button>
        </form>
        <div class="ai-folder"><span class="ai-cwd">{cwd || t('release.on_first_use_select_the_same')}</span><button onClick={() => reconnect(true)}>{t('release.change_associated_folder')}</button></div>
        <p>{t('release.associate_each_project_once_samename_projects')}</p>
        <p class="ai-disclosure">{t('release.this_terminal_connects_to_a_local')}{session.cmd} {t('release.under_its_own_settings_the_agent')}</p>
        <a href={lang.value === 'en' ? 'native-setup.en.html' : 'native-setup.html'} target="_blank" rel="noopener noreferrer">{t('release.install_update_and_uninstall')}</a>
        {version && <span class="ai-version">{t('ai.versionLabel', { version })}</span>}
      </div>}
      </div>
      <div class="ai-terminal-host" ref={host} />
    </div>
  </>
}

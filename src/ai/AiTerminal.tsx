import { t, lang } from '../i18n'
import { useEffect, useRef, useState } from 'preact/hooks'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { useOverlayKeyboard } from '../lib/useOverlayKeyboard'
import { useResizable } from '../lib/useResizable'
import { rootHandle } from '../state'
import { connectAgent, type AgentSettings } from './agentClient'
import { projectIdentity, type AgentProject } from './projects'
import '@xterm/xterm/css/xterm.css'
import './ai.css'

const KEY = 'lectern-ai-settings-v1'
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
  const [status, setStatus] = useState(t('release.identifying_the_current_project'))
  const [errorCode, setErrorCode] = useState('')
  const [agents, setAgents] = useState<string[]>([])
  const [version, setVersion] = useState('')
  const host = useRef<HTMLDivElement>(null)
  const [maxWidth, setMaxWidth] = useState(() => Math.max(0, window.innerWidth - 120))
  const { width, onResizeStart } = useResizable({
    storageKey: 'lectern-ai-terminal-width', min: Math.min(280, maxWidth), max: maxWidth, defaultWidth: 480, grow: 'left',
  })
  const keyboard = useOverlayKeyboard({ open: true, count: 0, idPrefix: 'ai-terminal', onActivate: () => {}, onClose })
  useEffect(() => {
    const panel = keyboard.containerRef.current
    const main = panel?.parentElement
    if (!panel || !main) return
    const measure = () => {
      // Keep 120 px for the reader after the tree and separators take their space.
      const fixedWidth = [...main.children].reduce((total, child) =>
        child === panel || child.matches('.preview, .git-project-view')
          ? total : total + child.getBoundingClientRect().width, 0)
      setMaxWidth(Math.max(0, main.clientWidth - fixedWidth - 120))
    }
    const observer = new ResizeObserver(measure)
    observer.observe(main)
    for (const child of main.children) observer.observe(child)
    const children = new MutationObserver(() => {
      for (const child of main.children) observer.observe(child)
      measure()
    })
    children.observe(main, { childList: true })
    measure()
    return () => { observer.disconnect(); children.disconnect() }
  }, [])
  useEffect(() => {
    let cancelled = false
    void projectIdentity(root).then((value) => { if (!cancelled) setProject(value) },
      () => { if (!cancelled) setStatus(t('release.cannot_save_the_project_association_check')) })
    return () => { cancelled = true }
  }, [root])
  useEffect(() => {
    if (!project || !host.current) return
    if (!/Mac/.test(navigator.platform)) { setStatus(t('ai.unsupported')); return }
    const terminal = new Terminal({ cursorBlink: true, fontSize: 13, scrollback: 5000 })
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
        if (message.type === 'waiting') setStatus(t(message.code === 'starting' ? 'ai.starting' : message.code === 'reconnecting' ? 'ai.reconnecting' : 'ai.wait'))
        if (message.type === 'project') setCwd(message.cwd)
        if (message.type === 'hello') { setAgents(message.agents); setVersion(message.version) }
        if (message.type === 'ready') {
          setStatus(t('release.connected'))
          client?.resize(terminal.cols, terminal.rows)
          // A dock does not own the entire page: a late connection must not
          // steal focus from code the user has already returned to reading.
          if (keyboard.containerRef.current?.contains(document.activeElement)) terminal.focus()
        }
        if (message.type === 'exit') setStatus(t('ai.exit', { code: message.code }))
        if (message.type === 'error') { setStatus(t(`ai.error.${['version', 'agent_missing', 'host_missing', 'host_forbidden', 'host_start', 'cancelled'].includes(message.code ?? '') ? message.code : 'operation'}`, { cmd: session.cmd })); setErrorCode(message.code ?? '') }
      }, session.reselect)
    } catch (error) { setStatus(String(error)) }
    const input = terminal.onData((data) => client?.input(data))
    const resize = terminal.onResize(({ cols, rows }) => client?.resize(cols, rows))
    const observer = new ResizeObserver(() => fit.fit())
    observer.observe(host.current)
    return () => { observer.disconnect(); input.dispose(); resize.dispose(); client?.dispose(); terminal.dispose() }
  }, [session, project])
  const reconnect = (reselect = false) => {
    const next = { ...settings }
    try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { setStatus(t('release.cannot_save_terminal_settings')); return }
    setSettings(next)
    setSession({ ...next, reselect })
  }
  return <>
    <div class="resizer ai-resizer" role="separator" aria-label={t('release.resize_terminal')} aria-orientation="vertical"
      onMouseDown={onResizeStart} />
    <div id="ai-terminal-panel" class="ai-panel" role="complementary" style={{ '--ai-terminal-width': `${width}px` }} aria-label={t('release.ai_terminal')} tabIndex={-1} ref={keyboard.containerRef}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (!(event.target as HTMLElement).closest('.xterm') && event.key === 'Escape') keyboard.onKeyDown(event)
      }}>
      <div class="ai-heading"><strong>{t('release.ai_terminal_6')}{root?.name ?? t('release.standalone_terminal')}</strong><button aria-label={t('release.close_ai_terminal')} onClick={keyboard.close}>{t('release.close_end_session')}</button></div>
      <p class="ai-disclosure">{t('release.this_terminal_connects_to_a_local')}{session.cmd} {t('release.under_its_own_settings_the_agent')}</p>
      <div class="ai-actions">
        <span class="ai-cwd">{cwd || t('release.on_first_use_select_the_same')}</span>
        <button onClick={() => reconnect()}>{t('release.reconnect')}</button>
        <button onClick={() => reconnect(true)}>{t('release.change_associated_folder')}</button>
      </div>
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
      <details open={errorCode === 'agent_missing'}>
        <summary>{t('release.agent_and_folder_settings')}{version ? ` · ${t('ai.versionLabel', { version })}` : ''}</summary>
        <p>{t('release.associate_each_project_once_samename_projects')}</p>
        <form onSubmit={(event) => { event.preventDefault(); reconnect() }}>
          <label>{t('release.agent_executable')}<input name="cmd" list="ai-agents" required value={settings.cmd} onInput={(e) => setSettings({ ...settings, cmd: e.currentTarget.value })} /></label>
          <datalist id="ai-agents"><option value="codex" /><option value="claude" /></datalist>
          <span>{t('release.enter_codex_claude_or_the_absolute')}</span>
          <button type="submit">{t('release.save_and_connect')}</button>
        </form>
        <a href={lang.value === 'en' ? 'native-setup.en.html' : 'native-setup.html'} target="_blank" rel="noopener noreferrer">{t('release.install_update_and_uninstall')}</a>
      </details>
      <div class="ai-status" role="status">{status}</div>
      <div class="ai-terminal-host" ref={host} />
    </div>
  </>
}

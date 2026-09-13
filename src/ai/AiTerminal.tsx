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
  const [status, setStatus] = useState('正在识别当前项目…')
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
      () => { if (!cancelled) setStatus('无法保存项目关联，请检查浏览器存储后重新打开面板。') })
    return () => { cancelled = true }
  }, [root])
  useEffect(() => {
    if (!project || !host.current) return
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
        if (message.type === 'waiting') setStatus(message.message)
        if (message.type === 'project') setCwd(message.cwd)
        if (message.type === 'hello') { setAgents(message.agents); setVersion(message.version) }
        if (message.type === 'ready') {
          setStatus('已连接')
          client?.resize(terminal.cols, terminal.rows)
          // A dock does not own the entire page: a late connection must not
          // steal focus from code the user has already returned to reading.
          if (keyboard.containerRef.current?.contains(document.activeElement)) terminal.focus()
        }
        if (message.type === 'exit') setStatus(`会话已结束 (${message.code})，点击重新连接可启动新会话。`)
        if (message.type === 'error') { setStatus(message.message); setErrorCode(message.code ?? '') }
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
    try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { setStatus('无法保存终端设置'); return }
    setSettings(next)
    setSession({ ...next, reselect })
  }
  return <>
    <div class="resizer ai-resizer" role="separator" aria-label="调整终端宽度" aria-orientation="vertical"
      onMouseDown={onResizeStart} />
    <div id="ai-terminal-panel" class="ai-panel" role="complementary" style={{ '--ai-terminal-width': `${width}px` }} aria-label="AI 终端" tabIndex={-1} ref={keyboard.containerRef}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (!(event.target as HTMLElement).closest('.xterm') && event.key === 'Escape') keyboard.onKeyDown(event)
      }}>
      <div class="ai-heading"><strong>AI 终端 · {root?.name ?? '独立终端'}</strong><button aria-label="关闭 AI 终端" onClick={keyboard.close}>关闭（结束会话）</button></div>
      <p class="ai-disclosure">AI 终端连接本地伴随程序；你的代码由 {session.cmd} 按其自身设置处理。Agent 以你的用户权限运行，可修改文件。</p>
      <div class="ai-actions">
        <span class="ai-cwd">{cwd || '首次使用此项目时，请选择与阅读项目相同的本机目录。'}</span>
        <button onClick={() => reconnect()}>重新连接</button>
        <button onClick={() => reconnect(true)}>更换关联目录</button>
      </div>
      {['host_missing', 'host_start', 'host_forbidden', 'version'].includes(errorCode) && <div class="ai-onboarding">
        <strong>安装本机伴随程序（仅首次需要）</strong>
        <p>下载并打开 macOS 安装包，按系统提示完成安装，再点击“重新连接”。无需安装 Node.js 或启动后台服务。</p>
        <a href="native-setup.html" target="_blank" rel="noopener noreferrer">安装与更新指引</a>
      </div>}
      {errorCode === 'agent_missing' && <div class="ai-onboarding">
        <strong>准备一个 AI CLI</strong>
        <p>本机已检测到：{agents.join('、') || '暂无'}。安装后在此连接，按 CLI 自身提示登录；已有登录可直接使用。</p>
        <a href="https://developers.openai.com/codex/cli/" target="_blank" rel="noopener noreferrer">安装 Codex</a>{' · '}
        <a href="https://code.claude.com/docs/en/quickstart" target="_blank" rel="noopener noreferrer">安装 Claude Code</a>
      </div>}
      <details open={errorCode === 'agent_missing'}>
        <summary>Agent 与目录设置{version ? ` · 伴随程序 ${version}` : ''}</summary>
        <p>每个项目首次关联一次目录；同名项目分别关联。关闭面板会结束会话，重新连接将启动新会话。</p>
        <form onSubmit={(event) => { event.preventDefault(); reconnect() }}>
          <label>Agent 可执行文件<input name="cmd" list="ai-agents" required value={settings.cmd} onInput={(e) => setSettings({ ...settings, cmd: e.currentTarget.value })} /></label>
          <datalist id="ai-agents"><option value="codex" /><option value="claude" /></datalist>
          <span>可填写 codex、claude 或已安装程序的绝对路径。</span>
          <button type="submit">保存并连接</button>
        </form>
        <a href="native-setup.html" target="_blank" rel="noopener noreferrer">安装、更新与卸载</a>
      </details>
      <div class="ai-status" role="status">{status}</div>
      <div class="ai-terminal-host" ref={host} />
    </div>
  </>
}

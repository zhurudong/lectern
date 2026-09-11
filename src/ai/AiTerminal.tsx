import { useEffect, useRef, useState } from 'preact/hooks'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { useOverlayKeyboard } from '../lib/useOverlayKeyboard'
import { connectAgent, type AgentSettings } from './agentClient'
import '@xterm/xterm/css/xterm.css'
import './ai.css'

const KEY = 'lectern-ai-settings-v1'
function savedSettings(): AgentSettings {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (value && Number.isInteger(value.port) && ['token', 'cwd', 'cmd'].every((key) => typeof value[key] === 'string')) return value
  } catch { /* unavailable storage or corrupt settings: show pairing form */ }
  return { port: 8137, token: '', cwd: '', cmd: 'codex' }
}

export function AiTerminalEntry() {
  const [open, setOpen] = useState(false)
  return <>
    <button class="ai-toggle" onClick={() => setOpen(true)}>AI 终端</button>
    {open && <AiTerminal onClose={() => setOpen(false)} />}
  </>
}

function AiTerminal({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState(savedSettings)
  const [session, setSession] = useState<AgentSettings | null>(() => {
    const saved = savedSettings()
    return saved.token && saved.cwd ? saved : null
  })
  const [status, setStatus] = useState('首次使用请填写配对信息')
  const host = useRef<HTMLDivElement>(null)
  const keyboard = useOverlayKeyboard({ open: true, count: 0, idPrefix: 'ai-terminal', onActivate: () => {}, onClose })
  useEffect(() => {
    if (!session || !host.current) return
    const terminal = new Terminal({ cursorBlink: true, fontSize: 13, scrollback: 5000 })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(host.current)
    fit.fit()
    let finished = false
    let client: ReturnType<typeof connectAgent> | undefined
    let ready = false
    setStatus('正在连接本地伴随程序…')
    try {
      client = connectAgent(session, terminal.cols, terminal.rows, (message) => {
        if (message.type === 'data') terminal.write(message.data)
        if (message.type === 'ready') {
          ready = true
          setStatus('已连接')
          client?.resize(terminal.cols, terminal.rows)
          terminal.focus()
        }
        if (message.type === 'exit') { finished = true; ready = false; setStatus(`会话已结束 (${message.code})`) }
        if (message.type === 'error') { finished = true; ready = false; setStatus(message.message) }
      }, () => {
        ready = false
        if (!finished) setStatus('连接已断开或无法连接。请先运行 lectern-agent，并检查端口、token 和 Origin。')
      })
    } catch (error) { setStatus(String(error)) }
    const input = terminal.onData((data) => { if (ready) client?.input(data) })
    const resize = terminal.onResize(({ cols, rows }) => { if (ready) client?.resize(cols, rows) })
    const observer = new ResizeObserver(() => fit.fit())
    observer.observe(host.current)
    return () => { observer.disconnect(); input.dispose(); resize.dispose(); client?.dispose(); terminal.dispose() }
  }, [session])

  const field = (key: keyof AgentSettings, value: string) => setSettings({ ...settings, [key]: key === 'port' ? Number(value) : value })
  return <div class="ai-backdrop">
    <div class="ai-panel" role="dialog" aria-modal="true" aria-label="AI 终端" tabIndex={-1} ref={keyboard.containerRef}
      onKeyDown={(event) => {
        // PTY owns arrows, Enter, Esc and Ctrl-C. Esc only closes outside xterm;
        // stop bubbling so application shortcuts never consume terminal input.
        event.stopPropagation()
        if (!(event.target as HTMLElement).closest('.xterm') && event.key === 'Escape') keyboard.onKeyDown(event)
      }}>
      <div class="ai-heading"><strong>AI 终端</strong><button aria-label="关闭 AI 终端" onClick={keyboard.close}>关闭（结束会话）</button></div>
      <p class="ai-disclosure">AI 终端连接本地伴随程序；你的代码由 {session?.cmd ?? settings.cmd} 按其自身设置处理。Agent 以你的用户权限运行，可修改文件。</p>
      <details open={!session}>
        <summary>配对与设置</summary>
        <p>先运行 <code>lectern-agent --origin {location.origin}</code>，将 <code>~/.lectern-agent/token</code> 中的 token 填入下方。浏览器无法读取目录绝对路径，请手动填写并确认与阅读项目一致。</p>
        <form onSubmit={(event) => {
          event.preventDefault()
          try { localStorage.setItem(KEY, JSON.stringify(settings)) } catch { setStatus('无法保存配对信息'); return }
          setSession({ ...settings })
        }}>
          <label>端口<input name="port" type="number" min="1" max="65535" required value={settings.port} onInput={(e) => field('port', e.currentTarget.value)} /></label>
          <label>Token<input name="token" type="password" autoComplete="off" required minLength={32} value={settings.token} onInput={(e) => field('token', e.currentTarget.value)} /></label>
          <label>项目绝对路径<input name="cwd" required placeholder="/absolute/path/to/project" value={settings.cwd} onInput={(e) => field('cwd', e.currentTarget.value)} /></label>
          <label>Agent 可执行文件<input name="cmd" required value={settings.cmd} onInput={(e) => field('cmd', e.currentTarget.value)} /></label>
          <button type="submit">保存并连接</button>
        </form>
      </details>
      <div class="ai-status" role="status">{status}</div>
      <div class="ai-terminal-host" ref={host} />
    </div>
  </div>
}

import type { AgentProject } from './projects'
export interface AgentSettings { cmd: string }
export type AgentMessage = { type: 'ready' } | { type: 'data'; data: string }
  | { type: 'exit'; code: number } | { type: 'error'; message: string; code?: string }
  | { type: 'waiting'; message: string } | { type: 'project'; cwd: string }
  | { type: 'hello'; version: string; agents: string[] }

export function connectAgent(settings: AgentSettings, project: AgentProject, cols: number, rows: number,
  receive: (message: AgentMessage) => void, reselect = false) {
  let disposed = false, stopped = false, ready = false, greeted = false
  let port: chrome.runtime.Port | undefined, timer = 0, handshakeTimer = 0, attempts = 0
  const send = (message: object) => port?.postMessage(message)
  const connect = () => {
    if (disposed || stopped) return
    ready = false; greeted = false
    receive({ type: 'waiting', message: '正在启动本机伴随程序…' })
    port = chrome.runtime.connectNative('com.lectern.agent')
    port.onMessage.addListener((message) => {
      if (disposed || stopped) return
      if (message.type === 'hello') {
        if (message.protocol !== 1 || !Array.isArray(message.agents) || !message.agents.every((agent: unknown) => typeof agent === 'string')) { stopped = true; receive({ type: 'error', code: 'version', message: '伴随程序版本不兼容，请下载更新。' }); port?.disconnect(); return }
        window.clearTimeout(handshakeTimer)
        greeted = true
        receive({ type: 'hello', version: message.version, agents: message.agents })
        if (!message.agents.includes(settings.cmd) && !settings.cmd.startsWith('/')) {
          stopped = true; receive({ type: 'error', code: 'agent_missing', message: `尚未安装 ${settings.cmd}，请选择已安装的 Agent 或按指引安装。` }); port?.disconnect(); return
        }
        send({ type: 'project', ...project, reselect })
      } else if (message.type === 'project' && message.id === project.id) {
        reselect = false; receive({ type: 'project', cwd: message.cwd })
        send({ type: 'start', projectId: project.id, cmd: settings.cmd, cols, rows })
      } else if (message.type === 'ready') { ready = true; attempts = 0; receive(message) }
      else if (message.type === 'data' || message.type === 'waiting') receive(message)
      else if (message.type === 'exit' || message.type === 'error') { stopped = true; ready = false; receive(message); port?.disconnect() }
    })
    port.onDisconnect.addListener(() => {
      window.clearTimeout(handshakeTimer)
      const reason = chrome.runtime.lastError?.message ?? ''
      ready = false
      if (disposed || stopped) return
      if (/not found|not registered/i.test(reason)) { stopped = true; receive({ type: 'error', code: 'host_missing', message: '首次使用需要安装 Lectern 本机伴随程序，安装后点击重新连接。' }); return }
      if (/forbidden/i.test(reason)) { stopped = true; receive({ type: 'error', code: 'host_forbidden', message: '此扩展未获伴随程序授权，请安装与当前扩展配套的安装包。' }); return }
      if (!greeted || attempts >= 3) { stopped = true; receive({ type: 'error', code: 'host_start', message: '本机程序无法启动，请检查安装或下载更新后重试。' }); return }
      receive({ type: 'waiting', message: '连接中断，正在重新启动本机程序；将开始新会话。' })
      timer = window.setTimeout(connect, 1000 * 2 ** attempts++)
    })
    handshakeTimer = window.setTimeout(() => { stopped = true; receive({ type: 'error', code: 'host_start', message: '本机程序启动超时，请重新连接或安装更新。' }); port?.disconnect() }, 10000)
    send({ type: 'hello', protocol: 1 })
  }
  connect()
  return {
    input(data: string) { if (ready) send({ type: 'stdin', data }) },
    resize(nextCols: number, nextRows: number) { cols = nextCols; rows = nextRows; if (ready) send({ type: 'resize', cols, rows }) },
    dispose() { disposed = true; window.clearTimeout(timer); window.clearTimeout(handshakeTimer); port?.disconnect() },
  }
}

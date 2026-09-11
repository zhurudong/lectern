export interface AgentSettings { port: number; token: string; cwd: string; cmd: string }
export type AgentMessage = { type: 'ready' } | { type: 'data'; data: string }
  | { type: 'exit'; code: number } | { type: 'error'; message: string }

export function connectAgent(settings: AgentSettings, cols: number, rows: number,
  receive: (message: AgentMessage) => void, disconnected: () => void) {
  if (!Number.isInteger(settings.port) || settings.port < 1 || settings.port > 65535) throw new Error('端口必须在 1–65535 之间')
  // Keep this one constructor auditable; the build gate permits exactly this
  // numeric-port loopback expression, never an arbitrary URL or hostname.
  const socket = new WebSocket(`ws://127.0.0.1:${settings.port}`)
  let disposed = false
  const send = (message: object) => {
    if (socket.readyState === 1) socket.send(JSON.stringify(message))
  }
  socket.onopen = () => send({ type: 'start', ...settings, cols, rows })
  socket.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data)
      if (message.type === 'ready'
        || (message.type === 'data' && typeof message.data === 'string')
        || (message.type === 'exit' && Number.isInteger(message.code))
        || (message.type === 'error' && typeof message.message === 'string')) receive(message)
    } catch { receive({ type: 'error', message: '伴随程序返回了无效消息' }) }
  }
  socket.onclose = () => { if (!disposed) disconnected() }
  socket.onerror = () => { if (!disposed) disconnected() }
  return {
    input: (data: string) => send({ type: 'stdin', data }),
    resize: (cols: number, rows: number) => send({ type: 'resize', cols, rows }),
    dispose() {
      disposed = true
      socket.onmessage = null
      socket.onopen = () => socket.close()
      if (socket.readyState === 1) socket.close()
    },
  }
}

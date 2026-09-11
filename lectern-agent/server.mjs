import { createServer } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { statSync } from 'node:fs'
import { WebSocketServer, WebSocket } from 'ws'
import * as pty from 'node-pty'

const dimensions = (m) => Number.isInteger(m.cols) && m.cols >= 2 && m.cols <= 500
  && Number.isInteger(m.rows) && m.rows >= 1 && m.rows <= 300
const authenticated = (provided, token) => typeof provided === 'string'
  && Buffer.byteLength(provided) === Buffer.byteLength(token)
  && timingSafeEqual(Buffer.from(provided), Buffer.from(token))

// No shell interpolation; the executable and all terminal input belong to the
// authenticated user. An Origin allowlist alone is NOT authentication.
export async function startServer({ port = 8137, origin, token, spawn = pty.spawn }) {
  if (!/^chrome-extension:\/\/[a-p]{32}$/.test(origin ?? '')) throw new Error('An exact chrome-extension://<id> origin is required')
  if (typeof token !== 'string' || token.length < 32) throw new Error('A token of at least 32 characters is required')
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port')
  const http = createServer((_req, res) => { res.writeHead(404); res.end() })
  const wss = new WebSocketServer({ noServer: true, maxPayload: 65536, perMessageDeflate: false })
  let active = null
  const cleanups = new Set()
  http.on('upgrade', (req, socket, head) => {
    // Host validation also closes the DNS rebinding route. No wildcard origins,
    // missing Origin, localhost aliases or query-string credentials.
    if (req.headers.origin !== origin || req.headers.host !== `127.0.0.1:${http.address().port}` || req.url !== '/') {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws))
  })
  wss.on('connection', (ws) => {
    let child = null
    let started = false
    let ended = false
    const cleanup = () => {
      if (ended) return
      ended = true
      clearTimeout(timer)
      child?.kill()
      if (active === ws) active = null
      cleanups.delete(cleanup)
    }
    const send = (message) => {
      if (ws.readyState !== WebSocket.OPEN) return
      if (ws.bufferedAmount > 1024 * 1024) { ws.terminate(); cleanup(); return }
      ws.send(JSON.stringify(message))
    }
    const reject = (message) => { send({ type: 'error', message }); cleanup(); ws.close(1008, 'Rejected') }
    const timer = setTimeout(() => reject('Authentication timeout'), 5000)
    cleanups.add(cleanup)
    ws.on('error', cleanup)
    ws.on('close', cleanup)
    ws.on('message', (raw, binary) => {
      if (ended) return
      try {
        if (binary) return reject('JSON text frames required')
        const m = JSON.parse(raw.toString())
        if (!m || typeof m !== 'object') return reject('Invalid message')
        if (!started) {
          if (m.type !== 'start' || !authenticated(m.token, token)) return reject('Authentication failed')
          if (active) return reject('A terminal session is already active')
          if (!dimensions(m) || typeof m.cwd !== 'string' || !isAbsolute(m.cwd) || !statSync(m.cwd).isDirectory()) return reject('Invalid cwd or terminal size')
          const cmd = m.cmd ?? 'codex'
          if (typeof cmd !== 'string' || !cmd.trim() || cmd.includes('\0') || cmd.length > 4096) return reject('Invalid executable')
          active = ws
          child = spawn(cmd, [], { name: 'xterm-256color', cwd: m.cwd, cols: m.cols, rows: m.rows, env: { ...process.env, TERM: 'xterm-256color' } })
          started = true
          clearTimeout(timer)
          child.onData((data) => send({ type: 'data', data }))
          child.onExit(({ exitCode }) => {
            child = null
            send({ type: 'exit', code: exitCode })
            cleanup()
            ws.close(1000, 'Process exited')
          })
          send({ type: 'ready' })
        } else if (m.type === 'stdin' && typeof m.data === 'string') {
          child?.write(m.data)
        } else if (m.type === 'resize' && dimensions(m)) {
          child?.resize(m.cols, m.rows)
        } else reject('Invalid terminal message')
      } catch {
        reject('Cannot start terminal or process message; check executable and absolute cwd')
      }
    })
  })
  await new Promise((resolve, reject) => {
    http.once('error', reject)
    http.listen(port, '127.0.0.1', resolve)
  })
  return {
    port: http.address().port,
    address: http.address(),
    async close() {
      for (const cleanup of [...cleanups]) cleanup()
      for (const ws of wss.clients) ws.terminate()
      await new Promise((resolve) => wss.close(resolve))
      await new Promise((resolve) => http.close(resolve))
    },
  }
}

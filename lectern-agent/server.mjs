import { createServer } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { statSync } from 'node:fs'
import { WebSocketServer, WebSocket } from 'ws'
import * as pty from 'node-pty'

const dimensions = (m) => Number.isInteger(m.cols) && m.cols >= 2 && m.cols <= 500
  && Number.isInteger(m.rows) && m.rows >= 1 && m.rows <= 300
const extensionOrigin = (value) => /^chrome-extension:\/\/[a-p]{32}$/.test(value ?? '')
const authenticated = (provided, token) => typeof provided === 'string' && typeof token === 'string'
  && Buffer.byteLength(provided) === Buffer.byteLength(token)
  && timingSafeEqual(Buffer.from(provided), Buffer.from(token))
const projectId = (value) => typeof value === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(value)

// Unknown extension origins can ONLY request local confirmation. Every PTY
// operation still requires an origin-specific token; websites never handshake.
export async function startServer({ port = 8137, origin, token, spawn = pty.spawn,
  preferences, confirmPairing, chooseProject, pairingCooldownMs = 30000 }) {
  const autoPair = !!(preferences && confirmPairing && chooseProject)
  if (!autoPair && !extensionOrigin(origin)) throw new Error('An exact chrome-extension://<id> origin is required')
  if (!autoPair && (typeof token !== 'string' || token.length < 32)) throw new Error('A token of at least 32 characters is required')
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port')
  const http = createServer((_req, res) => { res.writeHead(404); res.end() })
  const wss = new WebSocketServer({ noServer: true, maxPayload: 65536, perMessageDeflate: false })
  let active = null, dialogActive = false, nextPairAt = 0
  const cleanups = new Set()
  http.on('upgrade', (req, socket, head) => {
    if (!extensionOrigin(req.headers.origin) || (!autoPair && req.headers.origin !== origin)
      || req.headers.host !== `127.0.0.1:${http.address().port}` || req.url !== '/' || wss.clients.size >= 16) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
  })
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.alive === false) { ws.terminate(); continue }
      ws.alive = false
      ws.ping()
    }
  }, 20000)
  heartbeat.unref()
  wss.on('connection', (ws, req) => {
    ws.alive = true
    ws.on('pong', () => { ws.alive = true })
    const clientOrigin = req.headers.origin
    const abort = new AbortController()
    let child = null, started = false, ended = false, authorized = false, pending = false
    const cleanup = () => {
      if (ended) return
      ended = true
      clearTimeout(timer)
      abort.abort()
      try { child?.kill() } catch { /* already exited */ }
      if (active === ws) active = null
      cleanups.delete(cleanup)
    }
    const send = (message) => {
      if (ws.readyState !== WebSocket.OPEN || ended) return
      if (ws.bufferedAmount > 1024 * 1024) { ws.terminate(); cleanup(); return }
      ws.send(JSON.stringify(message))
    }
    const reject = (message, code = 'protocol') => { send({ type: 'error', message, code }); cleanup(); ws.close(1008, 'Rejected') }
    let timer = setTimeout(() => reject('Authentication timeout', 'auth'), 5000)
    const deadline = (ms) => { clearTimeout(timer); timer = setTimeout(() => reject('Request timeout', 'timeout'), ms) }
    const localDialog = async (action) => {
      if (dialogActive) throw new Error('Another local confirmation is open')
      dialogActive = true
      pending = true
      deadline(125000)
      try { return await action(abort.signal) }
      finally { dialogActive = false; pending = false }
    }
    cleanups.add(cleanup)
    ws.on('error', cleanup)
    ws.on('close', cleanup)
    ws.on('message', async (raw, binary) => {
      if (ended) return
      if (pending) return reject('Wait for local confirmation', 'pending')
      try {
        if (binary) return reject('JSON text frames required')
        const m = JSON.parse(raw.toString())
        if (!m || typeof m !== 'object') return reject('Invalid message')
        if (!authorized && m.type === 'pair' && autoPair) {
          if (Date.now() < nextPairAt || dialogActive) return reject('请稍后重试配对；已有本机确认或请求过于频繁。', 'pairing-busy')
          nextPairAt = Date.now() + pairingCooldownMs
          send({ type: 'waiting', message: '请在本机弹窗中确认连接 Lectern。' })
          const allowed = await localDialog((signal) => confirmPairing(clientOrigin, signal))
          if (ended || ws.readyState !== WebSocket.OPEN) return
          if (!allowed) return reject('已取消配对。点击重新连接可再次发起。', 'cancelled')
          // Rotate on explicit re-pair. Never disclose a token without a fresh
          // native confirmation, including for an already-known Origin.
          const pairedToken = preferences.pair(clientOrigin)
          send({ type: 'paired', token: pairedToken })
          authorized = true
          deadline(30000)
          return
        }
        if (!authorized) {
          const expected = autoPair ? preferences.token(clientOrigin) : token
          if (!['authorize', 'start'].includes(m.type) || !authenticated(m.token, expected)) return reject('配对已失效，请重新配对。', 'auth')
          authorized = true
          deadline(30000)
          if (m.type === 'authorize') { send({ type: 'authorized' }); return }
        }
        if (!started && m.type === 'project' && autoPair) {
          if (!projectId(m.id) || typeof m.name !== 'string' || m.name.length > 200) return reject('Invalid project identity')
          let cwd = preferences.project(clientOrigin, m.id)
          if (cwd) { try { if (!statSync(cwd).isDirectory()) cwd = null } catch { cwd = null } }
          if (!cwd || m.reselect === true) {
            send({ type: 'waiting', message: '请在系统目录选择器中选择与阅读项目相同的目录。' })
            cwd = await localDialog((signal) => chooseProject(m.name, signal))
            if (ended || ws.readyState !== WebSocket.OPEN) return
            if (!cwd) return reject('已取消目录关联。点击重新连接可再次选择。', 'cancelled')
            cwd = preferences.bind(clientOrigin, m.id, cwd)
          }
          send({ type: 'project', id: m.id, cwd })
          deadline(30000)
          return
        }
        if (!started && m.type === 'start') {
          if (active) return reject('另一个终端会话正在使用，请先关闭它。', 'busy')
          // New clients send the project identity, never a globally cached cwd.
          const cwd = m.projectId && autoPair ? preferences.project(clientOrigin, m.projectId) : m.cwd
          if (!dimensions(m) || typeof cwd !== 'string' || !isAbsolute(cwd) || !statSync(cwd).isDirectory()) return reject('Invalid cwd or terminal size')
          const cmd = m.cmd ?? 'codex'
          if (typeof cmd !== 'string' || !cmd.trim() || cmd.includes('\0') || cmd.length > 4096) return reject('Invalid executable')
          active = ws
          child = spawn(cmd, [], { name: 'xterm-256color', cwd, cols: m.cols, rows: m.rows, env: { ...process.env, TERM: 'xterm-256color' } })
          started = true
          clearTimeout(timer)
          child.onData((data) => send({ type: 'data', data }))
          child.onExit(({ exitCode }) => { child = null; send({ type: 'exit', code: exitCode }); cleanup(); ws.close(1000, 'Process exited') })
          send({ type: 'ready' })
        } else if (started && m.type === 'stdin' && typeof m.data === 'string') child?.write(m.data)
        else if (started && m.type === 'resize' && dimensions(m)) child?.resize(m.cols, m.rows)
        else reject('Invalid terminal message')
      } catch (error) {
        reject(`无法处理终端请求：${error.message}`, 'operation')
      }
    })
  })
  await new Promise((resolve, reject) => { http.once('error', reject); http.listen(port, '127.0.0.1', resolve) })
  return {
    port: http.address().port, address: http.address(),
    async close() {
      clearInterval(heartbeat)
      for (const cleanup of [...cleanups]) cleanup()
      for (const ws of wss.clients) ws.terminate()
      await new Promise((resolve) => wss.close(resolve))
      await new Promise((resolve) => http.close(resolve))
    },
  }
}

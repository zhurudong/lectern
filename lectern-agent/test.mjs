import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { WebSocket } from 'ws'
import { startServer } from './server.mjs'
const origin = `chrome-extension://${'a'.repeat(32)}`
const token = 'a'.repeat(64)
const start = { type: 'start', cwd: process.cwd(), cmd: 'codex', cols: 80, rows: 24, token }
const connect = async (server, headers = { origin }) => {
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { headers })
  await once(ws, 'open')
  const messages = []
  ws.on('message', (raw) => messages.push(JSON.parse(raw.toString())))
  ws.messages = messages
  return ws
}
async function until(predicate) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('Timed out waiting for terminal event')
}

test('loopback authentication, protocol, single session and lifecycle', async () => {
  const calls = [], writes = [], sizes = []
  let killed = 0, output, exit
  const server = await startServer({ port: 0, origin, token, spawn: (...args) => {
    calls.push(args)
    return { onData: (fn) => { output = fn }, onExit: (fn) => { exit = fn }, write: (data) => writes.push(data), resize: (...size) => sizes.push(size), kill: () => killed++ }
  } })
  try {
    assert.equal(server.address.address, '127.0.0.1')
    for (const headers of [{ origin: 'https://evil.example' }, {}, { origin, Host: `evil.example:${server.port}` }]) {
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { headers })
      const [error] = await once(ws, 'error')
      assert.match(error.message, /403/)
    }
    for (const message of [{ ...start, token: undefined }, { ...start, token: 'wrong' }, { type: 'stdin', data: 'bad' }, { ...start, cwd: 'relative' }, { ...start, cols: -1 }]) {
      const ws = await connect(server)
      ws.send(JSON.stringify(message))
      await once(ws, 'close')
      assert.equal(ws.messages[0].type, 'error')
    }
    assert.equal(calls.length, 0, 'rejected requests must never spawn')
    const ws = await connect(server)
    ws.send(JSON.stringify(start))
    await until(() => ws.messages.some((m) => m.type === 'ready' || m.type === 'error'))
    assert.equal(ws.messages[0].type, 'ready', JSON.stringify(ws.messages))
    assert.equal(calls[0][0], 'codex')
    assert.equal(calls[0][2].cwd, process.cwd())
    output('hello\r\n')
    ws.send(JSON.stringify({ type: 'stdin', data: 'input\r' }))
    ws.send(JSON.stringify({ type: 'resize', cols: 100, rows: 40 }))
    await until(() => writes.length && sizes.length && ws.messages.some((m) => m.data === 'hello\r\n'))
    assert.deepEqual(writes, ['input\r'])
    assert.deepEqual(sizes, [[100, 40]])
    const second = await connect(server)
    second.send(JSON.stringify(start))
    await once(second, 'close')
    assert.equal(calls.length, 1)
    ws.close()
    await once(ws, 'close')
    await until(() => killed === 1)
    const third = await connect(server)
    third.send(JSON.stringify(start))
    await until(() => calls.length === 2)
    exit({ exitCode: 7 })
    await once(third, 'close')
    assert.ok(third.messages.some((m) => m.type === 'exit' && m.code === 7))
  } finally { await server.close() }
})

test('real PTY executes in cwd, accepts input, reports resize and exit', async () => {
  const server = await startServer({ port: 0, origin, token })
  try {
    const ws = await connect(server)
    ws.send(JSON.stringify({ ...start, cmd: '/bin/sh' }))
    await until(() => ws.messages.some((m) => m.type === 'ready' || m.type === 'error'))
    assert.equal(ws.messages[0].type, 'ready', JSON.stringify(ws.messages))
    ws.send(JSON.stringify({ type: 'resize', cols: 101, rows: 37 }))
    ws.send(JSON.stringify({ type: 'stdin', data: "printf 'PTY_%s\\n' OK; pwd; stty size\n" }))
    await until(() => {
      const output = ws.messages.filter((m) => m.type === 'data').map((m) => m.data).join('')
      return output.includes('PTY_OK') && output.includes(process.cwd()) && output.includes('37 101')
    })
    ws.send(JSON.stringify({ type: 'stdin', data: 'exit 9\n' }))
    await once(ws, 'close')
    assert.ok(ws.messages.some((m) => m.type === 'exit' && m.code === 9))
  } finally { await server.close() }
})

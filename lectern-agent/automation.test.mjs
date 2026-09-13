import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, statSync, mkdirSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { WebSocket } from 'ws'
import { preferences } from './preferences.mjs'
import { startServer } from './server.mjs'
import { servicePlist, stageRuntime } from './service.mjs'
const origin = `chrome-extension://${'a'.repeat(32)}`
const other = `chrome-extension://${'b'.repeat(32)}`
async function connect(server, from = origin) {
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: from })
  await once(ws, 'open')
  ws.messages = []
  ws.on('message', (data) => ws.messages.push(JSON.parse(data)))
  ws.sendFrame = (message) => ws.send(JSON.stringify(message))
  return ws
}
async function until(predicate) {
  for (let i = 0; i < 200; i++) { if (predicate()) return; await new Promise((r) => setTimeout(r, 10)) }
  throw new Error('Expected event not received')
}
const frame = async (ws, type) => { await until(() => ws.messages.some((m) => m.type === type)); return ws.messages.find((m) => m.type === type) }

test('local confirmation, origin-specific credentials, persisted project identity and no implicit trust', async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'lectern-auto-')))
  const a = join(dir, 'one', 'same-name'), b = join(dir, 'two', 'same-name')
  mkdirSync(a, { recursive: true }); mkdirSync(b, { recursive: true })
  const prefs = preferences(join(dir, 'config'))
  let confirmations = 0, selections = 0, spawns = 0
  const server = await startServer({ port: 0, preferences: prefs, pairingCooldownMs: 0,
    confirmPairing: async () => { confirmations++; return true },
    chooseProject: async () => ++selections === 1 ? a : b,
    spawn: () => { spawns++; return { onData() {}, onExit() {}, write() {}, resize() {}, kill() {} } },
  })
  try {
    const attacker = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: 'https://evil.example' })
    assert.match((await once(attacker, 'error'))[0].message, /403/)
    const unauth = await connect(server)
    unauth.sendFrame({ type: 'project', id: 'project-a', name: 'same-name' })
    await once(unauth, 'close')
    assert.equal(selections, 0)
    assert.equal(confirmations, 0)
    const ws = await connect(server)
    ws.sendFrame({ type: 'pair' })
    const { token } = await frame(ws, 'paired')
    assert.equal(confirmations, 1)
    assert.equal(spawns, 0)
    assert.equal(token, prefs.token(origin))
    const wrong = await connect(server, other)
    wrong.sendFrame({ type: 'authorize', token })
    await once(wrong, 'close')
    assert.equal(wrong.messages[0].code, 'auth')
    ws.sendFrame({ type: 'project', id: 'project-a', name: 'same-name' })
    assert.equal((await frame(ws, 'project')).cwd, a)
    ws.messages = []
    ws.sendFrame({ type: 'project', id: 'project-b', name: 'same-name' })
    assert.equal((await frame(ws, 'project')).cwd, b)
    assert.equal(selections, 2)
    ws.messages = []
    ws.sendFrame({ type: 'project', id: 'project-a', name: 'same-name' })
    assert.equal((await frame(ws, 'project')).cwd, a)
    assert.equal(selections, 2)
    ws.sendFrame({ type: 'start', projectId: 'project-a', cols: 80, rows: 24 })
    await frame(ws, 'ready')
    assert.equal(spawns, 1)
    ws.close(); await once(ws, 'close')
    const reload = preferences(join(dir, 'config'))
    assert.equal(reload.token(origin), token)
    assert.equal(reload.project(origin, 'project-a'), a)
    assert.equal(reload.project(other, 'project-a'), undefined)
    assert.equal(statSync(join(dir, 'config/preferences.json')).mode & 0o777, 0o600)
  } finally { await server.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('denied and abandoned pairing never persist a token; concurrent requests cannot bypass confirmation', async () => {
  let writes = 0, confirm, dialogAborted = false
  const prefs = { token() {}, pair() { writes++; return 'a'.repeat(64) } }
  const server = await startServer({ port: 0, preferences: prefs, pairingCooldownMs: 0,
    confirmPairing: (_origin, signal) => new Promise((resolve) => { confirm = resolve; signal.addEventListener('abort', () => { dialogAborted = true }) }), chooseProject: async () => null })
  try {
    const ws = await connect(server)
    ws.sendFrame({ type: 'pair' }); await frame(ws, 'waiting')
    const another = await connect(server)
    another.sendFrame({ type: 'pair' }); await once(another, 'close')
    assert.equal(another.messages[0].code, 'pairing-busy')
    confirm(false); await once(ws, 'close')
    assert.equal(writes, 0)
    dialogAborted = false
    const abandoned = await connect(server)
    abandoned.sendFrame({ type: 'pair' }); await frame(abandoned, 'waiting')
    abandoned.close(); await once(abandoned, 'close')
    await until(() => dialogAborted)
    confirm(true)
    await new Promise((resolve) => setTimeout(resolve, 25))
    assert.equal(writes, 0)
  } finally { await server.close() }
})

test('cancelled folder selection does not bind or spawn; stored deleted directory asks again', async () => {
  let selected = 0, bound = 0
  const server = await startServer({ port: 0, preferences: { token: () => 'x'.repeat(64), project: () => '/no-such-lectern-directory', bind: () => bound++ },
    confirmPairing: async () => false, chooseProject: async () => { selected++; return null } })
  try {
    const ws = await connect(server)
    ws.sendFrame({ type: 'authorize', token: 'x'.repeat(64) }); await frame(ws, 'authorized')
    ws.sendFrame({ type: 'project', id: 'abc', name: 'project' }); await once(ws, 'close')
    assert.equal(selected, 1); assert.equal(bound, 0)
    assert.ok(ws.messages.some((m) => m.code === 'cancelled'))
  } finally { await server.close() }
})

test('launchd service uses absolute executable argv, login/restart and escaped configuration without tokens', () => {
  const plist = servicePlist({ node: '/node path/node', cli: '/project & test/cli.mjs', dir: '/private/config', port: 8137, envPath: '/a:/b' })
  assert.ok(plist.includes('<string>/project &amp; test/cli.mjs</string>'))
  assert.ok(plist.includes('<key>RunAtLoad</key><true/>'))
  assert.ok(plist.includes('<key>KeepAlive</key><true/>'))
  assert.ok(!plist.includes('token'))
})

test('installed runtime contains resolved dependencies and runs without the source checkout', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lectern-runtime-test-'))
  try {
    const runtime = stageRuntime(dir)
    assert.match(execFileSync(process.execPath, [join(runtime, 'cli.mjs'), '--help'], { encoding: 'utf8', cwd: dir }), /--install/)
    assert.ok(statSync(join(runtime, 'node_modules/node-pty/package.json')).isFile())
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

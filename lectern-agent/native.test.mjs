import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import * as pty from 'node-pty'
import { encode, decoder } from './native/framing.mjs'
import { nativeSession } from './native/session.mjs'
import { preferences } from './preferences.mjs'
const origin = `chrome-extension://${'a'.repeat(32)}`
const temp = () => realpathSync(mkdtempSync(join(tmpdir(), 'lectern-native-test-')))
const until = async (predicate) => { for (let i = 0; i < 200; i++) { if (predicate()) return; await new Promise((r) => setTimeout(r, 20)) } throw new Error('event timeout') }

test('framing accepts fragmented unicode and multiple messages; rejects malformed, huge and truncated frames', () => {
  const messages = [], d = decoder((m) => messages.push(m)), m = { type: 'data', data: '中文🙂' }
  const bytes = Buffer.concat([encode(m), encode({ type: 'hello' })])
  for (const byte of bytes) d.push(Buffer.from([byte]))
  d.end(); assert.deepEqual(messages, [m, { type: 'hello' }])
  assert.throws(() => decoder(() => {}).push(Buffer.from([0, 0, 0, 0])))
  assert.throws(() => decoder(() => {}).push(Buffer.from([255, 255, 255, 255])))
  const partial = decoder(() => {}); partial.push(bytes.subarray(0, 5)); assert.throws(() => partial.end())
  const invalid = encode({ a: 'x' }); invalid[4] = 255
  assert.throws(() => decoder(() => {}).push(invalid))
})

test('handshake, per-origin project associations, no cross-project overwrite and single PTY per port', async () => {
  const dir = temp(), one = join(dir, 'one'), two = join(dir, 'two')
  mkdirSync(one); mkdirSync(two)
  let selections = 0, spawns = 0
  const prefs = preferences(join(dir, 'state')), concurrent = preferences(join(dir, 'state')), messages = []
  const session = nativeSession({ origin, preferences: prefs, chooseProject: async () => ++selections === 1 ? one : two,
    spawn: () => { spawns++; return { onData() {}, onExit() {}, kill() {}, resize() {}, write() {} } }, send: (m) => messages.push(m), finish() {}, findExecutable: () => '/bin/sh' })
  try {
    await session.receive({ type: 'start', projectId: 'one', cmd: '/bin/sh', cols: 80, rows: 24 })
    assert.equal(spawns, 0); assert.equal(messages.at(-1).code, 'version')
    await session.receive({ type: 'hello', protocol: 1 })
    await session.receive({ type: 'project', id: 'one', name: 'same-name' })
    concurrent.bind(origin, 'two', two)
    assert.equal(prefs.project(origin, 'two'), two)
    assert.equal(concurrent.project(origin, 'one'), one)
    assert.equal(concurrent.project('other-origin', 'one'), undefined)
    await session.receive({ type: 'project', id: 'one', name: 'same-name' }); assert.equal(selections, 1)
    await session.receive({ type: 'start', projectId: 'two', cmd: '/bin/sh', cols: 80, rows: 24 })
    assert.equal(spawns, 0, 'must start the directory acknowledged by this port')
    await session.receive({ type: 'start', projectId: 'one', cmd: '/bin/sh', cols: 80, rows: 24 })
    await session.receive({ type: 'start', projectId: 'one', cmd: '/bin/sh', cols: 80, rows: 24 })
    assert.equal(spawns, 1)
  } finally { session.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('real PTY: cwd, stdin/output, resize and close kills child', async () => {
  const dir = temp(), messages = [], prefs = preferences(join(dir, 'state'))
  let processId
  prefs.bind(origin, 'project', dir)
  const session = nativeSession({ origin, preferences: prefs, chooseProject: async () => { throw new Error('must reuse association') },
    spawn: (...args) => { const child = pty.spawn(...args); processId = child.pid; return child }, send: (m) => messages.push(m), finish() {} })
  try {
    await session.receive({ type: 'hello', protocol: 1 })
    await session.receive({ type: 'project', id: 'project', name: 'test' })
    await session.receive({ type: 'start', projectId: 'project', cmd: '/bin/sh', cols: 80, rows: 24 })
    assert.ok(messages.some((m) => m.type === 'ready'))
    await session.receive({ type: 'resize', cols: 100, rows: 40 })
    await session.receive({ type: 'stdin', data: "printf 'NATIVE_%s\\n' READY; pwd; stty size\r" })
    await until(() => messages.filter((m) => m.type === 'data').map((m) => m.data).join('').includes('40 100'))
    const output = messages.filter((m) => m.type === 'data').map((m) => m.data).join('')
    assert.ok(output.includes('NATIVE_READY')); assert.ok(output.includes(dir))
    session.close()
    await until(() => { try { process.kill(processId, 0); return false } catch { return true } })
  } finally { session.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('cancelled/abandoned directory selection never binds; missing executable never spawns', async () => {
  let bound = 0, spawn = 0, complete, aborted = false
  const messages = [], prefs = { project() {}, bind() { bound++ } }
  const session = nativeSession({ origin, preferences: prefs, chooseProject: (_name, signal) => new Promise((r) => { complete = r; signal.addEventListener('abort', () => { aborted = true }) }),
    spawn: () => spawn++, send: (m) => messages.push(m), finish() {} })
  await session.receive({ type: 'hello', protocol: 1 })
  const pending = session.receive({ type: 'project', id: 'one', name: 'one' })
  session.close(); complete('/tmp'); await pending
  assert.equal(bound, 0); assert.equal(spawn, 0); assert.equal(aborted, true)
  const missing = nativeSession({ origin, preferences: { project: () => '/tmp' }, chooseProject: async () => null, spawn: () => spawn++, send: (m) => messages.push(m), finish() {}, findExecutable: () => null })
  await missing.receive({ type: 'hello', protocol: 1 })
  await missing.receive({ type: 'project', id: 'one', name: 'one' })
  await missing.receive({ type: 'start', projectId: 'one', cmd: 'missing', cols: 80, rows: 24 })
  assert.equal(messages.at(-1).code, 'agent_missing'); assert.equal(spawn, 0); missing.close()
})

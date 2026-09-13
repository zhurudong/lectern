#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import * as pty from 'node-pty'
import { encode, decoder } from './framing.mjs'
import { nativeSession } from './session.mjs'
import { preferences } from '../preferences.mjs'
import { chooseProject } from '../dialogs.mjs'

// No HTTP listener, token exchange or shell interpolation. Chrome checks its
// host allowlist, and the host independently checks the same release identity.
const config = JSON.parse(readFileSync(new URL('../native-release.json', import.meta.url), 'utf8'))
const origin = process.argv[2]
if (!/^chrome-extension:\/\/[a-p]{32}\/$/.test(origin ?? '') || !config.allowed_origins.includes(origin)) {
  process.stderr.write('Lectern: caller Origin is not allowed\n')
  process.exit(1)
}
let session, stopped = false, queued = 0
const finish = () => {
  if (stopped) return
  stopped = true
  session?.close()
  process.stdin.pause()
  process.stdout.end(() => process.exit(0))
}
const send = (message) => {
  if (stopped) return
  // PTY bursts are split below Chrome's 1 MB per-message limit.
  const messages = message.type === 'data' ? (message.data.match(/[\s\S]{1,32000}/gu) ?? []).map((data) => ({ type: 'data', data })) : [message]
  for (const item of messages) {
    if (process.stdout.writableLength > 1024 * 1024) { finish(); return }
    process.stdout.write(encode(item))
  }
}
session = nativeSession({ origin: origin.slice(0, -1), preferences: preferences(join(homedir(), '.lectern-agent')), chooseProject, spawn: pty.spawn, send, finish })
let chain = Promise.resolve()
const frames = decoder((message) => {
  if (++queued > 32) throw new Error('Too many pending requests')
  chain = chain.then(() => session.receive(message)).catch(() => {
    send({ type: 'error', code: 'operation', message: '本机操作失败，请检查目录权限后重试。' })
  }).finally(() => { queued-- })
})
process.stdin.on('data', (chunk) => { try { frames.push(chunk) } catch { send({ type: 'error', code: 'protocol', message: 'Invalid native frame' }); finish() } })
process.stdin.on('end', finish)
process.stdin.on('error', finish)
process.stdout.on('error', finish)
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.once(signal, finish)

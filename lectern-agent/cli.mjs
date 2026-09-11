#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { parseArgs } from 'node:util'
import { startServer } from './server.mjs'

try {
  const { values } = parseArgs({ options: { origin: { type: 'string' }, port: { type: 'string', default: '8137' }, help: { type: 'boolean' } } })
  if (values.help) {
    console.log('lectern-agent --origin chrome-extension://<extension-id> [--port 8137]')
  } else {
    if (!/^chrome-extension:\/\/[a-p]{32}$/.test(values.origin ?? '')) throw new Error('Pass --origin chrome-extension://<extension-id> from the AI terminal panel')
    const dir = join(homedir(), '.lectern-agent')
    const path = join(dir, 'token')
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    chmodSync(dir, 0o700)
    try { writeFileSync(path, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 }) }
    catch (error) { if (error.code !== 'EEXIST') throw error }
    chmodSync(path, 0o600)
    const token = readFileSync(path, 'utf8').trim()
    const server = await startServer({ port: Number(values.port), origin: values.origin, token })
    console.log(`Lectern companion listening on 127.0.0.1:${server.port}\nAllowed Origin: ${values.origin}\nPairing token: ${path}\nAgent runs with your user privileges and can modify files. Closing the panel ends the session.`)
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void server.close().then(() => process.exit(0)) })
  }
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}

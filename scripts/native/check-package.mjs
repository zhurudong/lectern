import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { readFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PROJECT } from '../paths.mjs'
import { encode, decoder } from '../../lectern-agent/native/framing.mjs'
const app = join(PROJECT, 'release-artifacts/Lectern Companion.app')
const resources = join(app, 'Contents/Resources'), launcher = join(app, 'Contents/MacOS/lectern-agent')
const config = JSON.parse(readFileSync(join(resources, 'agent/native-release.json')))
assert.equal(execFileSync(join(resources, 'node'), ['--version'], { encoding: 'utf8' }).trim(), 'v24.13.0')
assert.ok(!existsSync(join(resources, 'agent/server.mjs')))
assert.ok(!existsSync(join(resources, 'agent/node_modules/ws')))
async function call(origin, messages) {
  const child = spawn(launcher, [origin], { env: { ...process.env, PATH: '/usr/bin:/bin' }, stdio: ['pipe', 'pipe', 'pipe'] })
  const received = []; let stderr = ''
  const frames = decoder((m) => { received.push(m); child.stdin.end() })
  child.stdout.on('data', (data) => frames.push(data))
  child.stderr.on('data', (data) => { stderr += data })
  child.stdin.on('error', () => {})
  for (const m of messages) child.stdin.write(encode(m))
  if (!messages.length) child.stdin.end()
  const timeout = setTimeout(() => child.kill('SIGKILL'), 10000)
  const status = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve) })
  clearTimeout(timeout); frames.end()
  return { status, received, stderr }
}
const rejected = await call('chrome-extension://' + 'p'.repeat(32) + '/', [{ type: 'hello', protocol: 1 }])
assert.equal(rejected.status, 1); assert.deepEqual(rejected.received, []); assert.match(rejected.stderr, /not allowed/)
const accepted = await call(config.allowed_origins[0], [{ type: 'hello', protocol: 1 }])
assert.equal(accepted.status, 0); assert.equal(accepted.received[0].type, 'hello'); assert.equal(accepted.received[0].protocol, 1)
const incompatible = await call(config.allowed_origins[0], [{ type: 'hello', protocol: 999 }])
assert.equal(incompatible.received[0].code, 'version')
// Compile the actual uninstall AppleScript without executing any uninstall action.
const temp = mkdtempSync(join(tmpdir(), 'lectern-package-check-'))
try {
  const script = readFileSync(join(resources, 'Uninstall.command'), 'utf8').split("<<'APPLESCRIPT'\n")[1].split('\nAPPLESCRIPT')[0]
  writeFileSync(join(temp, 'uninstall.applescript'), script)
  execFileSync('/usr/bin/osacompile', ['-o', join(temp, 'uninstall.scpt'), join(temp, 'uninstall.applescript')])
} finally { rmSync(temp, { recursive: true, force: true }) }
console.log('PASS bundled official runtime with system-only PATH, no WS dependency, exact origin rejection, handshake/version, EOF exit, uninstall script compilation (not executed)')

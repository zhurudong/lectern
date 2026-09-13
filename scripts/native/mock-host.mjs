// Isolated browser acceptance fixture. Never included in extension/companion artifacts.
import { appendFileSync, readFileSync } from 'node:fs'
import { encode, decoder } from '../../lectern-agent/native/framing.mjs'
const [log, scenario] = process.argv.slice(2)
const send = (m) => process.stdout.write(encode(m))
appendFileSync(log, JSON.stringify({ type: 'connected' }) + '\n')
let input = ''
const frames = decoder((m) => {
  appendFileSync(log, JSON.stringify(m) + '\n')
  const mode = readFileSync(scenario, 'utf8')
  if (m.type === 'hello') send({ type: 'hello', protocol: mode === 'version' ? 999 : 1, version: 'test', agents: mode === 'missing-cli' ? [] : ['codex'] })
  if (m.type === 'project') send({ type: 'project', id: m.id, cwd: '/tmp/lectern-project' })
  if (m.type === 'start') { send({ type: 'ready' }); send({ type: 'data', data: '\r\nLECTERN_MOCK_READY\r\n' }) }
  if (m.type === 'stdin') {
    input += m.data
    if (input.includes('EXIT\r')) { send({ type: 'exit', code: 0 }); process.exitCode = 0; process.stdin.destroy(); return }
    if (input.includes('CRASH\r')) { process.exit(1) }
    send({ type: 'data', data: `ECHO:${m.data}` })
  }
})
process.stdin.on('data', (data) => frames.push(data))
process.stdin.on('end', () => { appendFileSync(log, JSON.stringify({ type: 'closed' }) + '\n') })

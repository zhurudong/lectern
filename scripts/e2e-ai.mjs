// Uses actual unpacked MV3 builds and a loopback mock. No CLI credentials or
// model traffic are required; real node-pty transport is tested in agent/test.
import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'
import { WebSocketServer } from '../lectern-agent/node_modules/ws/wrapper.mjs'
import { PROJECT, resolveChrome } from './paths.mjs'
import { join } from 'node:path'
import { startServer } from '../lectern-agent/server.mjs'

const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 })
await new Promise((resolve) => wss.once('listening', resolve))
const frames = [], origins = []
wss.on('connection', (ws, req) => {
  origins.push(req.headers.origin)
  ws.on('message', (raw) => {
    const message = JSON.parse(raw.toString())
    frames.push(message)
    if (message.type === 'start') {
      ws.send(JSON.stringify({ type: 'ready' }))
      ws.send(JSON.stringify({ type: 'data', data: '\r\nLECTERN_MOCK_READY\r\n' }))
    }
    if (message.type === 'stdin') ws.send(JSON.stringify({ type: 'data', data: `ECHO:${message.data}` }))
  })
})
const browser = await puppeteer.launch({ executablePath: resolveChrome(), headless: false,
  pipe: true, enableExtensions: true, args: ['--no-first-run', '--no-default-browser-check'],
  defaultViewport: { width: 1400, height: 900 },
})
const pauseUntil = async (predicate) => {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('Expected WebSocket frame was not received')
}
try {
  const pureId = await browser.installExtension(join(PROJECT, 'dist'))
  const pure = await browser.newPage()
  const pureCDP = await pure.createCDPSession()
  await pureCDP.send('Network.enable')
  const sockets = []
  pureCDP.on('Network.webSocketCreated', (event) => sockets.push(event.url))
  await pure.goto(`chrome-extension://${pureId}/viewer.html`)
  await pure.evaluate((port) => localStorage.setItem('lectern-ai-settings-v1', JSON.stringify({ port, token: 'a'.repeat(64), cwd: '/tmp', cmd: 'codex' })), wss.address().port)
  await pure.reload({ waitUntil: 'networkidle0' })
  assert.equal(await pure.$('.ai-toggle'), null)
  assert.equal(sockets.length, 0)
  assert.equal(origins.length, 0)
  console.log('PASS pure build: saved opt-in settings cannot create a socket or terminal entry')

  const aiId = await browser.installExtension(join(PROJECT, 'dist-ai'))
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  await page.goto(`chrome-extension://${aiId}/viewer.html`)
  await page.waitForSelector('.ai-toggle')
  assert.equal(origins.length, 0, 'AI build must not connect until opened')
  await page.click('.ai-toggle')
  await page.waitForSelector('input[name=token]')
  assert.ok((await page.$eval('.ai-disclosure', (el) => el.textContent)).includes('用户权限'))
  assert.ok((await page.$eval('.ai-panel', (el) => el.textContent)).includes(`chrome-extension://${aiId}`))
  for (const [name, value] of Object.entries({ port: String(wss.address().port), token: 'a'.repeat(64), cwd: '/tmp', cmd: 'codex' })) {
    await page.$eval(`input[name=${name}]`, (el, value) => { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })) }, value)
  }
  await page.click('.ai-panel button[type=submit]')
  await page.waitForFunction(() => document.querySelector('.ai-status')?.textContent === '已连接')
  await page.waitForFunction(() => document.querySelector('.xterm-rows')?.textContent.includes('LECTERN_MOCK_READY'))
  assert.equal(origins[0], `chrome-extension://${aiId}`)
  const start = frames.find((m) => m.type === 'start')
  assert.equal(start.cwd, '/tmp')
  assert.equal(start.cmd, 'codex')
  assert.equal(start.token, 'a'.repeat(64))
  await page.click('.xterm-helper-textarea')
  await page.keyboard.type('hello')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Escape')
  await page.keyboard.down('Control')
  await page.keyboard.press('c')
  await page.keyboard.up('Control')
  await pauseUntil(() => frames.filter((m) => m.type === 'stdin').map((m) => m.data).join('').includes('hello\r\x1b\x03'))
  await page.waitForFunction(() => document.querySelector('.xterm-rows')?.textContent.includes('ECHO:h'))
  assert.ok(await page.$('.ai-panel'), 'Esc belongs to the agent')
  await page.setViewport({ width: 900, height: 700 })
  await pauseUntil(() => frames.some((m) => m.type === 'resize' && m.cols !== start.cols && m.rows !== start.rows))
  const closed = new Promise((resolve) => [...wss.clients][0].once('close', resolve))
  await page.click('button[aria-label="关闭 AI 终端"]')
  await closed
  assert.equal(await page.$('.ai-panel'), null)
  assert.equal(await page.evaluate(() => document.activeElement?.className), 'ai-toggle')
  await page.click('.ai-toggle')
  await pauseUntil(() => origins.length === 2)
  await page.waitForFunction(() => document.querySelector('.ai-status')?.textContent === '已连接')
  await page.click('button[aria-label="关闭 AI 终端"]')
  for (const ws of wss.clients) ws.terminate()
  await new Promise((resolve) => wss.close(resolve))
  await page.click('.ai-toggle')
  await page.waitForFunction(() => document.querySelector('.ai-status')?.textContent.includes('请先运行 lectern-agent'))
  // Explicit opt-in only: this launches the user's installed, authenticated CLI.
  if (process.env.AI_REAL_AGENT) {
    await page.click('button[aria-label="关闭 AI 终端"]')
    const token = 'b'.repeat(64)
    const real = await startServer({ port: 0, origin: `chrome-extension://${aiId}`, token })
    try {
      await page.evaluate((settings) => localStorage.setItem('lectern-ai-settings-v1', JSON.stringify(settings)),
        { port: real.port, token, cwd: PROJECT, cmd: process.env.AI_REAL_AGENT })
      await page.click('.ai-toggle')
      await page.waitForFunction(() => document.querySelector('.ai-status')?.textContent === '已连接')
      await page.waitForFunction(() => /codex/i.test(document.querySelector('.xterm-rows')?.textContent ?? ''), { timeout: 20000 })
      await page.click('button[aria-label="关闭 AI 终端"]')
      console.log('PASS actual Codex CLI: real companion + PTY + rendered startup in repository cwd (no model prompt sent)')
    } finally { await real.close() }
  }
  assert.deepEqual(errors, [])
  console.log('PASS AI build: pairing, output, stdin/control keys, resize, close/focus, auto reconnect and startup guidance')
} finally {
  await browser.close()
  for (const ws of wss.clients) ws.terminate()
  if (wss.address()) await new Promise((resolve) => wss.close(resolve))
}

// Real Chrome Native Messaging, with an isolated profile and framed stdio mock.
import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'
import ts from 'typescript'
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { PROJECT, resolveChrome } from './paths.mjs'
import { join } from 'node:path'
const temp = mkdtempSync(join(tmpdir(), 'lectern-native-e2e-'))
const profile = join(temp, 'profile'), log = join(temp, 'frames.jsonl'), scenario = join(temp, 'scenario')
writeFileSync(log, ''); writeFileSync(scenario, 'ok')
const frames = () => readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
const pauseUntil = async (predicate) => {
  for (let i = 0; i < 400; i++) { if (predicate()) return; await new Promise((resolve) => setTimeout(resolve, 25)) }
  throw new Error('Expected native event was not received')
}
const browser = await puppeteer.launch({ executablePath: resolveChrome(), userDataDir: profile, headless: false,
  pipe: true, enableExtensions: true, args: ['--no-first-run', '--no-default-browser-check'],
  defaultViewport: { width: 1400, height: 900 },
})
try {
  const pureId = await browser.installExtension(join(PROJECT, 'dist'))
  const pure = await browser.newPage()
  await pure.evaluateOnNewDocument(() => localStorage.setItem('cv-lang', 'zh'))
  const pureCDP = await pure.createCDPSession()
  await pureCDP.send('Network.enable')
  const sockets = []
  pureCDP.on('Network.webSocketCreated', (event) => sockets.push(event.url))
  await pure.goto(`chrome-extension://${pureId}/viewer.html`)
  assert.equal(await pure.$('.ai-toggle'), null)
  assert.equal(sockets.length, 0); assert.equal(frames().length, 0)
  assert.ok(!(await pure.evaluate(() => chrome.runtime.getManifest().permissions)).includes('nativeMessaging'))
  console.log('PASS pure build: no terminal, no socket, no native capability')
  const aiId = await browser.installExtension(join(PROJECT, 'dist-ai'))
  const page = await browser.newPage(), errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  await page.evaluateOnNewDocument(() => localStorage.setItem('cv-lang', 'zh'))
  await page.goto(`chrome-extension://${aiId}/viewer.html`)
  await page.waitForSelector('.ai-toggle')
  assert.equal(frames().length, 0)
  // Shadow any system installation so this test never starts the user's real host.
  const hosts = join(profile, 'NativeMessagingHosts')
  mkdirSync(hosts, { recursive: true })
  writeFileSync(join(hosts, 'com.lectern.agent.json'), JSON.stringify({ name: 'com.lectern.agent', description: 'Unavailable test host', path: join(temp, 'not-installed'), type: 'stdio', allowed_origins: [`chrome-extension://${aiId}/`] }))
  await page.click('.ai-toggle')
  await page.waitForFunction(() => document.querySelector('.ai-status')?.textContent.includes('安装'))
  assert.ok(await page.$('.ai-onboarding a[href="native-setup.html"]'))
  console.log('PASS unavailable host shows install guidance without starting a real companion')
  const launcher = join(temp, 'mock-host')
  const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'"
  writeFileSync(launcher, '#!/bin/sh\nexec ' + [process.execPath, join(PROJECT, 'scripts/native/mock-host.mjs'), log, scenario].map(quote).join(' ') + '\n', { mode: 0o755 })
  const manifestPath = join(hosts, 'com.lectern.agent.json')
  const manifest = { name: 'com.lectern.agent', description: 'Isolated test', path: launcher, type: 'stdio', allowed_origins: [`chrome-extension://${'p'.repeat(32)}/`] }
  writeFileSync(manifestPath, JSON.stringify(manifest))
  await page.click('.ai-actions button')
  await page.waitForFunction(() => document.querySelector('.ai-status')?.textContent.includes('未获伴随程序授权'))
  assert.equal(frames().length, 0, 'Chrome must reject other extension identity before launching host')
  manifest.allowed_origins = [`chrome-extension://${aiId}/`]
  writeFileSync(manifestPath, JSON.stringify(manifest))
  console.log('PASS Chrome rejects non-allowlisted extension before spawning host')
  await page.click('.ai-actions button')
  await page.waitForFunction(() => document.querySelector('.ai-status')?.textContent === '已连接')
  await page.waitForFunction(() => document.querySelector('.xterm-rows')?.textContent.includes('LECTERN_MOCK_READY'))
  const dock = await page.evaluate(() => {
    const terminal = document.querySelector('.ai-panel'), preview = document.querySelector('.preview')
    const a = terminal.getBoundingClientRect(), b = preview.getBoundingClientRect()
    return { role: terminal.getAttribute('role'), modal: terminal.getAttribute('aria-modal'),
      siblings: terminal.parentElement === preview.parentElement, terminalLeft: a.left, previewRight: b.right,
      previewWidth: b.width, height: a.height, mainHeight: terminal.parentElement.getBoundingClientRect().height }
  })
  assert.equal(dock.role, 'complementary')
  assert.equal(dock.modal, null)
  assert.equal(dock.siblings, true)
  assert.ok(dock.previewWidth > 400 && dock.terminalLeft >= dock.previewRight, 'terminal must sit beside, never cover, the reader')
  assert.ok(Math.abs(dock.height - dock.mainHeight) < 2, 'dock uses reading area height')
  assert.equal(await page.$('.ai-backdrop'), null)
  const divider = await page.$('.ai-resizer')
  const bounds = await divider.boundingBox()
  const beforeDrag = await page.$eval('.ai-panel', (el) => el.getBoundingClientRect().width)
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 80)
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width / 2 + 60, bounds.y + 80, { steps: 5 })
  await page.mouse.up()
  const afterDrag = await page.$eval('.ai-panel', (el) => el.getBoundingClientRect().width)
  assert.ok(beforeDrag - afterDrag > 40, 'dragging separator must resize terminal')
  assert.equal(await page.evaluate(() => localStorage.getItem('lectern-ai-terminal-width')), '420')
  const wideDivider = await (await page.$('.ai-resizer')).boundingBox()
  await page.mouse.move(wideDivider.x + wideDivider.width / 2, wideDivider.y + 80)
  await page.mouse.down()
  await page.mouse.move(20, wideDivider.y + 80, { steps: 10 })
  await page.mouse.up()
  const wide = await page.$eval('.ai-panel', (el) => el.getBoundingClientRect().width)
  assert.ok(wide > 1000, 'terminal can grow beyond both 900 px and 45vw')
  assert.ok(await page.$eval('.preview', (el) => el.getBoundingClientRect().width >= 119))
  await page.setViewport({ width: 900, height: 700 })
  await page.waitForFunction(() => document.querySelector('.ai-panel').getBoundingClientRect().right <= innerWidth + 1)
  assert.ok(await page.$eval('.preview', (el) => el.getBoundingClientRect().width >= 119))
  // Drag from its actual clamped width after the window shrinks: no dead zone.
  const narrowDivider = await (await page.$('.ai-resizer')).boundingBox()
  const narrowWidth = await page.$eval('.ai-panel', (el) => el.getBoundingClientRect().width)
  await page.mouse.move(narrowDivider.x + narrowDivider.width / 2, narrowDivider.y + 80)
  await page.mouse.down()
  await page.mouse.move(narrowDivider.x + narrowDivider.width / 2 + 60, narrowDivider.y + 80, { steps: 5 })
  await page.mouse.up()
  assert.ok(narrowWidth - await page.$eval('.ai-panel', (el) => el.getBoundingClientRect().width) > 40)
  await page.setViewport({ width: 1400, height: 900 })
  console.log('PASS wide terminal: 120 px reader reserve, responsive clamp and immediate drag after shrink')
  console.log('PASS right dock: no modal/backdrop/overlap, full reading height and persisted drag width')
  assert.equal(await page.$('input[name=token]'), null)
  assert.equal(await page.$('input[name=cwd]'), null)
  assert.ok((await page.$eval('.ai-disclosure', (el) => el.textContent)).includes('用户权限'))
  const start = frames().find((m) => m.type === 'start')
  assert.equal(start.projectId, 'standalone'); assert.equal(start.cmd, 'codex')
  await page.click('.xterm-helper-textarea')
  await page.keyboard.type('hello')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Escape')
  await page.keyboard.down('Control'); await page.keyboard.press('c'); await page.keyboard.up('Control')
  await pauseUntil(() => frames().filter((m) => m.type === 'stdin').map((m) => m.data).join('').includes('hello\r\x1b\x03'))
  await page.waitForFunction(() => document.querySelector('.xterm-rows')?.textContent.includes('ECHO:h'))
  assert.ok(await page.$('.ai-panel'))
  await page.setViewport({ width: 900, height: 700 })
  await pauseUntil(() => frames().some((m) => m.type === 'resize' && m.cols !== start.cols && m.rows !== start.rows))
  await page.keyboard.type('CRASH'); await page.keyboard.press('Enter')
  await page.click('.theme-toggle')
  const beforeReconnect = frames().filter((m) => m.type === 'connected').length
  await pauseUntil(() => frames().filter((m) => m.type === 'connected').length > beforeReconnect)
  await page.waitForFunction(() => document.querySelector('.ai-status')?.textContent === '已连接')
  assert.equal(await page.evaluate(() => document.activeElement?.className), 'theme-toggle')
  await page.click('.xterm-helper-textarea'); await page.keyboard.type('EXIT'); await page.keyboard.press('Enter')
  await page.waitForFunction(() => document.querySelector('.ai-status')?.textContent.includes('会话已结束'))
  const afterExit = frames().filter((m) => m.type === 'connected').length
  await new Promise((resolve) => setTimeout(resolve, 1500))
  assert.equal(frames().filter((m) => m.type === 'connected').length, afterExit)
  await page.click('.ai-actions button')
  await page.waitForFunction(() => document.querySelector('.ai-status')?.textContent === '已连接')
  console.log('PASS abnormal exit restarts without stealing reader focus; natural exit stays stopped')
  const closedBefore = frames().filter((m) => m.type === 'closed').length
  await page.click('button[aria-label="关闭 AI 终端"]')
  await pauseUntil(() => frames().filter((m) => m.type === 'closed').length > closedBefore)
  assert.equal(await page.evaluate(() => document.activeElement?.className), 'ai-toggle')
  console.log('PASS native process launch, terminal I/O, resize, EOF cleanup and mouse focus return')
  for (const [mode, expected] of [['version', '版本不兼容'], ['missing-cli', '尚未安装']]) {
    writeFileSync(scenario, mode)
    await page.click('.ai-toggle')
    await page.waitForFunction((text) => document.querySelector('.ai-status')?.textContent.includes(text), {}, expected)
    const count = frames().filter((m) => m.type === 'connected').length
    await new Promise((resolve) => setTimeout(resolve, 1200))
    assert.equal(frames().filter((m) => m.type === 'connected').length, count)
    await page.click('button[aria-label="关闭 AI 终端"]')
  }
  console.log('PASS incompatible host and absent CLI guidance stop retries')
  // Execute the actual identity implementation against real browser handles.
  // The injected test function is not part of either shipped build.
  const identity = ts.transpileModule(readFileSync(join(PROJECT, 'src/ai/projects.ts'), 'utf8').replaceAll('export ', ''),
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText + '\nwindow.identityUnderTest = projectIdentity;'
  await page.evaluate(identity)
  const ids = await page.evaluate(async () => {
    const storage = await navigator.storage.getDirectory()
    const one = await storage.getDirectoryHandle('one', { create: true })
    const two = await storage.getDirectoryHandle('two', { create: true })
    const a = await one.getDirectoryHandle('same-name', { create: true })
    const b = await two.getDirectoryHandle('same-name', { create: true })
    return [await window.identityUnderTest(a), await window.identityUnderTest(b), await window.identityUnderTest(a)]
  })
  assert.equal(ids[0].id, ids[2].id)
  assert.notEqual(ids[0].id, ids[1].id)
  await page.reload()
  await page.evaluate(identity)
  const remembered = await page.evaluate(async () => {
    const storage = await navigator.storage.getDirectory()
    const one = await storage.getDirectoryHandle('one')
    return window.identityUnderTest(await one.getDirectoryHandle('same-name'))
  })
  assert.equal(remembered.id, ids[0].id)
  console.log('PASS real directory handles: same-name projects are isolated and associations survive reload')

  assert.deepEqual(errors, [])
} finally { await browser.close(); rmSync(temp, { recursive: true, force: true }) }

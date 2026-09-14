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
  await page.click('.lang-toggle')
  assert.ok(await page.$('.ai-onboarding a[href="native-setup.en.html"]'))
  // Previously received status text is replaced on reconnect in the selected language.
  await page.click('.ai-actions button')
  await page.waitForFunction(() => !/\p{Script=Han}/u.test(document.querySelector('.ai-panel')?.textContent ?? ''))
  console.log('PASS English terminal labels, errors and installation guide')
  await page.click('.lang-toggle')
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
  await page.click('.ai-intro button')
  assert.equal(await page.$('.ai-intro'), null)
  assert.equal(await page.$('#ai-settings'), null)
  assert.ok(await page.$eval('.ai-heading', el => el.getBoundingClientRect().height <= 40))
  assert.ok(await page.evaluate(() => document.querySelector('.ai-terminal-host').getBoundingClientRect().top
    - document.querySelector('.ai-panel').getBoundingClientRect().top <= 40), 'steady state has only one toolbar above the terminal')
  await page.click('.ai-settings-toggle')
  assert.ok((await page.$eval('.ai-disclosure', (el) => el.textContent)).includes('用户权限'))
  await page.keyboard.press('Escape')
  assert.equal(await page.$('#ai-settings'), null)
  assert.ok(await page.$('.ai-panel'), 'Escape closes settings before closing the session')
  console.log('PASS compact toolbar, dismissible first-use notice and accessible settings disclosure')

  const startsBeforeDock = frames().filter(m => m.type === 'start').length
  const connectionsBeforeDock = frames().filter(m => m.type === 'connected').length
  const rightWidth = await page.$eval('.ai-panel', el => el.getBoundingClientRect().width)
  await page.click('.xterm-helper-textarea')
  await page.keyboard.sendCharacter('DOCK_MARKER')
  await page.waitForFunction(() => document.querySelector('.xterm-rows')?.textContent.includes('ECHO:DOCK_MARKER'))
  await page.evaluate(() => { window.terminalBeforeDock = document.querySelector('.xterm') })
  await page.click('.ai-dock-toggle')
  await page.waitForSelector('.ai-panel[data-dock="bottom"]')
  const bottom = await page.evaluate(() => {
    const p = document.querySelector('.ai-panel').getBoundingClientRect(), r = document.querySelector('.preview').getBoundingClientRect()
    return { top:p.top, readerBottom:r.bottom, left:p.left, readerLeft:r.left, width:p.width, readerWidth:r.width, height:p.height }
  })
  assert.ok(bottom.top >= bottom.readerBottom && Math.abs(bottom.left - bottom.readerLeft) < 1)
  assert.ok(Math.abs(bottom.width - bottom.readerWidth) < 1 && Math.abs(bottom.height - 300) < 1)
  assert.equal(await page.$eval('.ai-resizer', el => el.getAttribute('aria-orientation')), 'horizontal')
  const bottomDivider = await (await page.$('.ai-resizer')).boundingBox()
  await page.mouse.move(bottomDivider.x + 100, bottomDivider.y + 2)
  await page.mouse.down()
  await page.mouse.move(bottomDivider.x + 100, bottomDivider.y - 58, { steps:5 })
  await page.mouse.up()
  assert.equal(await page.evaluate(() => localStorage.getItem('lectern-ai-terminal-height')), '360')
  await page.focus('.ai-resizer')
  await page.keyboard.press('ArrowUp')
  assert.equal(await page.evaluate(() => localStorage.getItem('lectern-ai-terminal-height')), '370')
  await page.setViewport({ width:900, height:420 })
  // A tall terminal can already fit while squeezing the reader. Wait for the
  // ResizeObserver's reader reserve, not only for the terminal's outer edge.
  await page.waitForFunction(() => document.querySelector('.ai-panel').getBoundingClientRect().bottom <= innerHeight + 1
    && document.querySelector('.preview').getBoundingClientRect().height >= 119)
  assert.ok(await page.$eval('.preview', el => el.getBoundingClientRect().height >= 119))
  const shortHeight = await page.$eval('.ai-panel', el => el.getBoundingClientRect().height)
  const shortDivider = await (await page.$('.ai-resizer')).boundingBox()
  await page.mouse.move(shortDivider.x + 100, shortDivider.y + 2)
  await page.mouse.down()
  await page.mouse.move(shortDivider.x + 100, shortDivider.y + 42, { steps:5 })
  await page.mouse.up()
  assert.ok(shortHeight - await page.$eval('.ai-panel', el => el.getBoundingClientRect().height) > 30)
  const savedHeight = Number(await page.evaluate(() => localStorage.getItem('lectern-ai-terminal-height')))
  await page.setViewport({ width:1400, height:900 })
  await page.click('.ai-dock-toggle')
  assert.ok(Math.abs(await page.$eval('.ai-panel', el => el.getBoundingClientRect().width) - rightWidth) < 1)
  await page.click('.ai-dock-toggle')
  assert.ok(Math.abs(await page.$eval('.ai-panel', el => el.getBoundingClientRect().height) - savedHeight) < 1)
  // xterm 6 paints its current theme on the scrollable element; the legacy
  // viewport node still exists but does not own the visible terminal surface.
  const themeMatches = () => page.waitForFunction(() => getComputedStyle(document.querySelector('.xterm-scrollable-element')).backgroundColor
    === getComputedStyle(document.querySelector('.preview')).backgroundColor)
  await themeMatches()
  await page.click('.theme-toggle')
  await themeMatches()
  await page.click('.theme-toggle')
  await themeMatches()
  await page.click('.lang-toggle')
  await page.waitForFunction(() => document.querySelector('.ai-status')?.textContent === 'Connected')
  await page.click('.lang-toggle')
  assert.equal(await page.evaluate(() => window.terminalBeforeDock === document.querySelector('.xterm')), true)
  assert.ok(await page.$eval('.xterm-rows', el => el.textContent.includes('ECHO:DOCK_MARKER')))
  assert.equal(frames().filter(m => m.type === 'start').length, startsBeforeDock)
  assert.equal(frames().filter(m => m.type === 'connected').length, connectionsBeforeDock)
  console.log('PASS bottom dock, independent sizes, mouse/keyboard resize and responsive height clamp')
  console.log('PASS docking, live themes and language switches retain the terminal, output and native session')
  await page.click('.ai-dock-toggle')
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
  await page.click('.ai-dock-toggle')
  const closedBefore = frames().filter((m) => m.type === 'closed').length
  await page.click('button[aria-label="关闭 AI 终端"]')
  await pauseUntil(() => frames().filter((m) => m.type === 'closed').length > closedBefore)
  assert.equal(await page.evaluate(() => document.activeElement?.className), 'ai-toggle')
  console.log('PASS native process launch, terminal I/O, resize, EOF cleanup and mouse focus return')
  for (const [mode, expected] of [['version', '版本不兼容'], ['missing-cli', '尚未安装']]) {
    writeFileSync(scenario, mode)
    await page.click('.ai-toggle')
    assert.ok(await page.$('.ai-panel[data-dock="bottom"]'), 'dock position survives close and reopen')
    assert.equal(await page.$('.ai-intro'), null, 'acknowledged notice stays dismissed')
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

  // Drop a real directory into the production AI build. The file tree must
  // retain full height while the terminal occupies only the reader's width.
  writeFileSync(scenario, 'ok')
  const sampleProject = join(temp, 'terminal-layout-project')
  mkdirSync(sampleProject)
  writeFileSync(join(sampleProject, 'sample.ts'), 'export function greet(name: string): string {\n  return `Hello, ${name}`\n}\n\nexport const message = greet("Lectern")\n')
  const cdp = await page.createCDPSession()
  const target = await (await page.$('.welcome')).boundingBox()
  const drop = { x:target.x + 80, y:target.y + 80, data:{ items:[], files:[sampleProject], dragOperationsMask:1 } }
  await cdp.send('Input.dispatchDragEvent', { type:'dragEnter', ...drop })
  await cdp.send('Input.dispatchDragEvent', { type:'dragOver', ...drop })
  await cdp.send('Input.dispatchDragEvent', { type:'drop', ...drop })
  await page.waitForSelector('.sidebar .tree-row')
  await page.$$eval('.tree-row', rows => rows.find(row => row.querySelector('.label')?.textContent === 'sample.ts').click())
  await page.waitForSelector('.cm-content')
  await page.click('.ai-toggle')
  await page.waitForFunction(() => document.querySelector('.ai-status')?.textContent === '已连接')
  assert.ok(await page.$('.ai-panel[data-dock="bottom"]'), 'dock position survives page reload')
  await page.setViewport({ width:1400, height:900 })
  await page.waitForFunction(() => document.querySelector('.ai-panel').getBoundingClientRect().right <= innerWidth + 1)
  const projectLayout = await page.evaluate(() => {
    const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,height:r.height} }
    return { tree:rect('.sidebar'), reader:rect('.preview'), terminal:rect('.ai-panel'), main:rect('.main') }
  })
  assert.ok(Math.abs(projectLayout.tree.height - projectLayout.main.height) < 1)
  assert.ok(Math.abs(projectLayout.terminal.left - projectLayout.reader.left) < 1)
  assert.ok(projectLayout.terminal.left >= projectLayout.tree.right)
  assert.ok(projectLayout.terminal.top >= projectLayout.reader.bottom)
  const projectStarts = frames().filter(m => m.type === 'start').length
  // Screenshots are optional local QA output and never included in the build.
  if (process.env.LECTERN_AI_SHOTS) {
    mkdirSync(process.env.LECTERN_AI_SHOTS, { recursive:true })
    await page.focus('.ai-resizer')
    await page.keyboard.press('Home')
    for (let i = 0; i < 3; i++) { await page.keyboard.down('Shift'); await page.keyboard.press('ArrowUp'); await page.keyboard.up('Shift') }
    if (await page.$eval('html', el => el.dataset.theme) !== 'light') await page.click('.theme-toggle')
    await themeMatches()
    await page.click('.xterm-helper-textarea')
    await page.screenshot({ path:join(process.env.LECTERN_AI_SHOTS, 'bottom-light.png') })
    await page.click('.theme-toggle')
    await themeMatches()
    await page.screenshot({ path:join(process.env.LECTERN_AI_SHOTS, 'bottom-dark.png') })
  }
  await page.click('.ai-dock-toggle')
  assert.ok(await page.$('.ai-panel[data-dock="right"]'))
  await page.focus('.ai-resizer')
  await page.keyboard.press('Home')
  for (let i = 0; i < 4; i++) { await page.keyboard.down('Shift'); await page.keyboard.press('ArrowLeft'); await page.keyboard.up('Shift') }
  if (process.env.LECTERN_AI_SHOTS) {
    await page.click('.xterm-helper-textarea')
    await page.screenshot({ path:join(process.env.LECTERN_AI_SHOTS, 'right-dark.png') })
  }
  await page.click('[data-project-view="changes"]')
  await page.waitForSelector('.git-project-view:not([hidden]) .git-comparison')
  await page.click('.ai-dock-toggle')
  await page.waitForFunction(() => document.querySelector('.ai-panel').getBoundingClientRect().top
    >= document.querySelector('.git-project-view:not([hidden])').getBoundingClientRect().bottom)
  await page.click('[data-project-view="files"]')
  await page.waitForSelector('.sidebar .tree-row')
  assert.equal(frames().filter(m => m.type === 'start').length, projectStarts, 'file/Git and dock switches must preserve the session')
  console.log('PASS project tree stays full height; file/Git views and persisted docking share one session')

  assert.deepEqual(errors, [])
} catch (error) {
  const failedPage = (await browser.pages()).at(-1)
  if (failedPage) {
    console.error('Browser failure context:', JSON.stringify(await failedPage.evaluate(() => ({
      theme:document.documentElement.dataset.theme,
      elements:['.reader-workspace','.preview','.ai-panel','.ai-terminal-host','.xterm-viewport','.xterm-scrollable-element'].map(selector => {
        const el=document.querySelector(selector)
        if (!el) return {selector,missing:true}
        const r=el.getBoundingClientRect(), css=getComputedStyle(el)
        return {selector,rect:{x:r.x,y:r.y,width:r.width,height:r.height},background:css.backgroundColor,inline:el.getAttribute('style')}
      }),
    }))))
    if (process.env.LECTERN_AI_SHOTS) {
      mkdirSync(process.env.LECTERN_AI_SHOTS, {recursive:true})
      await failedPage.screenshot({path:join(process.env.LECTERN_AI_SHOTS,'failure.png')})
    }
  }
  throw error
} finally { await browser.close(); rmSync(temp, { recursive: true, force: true }) }

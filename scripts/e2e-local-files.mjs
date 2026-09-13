// 本地文件接管回归：独立 Chrome profile + 真实 file:// 导航，不接触用户的浏览器。
// 默认只构建 dist-local-e2e；不运行旧 E2E、不覆盖 dist-dev 或发布产物。
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import puppeteer from 'puppeteer-core'
import { PROJECT, resolveChrome } from './paths.mjs'

const DIST = join(PROJECT, 'dist-local-e2e')
if (!process.argv.includes('--skip-build')) {
  const build = spawnSync(process.execPath, [
    join(PROJECT, 'node_modules/vite/bin/vite.js'), 'build',
    '--mode', 'development', '--outDir', DIST,
  ], { cwd: PROJECT, stdio: 'inherit' })
  assert.equal(build.status, 0, '本地文件 E2E 构建失败')
}

const sandbox = mkdtempSync(join(tmpdir(), 'lectern-local-files-e2e-'))
const files = join(sandbox, 'files')
mkdirSync(files)
const fixtures = {
  'guide.md': '# Local guide\n\n## Installation\n\nLOCAL_MARKDOWN_CONTENT\n\n<a href="#local-anchor">Go to anchor</a>\n\n<h3 id="local-anchor">Local anchor</h3>\n\n![remote](https://example.invalid/never-request.png)\n',
  'query.sql': 'SELECT 73 AS LOCAL_SQL_CONTENT;\n',
  'LocalSample.java': [
    'public class LocalSample {',
    '  public static int answer() { return 73; }',
    '  public static int caller() { return answer(); }',
    '}', '',
  ].join('\n'),
  '中文 空格 # & % +.MD': '# Encoded path\n\nSPECIAL_PATH_CONTENT\n',
  'page.html': '<!doctype html><html><body><h1>NATIVE_HTML_CONTENT</h1><script>window.nativeHtmlRan = true</script></body></html>',
  'frame-host.html': '<!doctype html><html><body>FRAME_HOST<iframe src="query.sql"></iframe></body></html>',
  'large.sql': '// LARGE_START\n' + 'SELECT 1;\n'.repeat(600_000) + '// LARGE_END_MARKER\n',
}
for (const [name, content] of Object.entries(fixtures)) writeFileSync(join(files, name), content)
writeFileSync(join(files, 'pixel.png'), Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jlp8AAAAASUVORK5CYII=', 'base64',
))
mkdirSync(join(files, 'directory.md'))
writeFileSync(join(files, 'directory.md', 'nested.txt'), 'directory remains native')

const results = []
const httpRequests = []
const pageErrors = []
const downloads = []
const navigationModes = new Map()
let browser
let server
const serverSockets = new Set()
let management
let control
let extensionId
let defaults

function check(name, ok, extra = '') {
  results.push({ name, ok: !!ok, extra })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`)
}

async function scenario(name, operation) {
  try { await operation() }
  catch (error) { check(name, false, error?.stack ?? String(error)) }
}

function watch(page) {
  page.on('request', (request) => {
    if (/^https?:/i.test(request.url())) httpRequests.push(request.url())
  })
  page.on('pageerror', (error) => pageErrors.push(error.message))
  return page
}

const fileUrl = (name) => pathToFileURL(join(files, name)).href
const isViewer = (url) => url.startsWith(`chrome-extension://${extensionId}/viewer.html#file=`)
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function closeServer() {
  if (!server) return
  // Chrome 的预连接可能尚未发送 HTTP 请求；显式销毁本测试服务的 socket，
  // 避免 server.close() 为一个没有 request 的连接无限等待。
  for (const socket of serverSockets) socket.destroy()
  await new Promise((resolve) => server.close(resolve))
  server = null
}

async function newControl() {
  if (control && !control.isClosed()) await control.close()
  control = watch(await browser.newPage())
  // 本套用例断言中文文案；固定扩展源的语言，供随后接管的文件标签页复用。
  await control.evaluateOnNewDocument(() => localStorage.setItem('cv-lang', 'zh'))
  await control.goto(`chrome-extension://${extensionId}/viewer.html`, { waitUntil: 'load' })
  await control.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.includes('自动打开')))
}

async function message(payload) {
  const response = await control.evaluate((value) => chrome.runtime.sendMessage(value), payload)
  assert.equal(response?.ok, true, `后台消息失败: ${JSON.stringify(response)}`)
  return response
}

const settings = () => message({ type: 'local-files:get-settings' })
const save = (config) => message({ type: 'local-files:save-settings', config })

async function setFileAccess(enabled) {
  // 文件权限变化会重载 unpacked 扩展。必须先开启开发者模式，避免 Chrome 152 禁用它。
  await management.evaluate(async ({ id, enabled }) => {
    await chrome.developerPrivate.updateExtensionConfiguration({ extensionId: id, fileAccess: enabled })
  }, { id: extensionId, enabled })
  await management.waitForFunction(async ({ id, enabled }) => {
    const extension = await chrome.developerPrivate.getExtensionInfo(id)
    return extension.state === 'ENABLED' && extension.fileAccess.isActive === enabled
  }, { timeout: 15_000 }, { id: extensionId, enabled })
  await newControl()
  assert.equal((await settings()).fileAccess, enabled)
}

async function openFile(name, { intercepted = true, selector, text, tail = '', encodedExtension = false, directory = false } = {}) {
  const page = watch(await browser.newPage())
  const beforeTabs = (await browser.pages()).length
  const target = page.target()
  const url = (encodedExtension ? fileUrl(name).replace(/\.MD$/, '%2e%4D%44').replace(/\.md$/, '.%6d%64') : fileUrl(name)) + tail
  // 保存事件发生时的导航模式；同一 URL 还会在撤权/关闭配置时作为原生基线打开。
  navigationModes.set(url.split('#')[0], intercepted)
  await page.goto(url, { waitUntil: 'load', timeout: 15_000 }).catch((error) => {
    // 浏览器可以原生下载未接管类型，只有这个导航错误属于正常基线。
    if (intercepted || !error.message.includes('ERR_ABORTED')) throw error
  })
  if (intercepted) {
    await page.waitForFunction(() => location.protocol === 'chrome-extension:' && location.hash.startsWith('#file='))
    assert.ok(isViewer(page.url()), `未接管 ${url}: ${page.url()}`)
    assert.equal(page.target(), target, '接管必须保留原标签页')
    assert.equal((await browser.pages()).length, beforeTabs, '接管不应新增标签页')
    if (selector) await page.waitForSelector(selector, { timeout: 15_000 })
    if (text) await page.waitForFunction((expected) => document.body.innerText.includes(expected), { timeout: 15_000 }, text)
  } else {
    if (directory) await page.waitForFunction(() => location.protocol === 'file:' && location.pathname.endsWith('/'))
    // DNR 重定向随导航同步提交；加载完成后无需固定长等待。
    assert.equal(isViewer(page.url()), false, `不应接管 ${url}`)
  }
  return page
}

async function withFile(name, options, operation = async () => {}) {
  const page = await openFile(name, options)
  try { await operation(page) } finally { await page.close() }
}

async function waitOutline(page, name) {
  await page.waitForFunction((value) => [...document.querySelectorAll('.outline-name')].some((e) => e.textContent === value),
    { timeout: 20_000 }, name)
}

async function clickJavaCall(page) {
  const point = await page.evaluate(() => {
    const line = [...document.querySelectorAll('.cm-line')].find((e) => e.textContent.includes('return answer()'))
    if (!line) return null
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT)
    let node
    while ((node = walker.nextNode())) {
      const offset = node.textContent.indexOf('answer')
      if (offset < 0) continue
      const range = document.createRange()
      range.setStart(node, offset)
      range.setEnd(node, offset + 'answer'.length)
      const rect = range.getBoundingClientRect()
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
    }
    return null
  })
  assert.ok(point, 'Java 调用点必须在预览中可见')
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
  await page.keyboard.down(modifier)
  try { await page.mouse.click(point.x, point.y) }
  finally { await page.keyboard.up(modifier) }
  await page.waitForFunction(() => document.querySelector('.cm-target-line')?.textContent.includes('int answer()'), { timeout: 10_000 })
}

try {
  browser = await puppeteer.launch({
    executablePath: resolveChrome(), headless: false, pipe: true, enableExtensions: true,
    args: [`--user-data-dir=${join(sandbox, 'profile')}`, '--no-first-run', '--no-default-browser-check', '--window-size=1400,900'],
    defaultViewport: { width: 1380, height: 850 },
  })
  extensionId = await browser.installExtension(DIST)
  console.log(`Chrome: ${await browser.version()} | 临时数据: ${sandbox}`)
  management = await browser.newPage()
  await management.goto('chrome://extensions/')
  await management.evaluate(() => chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }))
  const browserSession = await browser.target().createCDPSession()
  await browserSession.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: join(sandbox, 'downloads'), eventsEnabled: true })
  browserSession.on('Browser.downloadWillBegin', (event) => downloads.push({
    url: event.url, intercepted: navigationModes.get(event.url.split('#')[0]) === true,
  }))

  await setFileAccess(false)
  defaults = (await settings()).config
  assert.ok(Array.isArray(defaults.extensions), '配置必须提供后缀列表')
  check('默认候选包含 md/sql/java，HTML 与图片默认不接管',
    ['md', 'sql', 'java'].every((ext) => defaults.extensions.includes(ext)) &&
    !['html', 'htm', 'png', 'svg'].some((ext) => defaults.extensions.includes(ext)))
  const enabledDefaults = { ...defaults, enabled: true }
  await save(enabledDefaults)

  await scenario('未允许访问文件网址时保留原生打开', async () => {
    await withFile('guide.md', { intercepted: false })
    check('未允许访问文件网址时保留原生打开', true)
  })

  await setFileAccess(true)
  await save(enabledDefaults)

  await scenario('自动打开配置入口和候选', async () => {
    await control.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('自动打开')).click())
    await control.waitForSelector('dialog.local-file-settings[open] .local-file-settings-controls')
    const dialog = await control.$eval('dialog.local-file-settings[open]', (el) => ({
      text: el.textContent, checkboxes: el.querySelectorAll('input[type="checkbox"]').length,
    }))
    await control.screenshot({ path: join(sandbox, 'settings.png') })
    console.log(`设置预览: ${join(sandbox, 'settings.png')}`)
    check('配置弹窗提供已支持后缀与复选框', ['md', 'sql', 'java'].every((ext) => dialog.text.includes(ext)) && dialog.checkboxes > 3)
    await control.click('.local-file-settings-enabled input')
    await control.click('.local-file-settings-save')
    await control.waitForFunction(() => document.querySelector('.local-file-settings-save-status')?.textContent.includes('已保存'))
    assert.equal((await settings()).config.enabled, false)
    await withFile('guide.md', { intercepted: false })
    check('设置界面修改并保存总开关后真实导航立即生效', true)
    await control.click('.local-file-settings-enabled input')
    await control.evaluate(() => [...document.querySelectorAll('.local-file-settings-bulk-actions button')].find((button) => button.textContent === '全选').click())
    await control.click('.local-file-settings-save')
    await control.waitForFunction(() => document.querySelector('.local-file-settings-save-status')?.textContent.includes('已保存'))
    const all = await settings()
    assert.ok(all.config.enabled && all.config.extensions.length === dialog.checkboxes - 1)
    const ruleCount = await control.evaluate(async () => (await chrome.declarativeNetRequest.getDynamicRules()).length)
    check('全部支持后缀可同时保存并装载规则', ruleCount >= all.config.extensions.length, `${all.config.extensions.length} 个后缀 / ${ruleCount} 条规则`)
    await control.click('[aria-label="关闭本地文件设置"]')
    await save(enabledDefaults)
  })

  await scenario('Markdown 同标签页接管、正文和大纲', async () => {
    await withFile('guide.md', { selector: '.markdown-body', text: 'LOCAL_MARKDOWN_CONTENT' }, async (page) => {
      await waitOutline(page, 'Installation')
      check('Markdown 同标签页接管、正文和大纲', true)
    })
  })
  await scenario('SQL 同标签页接管并高亮', async () => {
    await withFile('query.sql', { selector: '.cm-content', text: 'LOCAL_SQL_CONTENT' }, async (page) => {
      await page.waitForFunction(() => window.__cvCodeState?.()?.distinctSpanClasses > 0)
      check('SQL 同标签页接管并高亮', true)
    })
  })
  await scenario('Java 同标签页接管、大纲与文件内跳转', async () => {
    await withFile('LocalSample.java', { selector: '.cm-content', text: 'return answer()' }, async (page) => {
      await waitOutline(page, 'answer')
      await clickJavaCall(page)
      check('Java 同标签页接管、大纲与文件内跳转', true)
    })
  })
  await scenario('大写后缀、编码字符、query 与 fragment', async () => {
    await withFile('中文 空格 # & % +.MD', { selector: '.markdown-body', text: 'SPECIAL_PATH_CONTENT', tail: '?check=1#anchor' }, async (page) => {
      const name = await page.$eval('.preview-header .file-path', (el) => el.textContent)
      check('大写后缀、编码字符、query 与 fragment', name.includes('中文 空格 # & % +.MD'), name)
    })
  })
  await scenario('刷新读取外部修改后的新内容', async () => {
    await withFile('query.sql', { selector: '.cm-content', text: 'LOCAL_SQL_CONTENT' }, async (page) => {
      writeFileSync(join(files, 'query.sql'), 'SELECT 91 AS REFRESHED_SQL_CONTENT;\n')
      await page.reload({ waitUntil: 'load' })
      await page.waitForFunction(() => document.querySelector('.cm-content')?.textContent.includes('REFRESHED_SQL_CONTENT'))
      check('刷新读取外部修改后的新内容', true)
    })
  })
  await scenario('编码后的大小写后缀均接管', async () => {
    await withFile('guide.md', { encodedExtension: true, selector: '.markdown-body' })
    await withFile('中文 空格 # & % +.MD', { encodedExtension: true, selector: '.markdown-body', text: 'SPECIAL_PATH_CONTENT' })
    check('编码后的大小写后缀均接管', true)
  })
  await scenario('Markdown 页内链接保留来源并可刷新', async () => {
    await withFile('guide.md', { selector: '.markdown-body' }, async (page) => {
      const url = page.url()
      await page.click('.markdown-body a[href="#local-anchor"]')
      assert.equal(page.url(), url)
      await page.reload({ waitUntil: 'load' })
      await page.waitForSelector('.markdown-body')
      assert.ok(await page.$eval('.markdown-body', (body) => body.textContent.includes('LOCAL_MARKDOWN_CONTENT')))
      check('Markdown 页内链接保留来源并可刷新', true)
    })
  })
  await scenario('较慢的自动读取不能覆盖随后手动选择', async () => {
    const page = watch(await browser.newPage())
    try {
      await page.evaluateOnNewDocument(() => {
        const transport = window.fetch
        window.fetch = async (...args) => {
          if (String(args[0]).startsWith('file:')) {
            await new Promise((resolve) => { window.__releaseAutomaticRead = resolve })
          }
          return transport(...args)
        }
        window.showOpenFilePicker = () => new Promise((resolve) => { window.__completePicker = resolve })
      })
      await page.goto(fileUrl('guide.md'), { waitUntil: 'load' })
      await page.waitForFunction(() => typeof window.__releaseAutomaticRead === 'function')
      await page.evaluate(() => [...document.querySelectorAll('.local-file-entry button')].find((button) => button.textContent === '打开文件').click())
      await page.waitForFunction(() => typeof window.__completePicker === 'function')
      await page.evaluate(() => window.__releaseAutomaticRead())
      await page.waitForFunction(() => !document.querySelector('.local-file-entry'))
      await page.evaluate(async () => {
        const root = await navigator.storage.getDirectory()
        const handle = await root.getFileHandle('picked.txt', { create: true })
        const writable = await handle.createWritable()
        await writable.write('PICKER_WINS_AFTER_AUTOMATIC_READ')
        await writable.close()
        window.__completePicker([handle])
      })
      await page.waitForFunction(() => document.querySelector('.cm-content')?.textContent.includes('PICKER_WINS_AFTER_AUTOMATIC_READ'))
      assert.equal(new URL(page.url()).hash, '')
      check('较慢的自动读取不能覆盖随后手动选择', true)
    } finally { await page.close() }
  })

  await scenario('关闭总开关、单后缀取消、空配置与恢复', async () => {
    await save({ ...enabledDefaults, enabled: false })
    await withFile('guide.md', { intercepted: false })
    check('关闭总开关后不接管', true)
    await save({ ...enabledDefaults, extensions: enabledDefaults.extensions.filter((ext) => ext !== 'sql') })
    await withFile('query.sql', { intercepted: false })
    await withFile('guide.md', { selector: '.markdown-body' })
    check('取消 sql 只影响该后缀', true)
    await save({ enabled: true, extensions: [] })
    await withFile('guide.md', { intercepted: false })
    await withFile('LocalSample.java', { intercepted: false })
    check('空后缀配置不接管任何文件', true)
    await save(enabledDefaults)
    await withFile('query.sql', { selector: '.cm-content', text: 'REFRESHED_SQL_CONTENT' })
    check('恢复配置后立即接管', true)
  })

  await scenario('HTML、图片默认原生打开，可显式选择接管', async () => {
    await save(enabledDefaults)
    await withFile('page.html', { intercepted: false }, async (page) => {
      assert.equal(await page.evaluate(() => window.nativeHtmlRan), true)
    })
    await withFile('pixel.png', { intercepted: false })
    check('HTML、图片默认原生打开', true)
    await save({ ...enabledDefaults, extensions: [...enabledDefaults.extensions, 'html', 'png'] })
    await withFile('page.html', { selector: '.cm-content', text: 'NATIVE_HTML_CONTENT' }, async (page) => {
      assert.equal(await page.evaluate(() => window.nativeHtmlRan), undefined, 'HTML 接管展示源码，不执行脚本')
    })
    await withFile('pixel.png', { selector: '.image-view img' }, async (page) => {
      await page.waitForFunction(() => { const img = document.querySelector('.image-view img'); return img.complete && img.naturalWidth === 1 })
    })
    check('HTML、图片选择后进入对应预览且不执行 HTML', true)
    await save(enabledDefaults)
  })

  await scenario('目录、iframe 与 HTTP 不接管', async () => {
    await withFile('directory.md/', { intercepted: false })
    await withFile('directory.md', { intercepted: false, directory: true })
    check('具有后缀的目录保留原生目录页', true)
    await withFile('frame-host.html', { intercepted: false }, async (page) => {
      const frame = page.frames().find((candidate) => candidate.url() === fileUrl('query.sql'))
      assert.ok(frame, '嵌套 frame 必须保留 file URL')
      await frame.waitForFunction(() => document.body.textContent.includes('REFRESHED_SQL_CONTENT'))
      assert.ok(!page.frames().some((frame) => isViewer(frame.url())))
    })
    check('嵌套 iframe 文件不接管', true)
    server = createServer((_request, response) => { response.writeHead(200, { 'Content-Type': 'text/plain' }); response.end('HTTP_NATIVE_CONTENT') })
    server.on('connection', (socket) => {
      serverSockets.add(socket)
      socket.on('close', () => serverSockets.delete(socket))
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = server.address().port
    // 此页是明确发起的本地 HTTP 边界测试；不计入扩展页面的零 HTTP 断言。
    const page = await browser.newPage()
    try {
      const url = `http://127.0.0.1:${port}/sample.md`
      await page.goto(url, { waitUntil: 'load' })
      assert.equal(page.url(), url)
      assert.ok((await page.$eval('body', (el) => el.textContent)).includes('HTTP_NATIVE_CONTENT'))
      check('HTTP 相同后缀保持原生打开', true)
    } finally { await page.close(); await closeServer() }
  })

  await scenario('缺失文件有明确读取错误', async () => {
    await withFile('missing.md', { selector: '.local-file-entry[role="alert"]' }, async (page) => {
      const error = await page.$eval('.local-file-entry[role="alert"]', (el) => el.textContent)
      check('缺失文件有明确读取错误', /失败|不存在|读取|打开/.test(error), error.trim())
    })
  })
  await scenario('超过 5 MB 的文件沿用截断边界', async () => {
    await withFile('large.sql', { selector: '.cm-content', text: 'LARGE_START' }, async (page) => {
      const notice = await page.$$eval('.preview-notice', (els) => els.map((el) => el.textContent).join(' '))
      assert.ok(notice.includes('截断') && notice.includes('5 MB'), notice)
      assert.equal(await page.evaluate(() => document.body.innerText.includes('LARGE_END_MARKER')), false)
      check('超过 5 MB 的文件沿用截断与大纲限制提示', true)
    })
  })

  await scenario('扩展重载后保留配置并自动恢复规则', async () => {
    const expected = { enabled: true, extensions: ['java', 'md'] }
    await save(expected)
    await control.evaluate(() => chrome.runtime.reload()).catch((error) => {
      if (!/context|closed|detached/i.test(error.message)) throw error
    })
    await delay(250)
    await newControl()
    const restored = await settings()
    assert.equal(restored.config.enabled, true)
    assert.deepEqual([...restored.config.extensions].sort(), [...expected.extensions].sort())
    await withFile('query.sql', { intercepted: false })
    await withFile('guide.md', { selector: '.markdown-body', text: 'LOCAL_MARKDOWN_CONTENT' })
    check('扩展重载后保留配置并自动恢复规则', true)
    await save(enabledDefaults)
  })

  await scenario('撤销文件权限后停止接管，恢复权限后恢复', async () => {
    await setFileAccess(false)
    await withFile('guide.md', { intercepted: false })
    await setFileAccess(true)
    await withFile('guide.md', { selector: '.markdown-body' })
    check('撤销文件权限后停止接管，恢复权限后恢复', true)
  })

  check('扩展与接管页面没有 HTTP(S) 请求', httpRequests.length === 0, httpRequests.join(', '))
  check('页面没有未捕获异常', pageErrors.length === 0, [...new Set(pageErrors)].join(', '))
  const interceptedDownloads = downloads.filter((event) => event.intercepted).map((event) => event.url)
  check('本地文件接管没有触发下载', interceptedDownloads.length === 0, interceptedDownloads.join(', '))
} catch (error) {
  check('E2E 初始化或关键步骤', false, error?.stack ?? String(error))
} finally {
  await closeServer()
  if (browser) await browser.close()
}

const failed = results.filter((result) => !result.ok)
console.log(`\n${results.length - failed.length}/${results.length} PASS; ${failed.length} FAIL`)
if (failed.length) process.exitCode = 1

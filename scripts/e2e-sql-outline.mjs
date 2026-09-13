// SQL outline: real Worker extraction, project/single-file navigation, and search isolation.
// Run: node scripts/e2e-sql-outline.mjs
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import puppeteer from 'puppeteer-core'
import { PROJECT, resolveChrome } from './paths.mjs'

const scratch = mkdtempSync(join(tmpdir(), 'lectern-sql-e2e-'))
const dist = join(scratch, 'dist')
const sql = [
  '-- SELECT fake FROM ignored;',
  'CREATE TABLE outline_users (id INTEGER);',
  '',
  'WITH active AS (',
  '  SELECT * FROM outline_users',
  ')',
  'SELECT * FROM active;',
  '',
  'INSERT INTO outline_users VALUES (1);',
].join('\n')
let browser
const errors = []
const network = []

try {
  const build = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['vite', 'build', '--mode', 'development', '--outDir', dist],
    { cwd: PROJECT, stdio: 'inherit' })
  if (build.error) throw build.error
  assert.equal(build.status, 0, 'Development build failed')
  browser = await puppeteer.launch({
    executablePath: resolveChrome(), headless: false, pipe: true, enableExtensions: true,
    args: [`--user-data-dir=${join(scratch, 'profile')}`, '--no-first-run', '--no-default-browser-check'],
    defaultViewport: { width: 1400, height: 850 },
  })
  const extensionId = await browser.installExtension(dist)
  const page = await browser.newPage()
  // Text assertions below use Chinese regardless of the host browser locale.
  await page.evaluateOnNewDocument(() => localStorage.setItem('cv-lang', 'zh'))
  page.setDefaultTimeout(10000)
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('request', (r) => { if (/^https?:/i.test(r.url())) network.push(r.url()) })
  await page.goto(`chrome-extension://${extensionId}/viewer.html`)
  await page.waitForSelector('.welcome')
  const rows = () => page.$$eval('.outline-row', (items) => items.map((el) => ({
    name: el.querySelector('.outline-name').textContent,
    line: Number(el.querySelector('.outline-line').textContent),
    badge: el.querySelector('.outline-kind').textContent,
  })))
  const waitSql = () => page.waitForFunction(() =>
    document.querySelector('.intel-lang')?.textContent === 'SQL' &&
    document.querySelectorAll('.outline-row').length === 3)

  await page.evaluate((text) => window.__cv.enterSingleFile(new File([text], 'outline.sql')), sql)
  await waitSql()
  assert.deepEqual((await rows()).map((r) => r.line), [2, 4, 9])
  assert((await rows()).every((r) => r.badge === 'Q'))
  assert.equal(await page.$eval('.intel-cap', (el) => el.textContent), '仅大纲')
  console.log('PASS  single SQL file lists definitions and top-level statements through the Worker')

  await page.$$eval('.outline-row', (items) => items[1].click())
  await page.waitForFunction(() => window.__cv.caretLine.value === 4)
  await page.focus('.outline-body')
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => window.__cv.caretLine.value === 9 &&
    document.activeElement?.classList.contains('cm-content'))
  console.log('PASS  mouse and keyboard outline navigation land on the correct statement line')

  await page.evaluate(() => window.__cv.enterSingleFile(new File(['SELECT 1; SELECT 2;'], 'same-line.sql')))
  await page.waitForFunction(() => document.querySelectorAll('.outline-row').length === 2)
  const ids = await page.$$eval('.outline-row', (items) => items.map((el) => el.id))
  assert.equal(new Set(ids).size, 2)
  assert(ids.every((id) => !/\s/.test(id)))
  await page.focus('.outline-body')
  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowDown')
  await page.waitForFunction((id) => document.querySelector('.outline-body')?.getAttribute('aria-activedescendant') === id, {}, ids[1])
  assert.equal(await page.$eval('.outline-body', (el) => el.getAttribute('aria-activedescendant')), ids[1])
  assert.equal(await page.$$eval('.outline-row[aria-selected="true"]', (items) => items.length), 1)
  console.log('PASS  same-line queries have distinct accessible rows and keyboard selection')

  await page.evaluate(async (text) => {
    const root = await navigator.storage.getDirectory()
    for (const [name, contents] of [
      ['outline.sql', text], ['marker.ts', 'export const outlineMarker = 1'],
      ['notes.md', '# Markdown heading'], ['config.yaml', 'version: 1'],
    ]) {
      const handle = await root.getFileHandle(name, { create: true })
      const writer = await handle.createWritable()
      await writer.write(contents)
      await writer.close()
    }
    window.__cv.enterProject(root)
  }, sql)
  await page.waitForSelector('.tree-row')
  const openFile = async (name) => {
    await page.$$eval('.tree-row', (items, name) => {
      const row = items.find((el) => el.querySelector('.label')?.textContent === name)
      if (!row) throw new Error(`Missing fixture file: ${name}`)
      row.click()
    }, name)
  }
  await openFile('outline.sql')
  await waitSql()
  await page.waitForSelector('.intel-badge .intel-index-done')
  assert.deepEqual((await rows()).map((r) => r.line), [2, 4, 9])
  await page.$$eval('.outline-row', (items) => items[2].click())
  await page.waitForFunction(() => window.__cv.caretLine.value === 9)
  console.log('PASS  project indexing retains the SQL outline and file navigation')

  await page.$$eval('.search-mode', (buttons) => {
    const symbolMode = buttons.find((el) => el.textContent.includes('符号'))
    if (!symbolMode) throw new Error('Symbol search mode is missing')
    symbolMode.click()
  })
  await page.type('.search-input', 'outline')
  await page.waitForSelector('.search-result')
  const matches = await page.$$eval('.search-result', (items) => items.map((el) => el.textContent))
  assert.equal(matches.length, 1)
  assert(matches[0].includes('outlineMarker'))
  await page.keyboard.press('Escape')
  console.log('PASS  SQL entries stay out of global symbol search; TypeScript symbols remain searchable')

  await openFile('notes.md')
  await page.waitForFunction(() => document.querySelector('.outline-name')?.textContent === 'Markdown heading')
  assert.equal((await rows())[0].badge, 'H')
  await openFile('config.yaml')
  await page.waitForFunction(() => document.querySelector('.outline-note')?.textContent.includes('暂不支持大纲'))
  assert.equal((await rows()).length, 0)
  console.log('PASS  switching languages preserves Markdown support and clears stale SQL rows')
  assert.deepEqual(errors, [])
  assert.deepEqual(network, [])
  console.log('PASS  no page errors or remote requests')
} finally {
  if (browser) await browser.close()
  rmSync(scratch, { recursive: true, force: true })
}

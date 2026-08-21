// "已隐藏 N 项"行的双主题视觉自检(change: add-heavy-dir-exclusion,任务 2.4 / 4.7)。
//
// E2E 能断言这行存在、N 正确、点击能展开,但**断言不了"它看起来不像一个目录"** ——
// 而 2.4 要的恰恰是这个:它是提示不是目录,用户得一眼分得出来。这只能人眼看。
// 折叠态与展开态各截一张:展开后它下面挂着真目录,"提示 vs 目录"的对比就在同一张图里。
import puppeteer from 'puppeteer-core'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PROJECT, SCRIPTS, resolveChrome } from './paths.mjs'

const DIST = join(PROJECT, 'dist-dev')
const SHOTS = SCRIPTS
const CHROME = resolveChrome()

console.log('building dev bundle…')
execSync('npx vite build --mode development --outDir dist-dev', { cwd: PROJECT, stdio: 'inherit' })

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  pipe: true,
  enableExtensions: true,
  args: [`--user-data-dir=${mkdtempSync(join(tmpdir(), 'cv-hidden-'))}`, '--no-first-run', '--no-default-browser-check'],
  defaultViewport: { width: 1200, height: 340, deviceScaleFactor: 3 },
})

const shot = async (page, name) => {
  await new Promise((r) => setTimeout(r, 350))
  await (await page.$('.sidebar')).screenshot({ path: join(SHOTS, name) })
  console.log('截图:', name)
}

try {
  const extId = await browser.installExtension(DIST)
  const page = await browser.newPage()
  await page.goto(`chrome-extension://${extId}/viewer.html`, { waitUntil: 'load' })
  await page.waitForSelector('.welcome', { timeout: 10000 })

  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    for await (const n of root.keys()) await root.removeEntry(n, { recursive: true })
    const write = async (dir, name, content = '') => {
      const fh = await dir.getFileHandle(name, { create: true })
      const w = await fh.createWritable(); await w.write(content); await w.close()
    }
    const src = await root.getDirectoryHandle('src', { create: true })
    await write(src, 'main.go', 'package main')
    await write(src, 'app.ts', 'export const a = 1')
    const docs = await root.getDirectoryHandle('docs', { create: true })
    await write(docs, 'README.md', '# hi')
    await write(root, 'package.json', '{}')
    // 被排除的三个:名单里各挑一类(版本库 / 依赖 / 构建产物)
    const nm = await root.getDirectoryHandle('node_modules', { create: true })
    const lodash = await nm.getDirectoryHandle('lodash', { create: true })
    await write(lodash, 'index.js', 'export const x = 1')
    const git = await root.getDirectoryHandle('.git', { create: true })
    await write(git, 'HEAD', 'ref: refs/heads/main')
    const dist = await root.getDirectoryHandle('dist', { create: true })
    await write(dist, 'bundle.js', 'x')
  })

  await page.evaluate(async () => { window.__cv.enterProject(await navigator.storage.getDirectory()) })
  await page.waitForSelector('.tree-row', { timeout: 10000 })
  await new Promise((r) => setTimeout(r, 500))

  const hiddenText = await page.$eval('.tree-row.tree-hidden .label', (el) => el.textContent)
  console.log('提示行文案:', hiddenText)

  await shot(page, 'hidden-collapsed-light.png')

  const expand = async () => {
    await page.evaluate(() => {
      document.querySelector('.tree-row.tree-hidden')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await new Promise((r) => setTimeout(r, 400))
  }
  await expand()
  await shot(page, 'hidden-expanded-light.png')

  await page.click('.theme-toggle')
  await page.waitForFunction(
    () => document.documentElement.getAttribute('data-theme') === 'dark',
    { timeout: 5000 },
  )
  await shot(page, 'hidden-expanded-dark.png')
  await expand() // 收回折叠态
  await shot(page, 'hidden-collapsed-dark.png')
} finally {
  await browser.close()
}

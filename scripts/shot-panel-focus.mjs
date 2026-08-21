// 面板焦点态的双主题视觉自检(add-keyboard-first-navigation 4.3)。
//
// **必须让三种标识同屏**:面板焦点(面板顶边实线)+ 行焦点(行内细边框)+ 选中态(行背景填充)。
// 分别截三张各自都合格,合起来才知道它们会不会在同一块区域里互相打架 ——
// 而用户看到的永远是合起来的那一张。
import puppeteer from 'puppeteer-core'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PROJECT, SCRIPTS, resolveChrome } from './paths.mjs'

execSync('npx vite build --mode development --outDir dist-dev', { cwd: PROJECT, stdio: 'inherit' })
const browser = await puppeteer.launch({
  executablePath: resolveChrome(),
  headless: false,
  pipe: true,
  enableExtensions: true,
  args: [`--user-data-dir=${mkdtempSync(join(tmpdir(), 'cv-panel-'))}`, '--no-first-run'],
  defaultViewport: { width: 1200, height: 360, deviceScaleFactor: 3 },
})
try {
  const extId = await browser.installExtension(join(PROJECT, 'dist-dev'))
  const page = await browser.newPage()
  await page.goto(`chrome-extension://${extId}/viewer.html`, { waitUntil: 'load' })
  await page.waitForSelector('.welcome', { timeout: 10000 })
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    for await (const n of root.keys()) await root.removeEntry(n, { recursive: true })
    const w = async (d, n, c) => {
      const f = await d.getFileHandle(n, { create: true })
      const s = await f.createWritable(); await s.write(c); await s.close()
    }
    const src = await root.getDirectoryHandle('src', { create: true })
    await w(src, 'main.go', 'package main\n\nfunc Serve(addr string) error {\n\treturn nil\n}\n')
    await w(src, 'client.go', 'package main\n\nfunc Run() error {\n\treturn Serve("x")\n}\n')
    await w(src, 'store.go', 'package main\n\nfunc New(c string) *T {\n\treturn nil\n}\n')
  })
  await page.evaluate(async () => { window.__cv.enterProject(await navigator.storage.getDirectory()) })
  await page.waitForSelector('.tree-row', { timeout: 10000 })
  await new Promise((r) => setTimeout(r, 1200))

  const clickRow = async (label) => {
    for (const h of await page.$$('.tree-row')) {
      const l = await h.$eval('.label', (e) => e.textContent).catch(() => null)
      if (l === label) { await h.click(); return true }
    }
    return false
  }
  await clickRow('src')
  await new Promise((r) => setTimeout(r, 500))
  // 选中态:真实点击选中一个文件
  await clickRow('client.go')
  await new Promise((r) => setTimeout(r, 600))

  const shoot = async (name) => {
    // 让目录树持有焦点(面板焦点态),再把行焦点移到**另一行**(与选中行分开)
    await page.$eval('.tree', (el) => el.focus())
    await new Promise((r) => setTimeout(r, 200))
    await page.keyboard.press('ArrowDown')
    await new Promise((r) => setTimeout(r, 350))
    const state = await page.evaluate(() => {
      const tree = document.querySelector('.tree')
      const id = tree?.getAttribute('aria-activedescendant')
      const active = id ? document.getElementById(id) : null
      const selected = document.querySelector('.tree-row.selected')
      return {
        panelFocusShadow: getComputedStyle(document.querySelector('.sidebar')).boxShadow,
        activeRow: active?.querySelector('.label')?.textContent ?? null,
        selectedRow: selected?.querySelector('.label')?.textContent ?? null,
        threeDistinct: !!active && !!selected && active !== selected,
      }
    })
    console.log(`${name} 三标识同屏自检:`, JSON.stringify(state))
    await (await page.$('.sidebar')).screenshot({ path: join(SCRIPTS, name) })
    console.log('截图:', name)
  }

  await shoot('panel-focus-light.png')
  await page.click('.theme-toggle')
  await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark', { timeout: 5000 })
  await shoot('panel-focus-dark.png')
} finally {
  await browser.close()
}

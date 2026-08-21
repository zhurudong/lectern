// 「按住可跳转」提示的双主题视觉自检(change: add-jump-affordance,任务 2.4)。
//
// **必须截"提示 + 落点行高亮同时出现在同一行"的样子,不能分别截。**
// 分别看是两张合格的图;而用户真正会遇到的是那一行上同时有三个蓝色元素:
//   整行底色(--hot-bg) + 左侧实心条(--hot-bar) + 标识符下划线(--hot-bar)。
// 分开截各自都好看,叠在一起才知道能不能分辨 —— 这正是这条自检存在的理由。
import puppeteer from 'puppeteer-core'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PROJECT, SCRIPTS, resolveChrome } from './paths.mjs'

const SHOTS = SCRIPTS
const DIST = join(PROJECT, 'dist-dev')
const CHROME = resolveChrome()

console.log('building dev bundle…')
execSync('npx vite build --mode development --outDir dist-dev', { cwd: PROJECT, stdio: 'inherit' })

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  pipe: true,
  enableExtensions: true,
  args: [`--user-data-dir=${mkdtempSync(join(tmpdir(), 'cv-hint-'))}`, '--no-first-run', '--no-default-browser-check'],
  defaultViewport: { width: 1100, height: 320, deviceScaleFactor: 3 },
})

try {
  const extId = await browser.installExtension(DIST)
  const page = await browser.newPage()
  await page.goto(`chrome-extension://${extId}/viewer.html`, { waitUntil: 'load' })
  await page.waitForSelector('.welcome', { timeout: 10000 })

  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    for await (const n of root.keys()) await root.removeEntry(n, { recursive: true })
    const write = async (dir, name, content) => {
      const fh = await dir.getFileHandle(name, { create: true })
      const w = await fh.createWritable(); await w.write(content); await w.close()
    }
    const src = await root.getDirectoryHandle('src', { create: true })
    await write(src, 'main.go', [
      'package main',
      '',
      'func Serve(addr string, timeout int) error {',
      '\treturn nil',
      '}',
    ].join('\n'))
    await write(src, 'client.go', [
      'package main',
      '',
      'func Run() error {',
      '\treturn Serve("addr", 1)',
      '}',
    ].join('\n'))
  })
  await page.evaluate(async () => { window.__cv.enterProject(await navigator.storage.getDirectory()) })
  await page.waitForSelector('.tree-row', { timeout: 10000 })
  await new Promise((r) => setTimeout(r, 1500)) // 等索引就绪

  const spotOf = (word, nth = 1) =>
    page.evaluate((w, n) => {
      const root = document.querySelector('.cm-content')
      if (!root) return null
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      const re = new RegExp(`(^|[^A-Za-z0-9_$])(${w})([^A-Za-z0-9_$]|$)`)
      let node, seen = 0
      while ((node = walker.nextNode())) {
        const text = node.textContent ?? ''
        let from = 0
        for (;;) {
          const m = re.exec(text.slice(from)); if (!m) break
          const idx = from + m.index + m[1].length
          if (++seen === n) {
            const range = document.createRange()
            range.setStart(node, idx); range.setEnd(node, idx + w.length)
            const r = range.getBoundingClientRect()
            if (r.width > 0) return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
          }
          from = idx + w.length
        }
      }
      return null
    }, word, nth)

  const openClient = async () => {
    for (const h of await page.$$('.tree-row')) {
      const l = await h.$eval('.label', (e) => e.textContent).catch(() => null)
      if (l === 'src') { await h.click(); break }
    }
    await new Promise((r) => setTimeout(r, 500))
    for (const h of await page.$$('.tree-row')) {
      const l = await h.$eval('.label', (e) => e.textContent).catch(() => null)
      if (l === 'client.go') { await h.click(); break }
    }
    await page.waitForFunction(() => document.querySelector('.cm-content')?.textContent?.includes('Serve('), { timeout: 8000 })
  }

  // 三蓝同行:⌘ 点击 Serve → 跳到 main.go 定义行(落点行高亮亮起)
  //           → 高亮未消失前按住 ⌘ 悬停该行上的 Serve → 下划线叠上去
  const shootOverlap = async (name) => {
    await openClient()
    const call = await spotOf('Serve')
    await page.keyboard.down('Meta')
    await page.mouse.click(call.x, call.y)
    await page.keyboard.up('Meta')
    await page.waitForFunction(
      () => document.querySelector('.preview-header .file-path')?.textContent === 'src/main.go',
      { timeout: 8000 },
    )
    await page.waitForFunction(
      () => document.querySelector('.cm-content')?.textContent?.includes('func Serve'),
      { timeout: 8000 },
    )
    const def = await spotOf('Serve')
    await page.keyboard.down('Meta')
    await page.mouse.move(def.x + 200, def.y)
    await page.mouse.move(def.x, def.y)
    await new Promise((r) => setTimeout(r, 120))
    const state = await page.evaluate(() => ({
      hint: !!document.querySelector('.cm-jump-hint'),
      targetLine: !!document.querySelector('.cm-target-line'),
      sameLine: (() => {
        const t = document.querySelector('.cm-target-line')
        const h = document.querySelector('.cm-jump-hint')
        return !!(t && h && t.contains(h))
      })(),
    }))
    console.log(`${name} 三蓝同行自检:`, JSON.stringify(state))
    await (await page.$('.preview')).screenshot({ path: join(SHOTS, name) })
    console.log('截图:', name)
    await page.keyboard.up('Meta')
  }

  await shootOverlap('jump-hint-overlap-light.png')
  await page.click('.theme-toggle')
  await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark', { timeout: 5000 })
  await shootOverlap('jump-hint-overlap-dark.png')
} finally {
  await browser.close()
}

// 图标自检截图(任务 3.7):在浅色与暗色两个主题下各截一张目录树,供人眼复核。
// E2E 的"颜色 ≠ 背景色"只能挡住"接近隐形",挡不住"能看见但很丑"——这一步只能人看。
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
  args: [`--user-data-dir=${mkdtempSync(join(tmpdir(), 'cv-icons-'))}`, '--no-first-run', '--no-default-browser-check'],
  // 3x 采样:图标细节在 1x 缩略图里根本看不清,而"糊成一团"正是这类改动的典型翻车方式
  defaultViewport: { width: 1200, height: 900, deviceScaleFactor: 3 },
})

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
      const w = await fh.createWritable()
      await w.write(content)
      await w.close()
    }
    const src = await root.getDirectoryHandle('src', { create: true })
    const docs = await root.getDirectoryHandle('docs', { create: true })
    await root.getDirectoryHandle('build', { create: true })
    // 每种色类各来一个,外加同族多个以便看"分组是否成立"
    for (const [n, c] of [
      ['main.go', [
        '// Handler 负责把请求分派到对应的处理函数。',
        '// 注意:这里不做鉴权,鉴权在上游中间件完成。',
        'package main',
        '',
        'import "fmt"',
        '',
        '// Serve 启动监听并阻塞当前 goroutine。',
        '// addr 形如 ":8080";timeout 单位为秒。',
        'func Serve(addr string, timeout int) error {',
        '\tfmt.Println(addr, timeout) // 打印启动参数',
        '\treturn nil',
        '}',
      ].join('\n')],
      ['server.go', 'package main'],
      ['app.ts', 'export const a = 1'],
      ['view.tsx', 'export const b = 2'],
      ['util.js', 'export const c = 3'],
      ['train.py', 'x = 1'],
      ['Service.java', 'class S {}'],
      ['engine.c', 'int a;'],
      ['engine.cpp', 'int b;'],
      ['config.yaml', 'a: 1'],
      ['data.json', '{"a":1}'],
      ['query.sql', 'select 1'],
      ['index.html', '<p>x</p>'],
      ['style.css', 'a{}'],
      ['feed.xml', '<a/>'],
      ['run.sh', 'echo hi'],
      ['notes.txt', 'plain'],
      ['Makefile', 'all:'],
      ['main.rs', 'fn main() {}'],
      ['app.rb', 'class A; end'],
      ['Main.kt', 'fun main() {}'],
      ['Prog.cs', 'class P {}'],
      ['build.gradle', "plugins { id 'java' }"],
      ['Cargo.toml', '[package]'],
      ['Dockerfile', 'FROM node:20'],
      ['CMakeLists.txt', 'project(demo)'],
      ['App.vue', '<template></template>'],
      ['App.svelte', '<div></div>'],
    ]) await write(src, n, c)
    await write(docs, 'README.md', '# hi')
    await write(docs, 'guide.md', '# hi')
    await write(docs, 'logo.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>')
    await write(docs, 'shot.png', 'x')
    await write(root, 'app.zip', 'x')
    await write(root, 'lib.so', 'x')
  })

  await page.evaluate(async () => {
    window.__cv.enterProject(await navigator.storage.getDirectory())
  })
  await page.waitForSelector('.tree-row', { timeout: 10000 })
  // 展开 src 与 docs,让各类图标同屏
  const clickRow = async (label) => {
    for (const h of await page.$$('.tree-row')) {
      const l = await h.$eval('.label', (e) => e.textContent).catch(() => null)
      if (l === label) { await h.click(); return true }
    }
    return false
  }
  await clickRow('docs')
  await clickRow('src')
  await new Promise((r) => setTimeout(r, 600))

  // 焦点环自检要同时看到两种标识:先用**真实点击**选中一个文件(合成 click 不会走完整路径),
  // 再让目录树取得焦点、把活动行移到相邻行 —— 这样同一张图里既有选中背景又有焦点环。
  const clicked = await clickRow('main.go')
  await new Promise((r) => setTimeout(r, 400))
  console.log('点击 main.go:', clicked, '| 预览:', await page.$eval('.preview-header .file-path', (el) => el.textContent).catch(() => '(无)'))
  await page.$eval('.tree', (el) => el.focus())
  await new Promise((r) => setTimeout(r, 150))
  await page.keyboard.press('ArrowUp')
  await new Promise((r) => setTimeout(r, 250))

  console.log('焦点自检:', JSON.stringify(await page.evaluate(() => {
    const tree = document.querySelector('.tree')
    const id = tree?.getAttribute('aria-activedescendant')
    const el = id ? document.getElementById(id) : null
    return {
      treeHasFocus: document.activeElement === tree,
      activeEl: document.activeElement?.className ?? null,
      activeDescendant: id,
      ringApplied: el ? getComputedStyle(el, '::after').borderTopWidth + ' ' + getComputedStyle(el, '::after').borderTopColor : null,
    }
  })))

  // 代码区截图:注释色调整必须用眼睛复核 —— 数字达标但观感变抢眼同样算失败
  await clickRow('main.go')
  await page.waitForFunction(() => document.querySelector('.cm-content')?.textContent?.includes('package'), { timeout: 8000 })
  await new Promise((r) => setTimeout(r, 300))
  await (await page.$('.preview')).screenshot({ path: join(SHOTS, 'code-light.png') })
  console.log('浅色代码区截图完成')

  const sidebar = await page.$('.sidebar')
  await sidebar.screenshot({ path: join(SHOTS, 'icons-light.png') })
  console.log('浅色截图完成')

  // 三元素同行:把活动行移回选中行,让"焦点环 + 左色条 + 选中底"叠在同一行
  await page.keyboard.press('ArrowDown')
  await new Promise((r) => setTimeout(r, 250))
  await (await page.$('.sidebar')).screenshot({ path: join(SHOTS, 'overlap-light.png') })
  console.log('浅色三元素同行截图完成')
  await page.keyboard.press('ArrowUp')
  await new Promise((r) => setTimeout(r, 200))

  await page.click('.theme-toggle')
  await page.waitForFunction(
    () => {
      const cs = getComputedStyle(document.documentElement)
      const token = cs.getPropertyValue('--bg').trim()
      return token !== '' && document.documentElement.getAttribute('data-theme') === 'dark' &&
        getComputedStyle(document.body).backgroundColor !== ''
    },
    { timeout: 5000 },
  )
  // 点主题按钮会把焦点带走,焦点环随之消失(这是对的:环只在目录树持有焦点时显示)。
  // 暗色这张图要看的正是焦点环,所以得先把焦点还给目录树。
  await page.$eval('.tree', (el) => el.focus())
  await new Promise((r) => setTimeout(r, 400))
  console.log('暗色焦点自检:', JSON.stringify(await page.evaluate(() => {
    const tree = document.querySelector('.tree')
    const id = tree?.getAttribute('aria-activedescendant')
    const el = id ? document.getElementById(id) : null
    return { treeHasFocus: document.activeElement === tree, activeDescendant: id, ring: el ? getComputedStyle(el, '::after').borderTopWidth + ' ' + getComputedStyle(el, '::after').borderTopColor : null }
  })))
  await (await page.$('.sidebar')).screenshot({ path: join(SHOTS, 'icons-dark.png') })
  console.log('暗色截图完成')
  await (await page.$('.preview')).screenshot({ path: join(SHOTS, 'code-dark.png') })
  console.log('暗色代码区截图完成')
  await page.keyboard.press('ArrowDown')
  await new Promise((r) => setTimeout(r, 250))
  await (await page.$('.sidebar')).screenshot({ path: join(SHOTS, 'overlap-dark.png') })
  console.log('暗色三元素同行截图完成')
} finally {
  await browser.close()
}

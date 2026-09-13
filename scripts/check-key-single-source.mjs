// 键位单一来源的**变异测试**(add-keyboard-first-navigation 3b.5)。
//
// 只断言"菜单里有键位文本"验不出副本问题 —— 两处各自写死时它照样绿。
// 唯一能验出来的办法是**改一处来源,看两处是不是都跟着变**:
//   1. 用当前 keys.ts 构建,读右键菜单与帮助面板里的键位文本;
//   2. 把 keys.ts 里的键串改掉,重新构建,再读一次;
//   3. 两处都必须变成新值。任何一处没变,就说明它是另写的一份副本。
//   4. 无论成败都把 keys.ts 还原。
import puppeteer from 'puppeteer-core'
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PROJECT, resolveChrome } from './paths.mjs'

const KEYS_FILE = join(PROJECT, 'src/lib/keys.ts')
const ORIGINAL = readFileSync(KEYS_FILE, 'utf8')

// **起手先确认源文件是干净的。**
// 这个脚本会临时改写被追踪的源文件,靠 `finally` 还原 —— 但进程若被强杀
// (SIGKILL / 关终端),`finally` 不会执行,`keys.ts` 就留在变异态。
// 那种状态最危险的地方是它**看起来一切正常**:能构建、能跑、断言全绿,
// 只是跳转键位悄悄变成了没人核验过的 `⌘⌥↩`,然后被一起提交。
// 所以这里主动检出上一轮的残留,并且**拒绝在脏状态上继续**(继续会把变异当成原状还原回去)。
if (ORIGINAL.includes('Mod-Alt-Enter')) {
  console.error(
    'src/lib/keys.ts 里发现变异残留(Mod-Alt-Enter)—— 说明上一次运行没有正常还原。\n' +
      '请先把该文件恢复成原状(git checkout src/lib/keys.ts)再重跑本检查。',
  )
  process.exit(1)
}
const results = []
const check = (name, ok, extra = '') => {
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`)
}

async function readKeyTexts() {
  execSync('npx vite build --mode development --outDir dist-dev', { cwd: PROJECT, stdio: 'ignore' })
  const browser = await puppeteer.launch({
    executablePath: resolveChrome(),
    headless: false,
    pipe: true,
    enableExtensions: true,
    args: [`--user-data-dir=${mkdtempSync(join(tmpdir(), 'cv-keysrc-'))}`, '--no-first-run'],
    defaultViewport: { width: 1200, height: 800 },
  })
  try {
    const extId = await browser.installExtension(join(PROJECT, 'dist-dev'))
    const page = await browser.newPage()
    // 语言锁:本检查按中文标注（'跳转到定义'）在帮助面板/右键菜单里定位行。0.3.4 起
    // DETECT_BROWSER_LANG=true 会让非 zh 浏览器默认英文，故先把 cv-lang 写死 zh（initialLang
    // 先读 localStorage，无视浏览器语言探测）。
    await page.evaluateOnNewDocument(() => {
      try { localStorage.setItem('cv-lang', 'zh') } catch { /* ignore */ }
    })
    await page.goto(`chrome-extension://${extId}/viewer.html`, { waitUntil: 'load' })
    await page.waitForSelector('.welcome', { timeout: 10000 })
    await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory()
      for await (const n of root.keys()) await root.removeEntry(n, { recursive: true })
      const src = await root.getDirectoryHandle('src', { create: true })
      const f = await src.getFileHandle('main.go', { create: true })
      const w = await f.createWritable()
      await w.write('package main\n\nfunc Serve(a string) error {\n\treturn nil\n}\n')
      await w.close()
    })
    await page.evaluate(async () => { window.__cv.enterProject(await navigator.storage.getDirectory()) })
    await page.waitForSelector('.tree-row', { timeout: 10000 })
    await new Promise((r) => setTimeout(r, 1200))
    for (const label of ['src', 'main.go']) {
      for (const h of await page.$$('.tree-row')) {
        const l = await h.$eval('.label', (e) => e.textContent).catch(() => null)
        if (l === label) { await h.click(); break }
      }
      await new Promise((r) => setTimeout(r, 600))
    }
    await page.waitForFunction(
      () => document.querySelector('.cm-content')?.textContent?.includes('Serve'),
      { timeout: 8000 },
    )
    // 右键菜单(用合成 contextmenu:真实右键会弹系统菜单卡住页面)
    const menuKey = await page.evaluate(() => {
      const root = document.querySelector('.cm-content')
      const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      let n
      while ((n = tw.nextNode())) {
        const i = (n.textContent ?? '').indexOf('Serve')
        if (i >= 0) {
          const r = document.createRange()
          r.setStart(n, i); r.setEnd(n, i + 5)
          const b = r.getBoundingClientRect()
          document.querySelector('.code-view').dispatchEvent(new MouseEvent('contextmenu', {
            clientX: b.x + b.width / 2, clientY: b.y + b.height / 2, bubbles: true, cancelable: true,
          }))
          break
        }
      }
      return new Promise((res) => setTimeout(() => {
        res(document.querySelector('.intel-menu-key')?.textContent ?? null)
      }, 400))
    })
    // 帮助面板
    const helpKey = await page.evaluate(() => {
      document.querySelector('.help-toggle')?.click()
      return new Promise((res) => setTimeout(() => {
        const rows = [...document.querySelectorAll('.help-row')]
        const row = rows.find((r) => r.querySelector('.help-row-label')?.textContent === '跳转到定义')
        res(row?.querySelector('.help-row-key')?.textContent ?? null)
      }, 400))
    })
    return { menuKey, helpKey }
  } finally {
    await browser.close()
  }
}

try {
  console.log('① 用当前 keys.ts 构建并读取…')
  const before = await readKeyTexts()
  console.log('   菜单:', before.menuKey, ' 帮助:', before.helpKey)
  check('右键菜单里出现了键位文本', !!before.menuKey, String(before.menuKey))
  check('帮助面板里出现了键位文本', !!before.helpKey, String(before.helpKey))

  console.log('② 改动 keys.ts 的键串后重新构建…')
  const mutated = ORIGINAL.replace(
    "label: '跳转到定义', key: 'Mod-Enter'",
    "label: '跳转到定义', key: 'Mod-Alt-Enter'",
  )
  if (mutated === ORIGINAL) throw new Error('变异未命中:keys.ts 里没找到预期的键串写法')
  writeFileSync(KEYS_FILE, mutated)
  const after = await readKeyTexts()
  console.log('   菜单:', after.menuKey, ' 帮助:', after.helpKey)

  check(
    '改键位映射后,右键菜单的标注**跟着变**(证明它不是另写的一份)',
    !!after.menuKey && after.menuKey !== before.menuKey,
    `${before.menuKey} → ${after.menuKey}`,
  )
  check(
    '改键位映射后,帮助面板的标注**跟着变**',
    !!after.helpKey && after.helpKey !== before.helpKey,
    `${before.helpKey} → ${after.helpKey}`,
  )
  check(
    '两处标注始终一致(同一来源)',
    before.menuKey === before.helpKey && after.menuKey === after.helpKey,
    `变异前 ${before.menuKey}/${before.helpKey};变异后 ${after.menuKey}/${after.helpKey}`,
  )
} finally {
  writeFileSync(KEYS_FILE, ORIGINAL)
  execSync('npx vite build --mode development --outDir dist-dev', { cwd: PROJECT, stdio: 'ignore' })
  console.log('keys.ts 已还原并重新构建')
}

const failed = results.filter((r) => !r).length
console.log(`\n===== ${results.length - failed}/${results.length} PASS =====`)
process.exit(failed > 0 ? 1 : 0)

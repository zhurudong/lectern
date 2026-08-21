// README / 商店截图。产出到 docs/images/。
//
// **取样口径(不要改成合成项目)**:截图必须展示真实仓库打开后的样子 —— 真实文件名、
// 真实代码、真实的 `node_modules` / `.git`(它们正是"已隐藏 N 项"存在的理由)。
// 合成项目不长这两样,拿它拍出来的图**证明不了任何事**,而且与用户打开后看到的不一致。
//
// 为什么仍然经由 OPFS:原生目录选择器无法自动化(它是浏览器 UI,CDP 合成事件进不去)。
// 所以本脚本把**本仓库自己的真实文件**灌进 OPFS 再打开 —— "合成"的只剩"字节是怎么
// 进去的",那一点观者看不见,也不构成任何虚假陈述。**不接受的是另外两种做法:造一个
// 好看的假项目,或挑一个不会触发缺陷的样本 —— 那是修图的变体。**
import puppeteer from 'puppeteer-core'
import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, statSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, extname } from 'node:path'
import { PROJECT, resolveChrome } from './paths.mjs'

const DIST = join(PROJECT, 'dist-dev')
const OUT = join(PROJECT, 'docs', 'images')
const CHROME = resolveChrome()

// 真实文件:体积上限只是为了让 CDP 传输可控,不改变"内容是真的"这一点
const MAX_BYTES = 96 * 1024
const TEXT_EXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.json', '.md', '.html', '.css', '.svg', '.yml', '.yaml', ''])
const INCLUDE = ['src', 'docs', 'openspec', 'scripts', 'public', 'assets', '.github']
const ROOT_FILES = [
  'README.md', 'README.zh-CN.md', 'CONTRIBUTING.md', 'SECURITY.md', 'PRIVACY.md',
  'LICENSE', 'NOTICE', 'package.json', 'tsconfig.json', 'vite.config.ts', 'viewer.html',
]

/** 收集真实文件 → [{path, text}],路径相对仓库根 */
function collect() {
  const files = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name)
      const st = statSync(abs)
      if (st.isDirectory()) { walk(abs); continue }
      if (st.size > MAX_BYTES) continue
      if (!TEXT_EXT.has(extname(name))) continue
      files.push({ path: relative(PROJECT, abs), text: readFileSync(abs, 'utf8') })
    }
  }
  for (const d of INCLUDE) if (existsSync(join(PROJECT, d))) walk(join(PROJECT, d))
  for (const f of ROOT_FILES) {
    const abs = join(PROJECT, f)
    if (existsSync(abs) && statSync(abs).size <= MAX_BYTES) {
      files.push({ path: f, text: readFileSync(abs, 'utf8') })
    }
  }
  // 被默认排除的重目录。**「已隐藏 N 项」的 N 数的是"该层被排除的条目数",不是文件数**
  // (开发核过),所以这里放的是真实存在的那几个目录名即可 —— 把 node_modules 的几千个
  // 文件灌进来只会让脚本跑几分钟,**图上一个字都不会变**。
  const real = readdirSync(join(PROJECT, 'node_modules')).filter((n) => !n.startsWith('.')).slice(0, 3)
  for (const name of real) files.push({ path: `node_modules/${name}/package.json`, text: `{ "name": "${name}" }` })
  files.push({ path: '.git/HEAD', text: 'ref: refs/heads/main\n' })
  files.push({ path: 'dist/manifest.json', text: '{}' })
  return files
}

console.log('building dev bundle…')
execSync('npx vite build --mode development --outDir dist-dev', { cwd: PROJECT, stdio: 'inherit' })
mkdirSync(OUT, { recursive: true })

const payload = collect()
console.log(`真实文件 ${payload.length} 个`)

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  pipe: true,
  enableExtensions: true,
  args: [`--user-data-dir=${mkdtempSync(join(tmpdir(), 'lectern-shot-'))}`, '--no-first-run', '--no-default-browser-check'],
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 2 },
})

const settle = (ms = 500) => new Promise((r) => setTimeout(r, ms))
const shot = async (page, name) => {
  await settle()
  await page.screenshot({ path: join(OUT, name) })
  console.log('截图:', join('docs/images', name))
}

try {
  const extId = await browser.installExtension(DIST)
  const page = await browser.newPage()
  await page.goto(`chrome-extension://${extId}/viewer.html`, { waitUntil: 'load' })
  await page.waitForSelector('.welcome', { timeout: 10000 })

  await page.evaluate(async (files) => {
    const root = await navigator.storage.getDirectory()
    for await (const n of root.keys()) await root.removeEntry(n, { recursive: true })
    for (const { path, text } of files) {
      const parts = path.split('/')
      let dir = root
      for (const seg of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(seg, { create: true })
      const fh = await dir.getFileHandle(parts[parts.length - 1], { create: true })
      const w = await fh.createWritable()
      await w.write(text)
      await w.close()
    }
  }, payload)

  await page.evaluate(async () => {
    window.__cv.enterProject(await navigator.storage.getDirectory())
  })
  await page.waitForSelector('.tree-row', { timeout: 20000 })
  await settle(1200)

  // 首屏:展开 src 再打开一个真实源码文件;树里同时能看到「已隐藏 N 项」那一行
  // 行的 textContent 以三角符号开头(`▸`),所以按 `.label` 的精确文本匹配,
  // 不按整行前缀 —— 前缀匹配在这里静默失效过一次:点击没发生、脚本照常出图。
  const clickRow = async (name) => {
    const ok = await page.evaluate((n) => {
      const label = [...document.querySelectorAll('.tree-row .label')].find((el) => el.textContent.trim() === n)
      if (!label) return false
      label.closest('.tree-row').dispatchEvent(new MouseEvent('click', { bubbles: true }))
      return true
    }, name)
    await settle(700)
    if (!ok) throw new Error(`目录树里找不到「${name}」—— 出图前中止,免得产出一张没打开文件的首屏图`)
    return ok
  }
  await clickRow('src')
  await clickRow('intel')
  await clickRow('extract.ts')
  await page.waitForSelector('.cm-content', { timeout: 10000 })
  await settle(900)

  await shot(page, 'hero-light.png')

  await page.click('.theme-toggle')
  await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark', { timeout: 5000 })
  await shot(page, 'hero-dark.png')

  // 第三张:收起展开的目录,让「已隐藏 N 项」回到视口 —— 那一行是"默认排除但不静默"
  // 这条产品承诺唯一看得见的证据,**把它裁出画面等于把最想展示的克制裁掉**。
  await page.click('.theme-toggle')
  await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') !== 'dark', { timeout: 5000 })
  await clickRow('intel')
  await clickRow('src')
  const hiddenLabel = await page
    .$eval('.tree-row.tree-hidden .label', (el) => el.textContent.trim())
    .catch(() => null)
  if (!hiddenLabel) throw new Error('「已隐藏 N 项」不在视口内 —— 中止,不出一张缺了它的树图')
  console.log('隐藏提示行:', hiddenLabel)
  await shot(page, 'tree-hidden-light.png')

  // ---- 纯键盘链路：我不为一个没亲眼见过的行为写使用说明，所以这里真按一遍 ----
  // 断言的是**按下去发生了什么**（面包屑变了 / 面板出现了 / 退回原处），
  // 不是"某个 class 存在" —— README 承诺的是前者。
  await clickRow('src'); await clickRow('intel'); await clickRow('extract.ts')
  await page.waitForSelector('.cm-content', { timeout: 10000 })
  await settle(700)

  const crumb = () => page.$eval('.file-path', (el) => el.textContent.trim()).catch(() => null)
  const clickToken = async (text) => {
    const box = await page.evaluate((t) => {
      const el = [...document.querySelectorAll('.cm-content span')].find((s) => s.textContent === t)
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    }, text)
    if (!box) throw new Error(`代码区找不到标识符「${text}」`)
    await page.mouse.click(box.x, box.y)
    await settle(250)
  }
  const chord = async (key, mods) => {
    for (const m of mods) await page.keyboard.down(m)
    await page.keyboard.press(key)
    for (const m of [...mods].reverse()) await page.keyboard.up(m)
    await settle(800)
  }

  const before = await crumb()

  // 先验查找引用（光标停在当前文件的标识符上），再验跳转 ——
  // 跳转会换文件、换焦点，把它放前面会让下一步的失败原因变得不可判定。
  await clickToken('KIND')
  await chord('Enter', ['Meta', 'Shift'])              // 查找引用
  await settle(1500)
  const refs = await page.$('.ref-panel')
  const refText = refs ? await page.$eval('.ref-panel', (el) => el.textContent.trim().slice(0, 60)) : null
  console.log(`⌘⇧↩ 查找引用:${refs ? '面板出现 ✓ — ' + refText : '未出现 ✗'}`)
  await page.keyboard.press('Escape'); await settle(400)

  await clickToken('KIND')
  await chord('Enter', ['Meta'])                       // 跳转到定义
  const afterJump = await crumb()
  console.log(`⌘↩ 跳转:${before} → ${afterJump}${afterJump && afterJump !== before ? '  ✓' : '  ✗ 未跳转'}`)

  await chord('ArrowLeft', ['Alt'])                    // 后退
  const afterBack = await crumb()
  console.log(`⌥← 后退:${afterJump} → ${afterBack}${afterBack === before ? '  ✓ 回到原处' : '  ✗'}`)

  // 帮助面板的**基线入口是界面上的按钮**（spec 要求它不依赖任何自定义键位）——
  // 没有 `?` 这个键，写 README 前按一遍才知道。
  await page.click('.help-toggle')
  await settle(600)
  const help = await page.$('.help-panel')
  console.log(`帮助面板(点按钮):${help ? '出现 ✓' : '未出现 ✗'}`)
  if (help) await shot(page, 'keyboard-help.png')

  // 面板自己列出了退出键,所以退出键必须真的有效 —— 界面说什么,按下去就得是什么
  await page.keyboard.press('Escape')
  await settle(500)
  const stillOpen = await page.$('.help-panel')
  console.log(`Esc 关闭帮助面板:${stillOpen ? '仍在 ✗' : '已关闭 ✓'}`)

  // ---- 全程不碰鼠标的一遍 ----
  // 上一轮我用鼠标点了结果行,正好绕开了"结果行是 div、键盘够不着"这个缺陷 ——
  // **验证路径和键盘用户的路径不是同一条**。所以这一段之后不再有任何 page.mouse。
  const active = () =>
    page.evaluate(() => {
      const el = document.activeElement
      if (!el) return 'null'
      const panel = el.closest('.ref-panel, .cand-panel, .candidates, .content-results, .cm-editor, .tree')
      return `${el.tagName.toLowerCase()}.${el.className || '-'}${panel ? ` (in ${panel.className.split(' ')[0]})` : ''}`
    })
  const type = async (text) => { for (const ch of text) { await page.keyboard.press(ch); await settle(60) } }

  await chord('KeyO', ['Meta', 'Shift'])               // 符号搜索
  await type('KIND')
  await settle(700)
  await page.keyboard.press('Enter')
  await settle(1200)
  console.log(`⌘⇧O 符号搜索 → Enter:落在 ${await crumb()} | 焦点 ${await active()}`)

  // 顺序有讲究（实现阶段提的，采纳）：**先做静默的那个**。
  // 焦点没交接成功时，`↓` 是静默无反应，最容易被读成"这个键没绑"；
  // 而 `⌘⇧↩` 出不出面板是个响亮的信号 —— 先做响亮的那个，一旦它成功，
  // 我可能就不再验 `↓` 了。**顺序决定我有没有机会撞见问题。**
  const cursorLine = () =>
    page.$eval('.cm-activeLineGutter', (el) => el.textContent.trim()).catch(() => null)
  const lineBefore = await cursorLine()
  await page.keyboard.press('ArrowDown')
  await settle(400)
  const lineAfter = await cursorLine()
  console.log(`  ↓ 移动代码光标:${lineBefore} → ${lineAfter}${lineAfter && lineAfter !== lineBefore ? '  ✓' : '  ✗ 无反应'}`)

  await chord('Enter', ['Meta', 'Shift'])              // 查找引用（键盘触发）
  await settle(1500)
  console.log(`  引用面板打开后焦点在:${await active()}`)
  await page.keyboard.press('ArrowDown'); await settle(200)
  await page.keyboard.press('ArrowDown'); await settle(200)
  const beforeRef = await crumb()
  await page.keyboard.press('Enter'); await settle(900)
  const afterRef = await crumb()
  console.log(`  ↑↓ + Enter 打开引用:${beforeRef} → ${afterRef}${afterRef !== beforeRef ? '  ✓' : '  ✗ 未跳转'}`)

  await chord('KeyF', ['Meta', 'Shift'])               // 全文搜索
  await type('createWritable')
  await settle(2500)
  console.log(`  全文搜索结果焦点:${await active()}`)
  await page.keyboard.press('ArrowDown'); await settle(250)
  const beforeFt = await crumb()
  await page.keyboard.press('Enter'); await settle(900)
  const afterFt = await crumb()
  console.log(`  ⌘⇧F + ↓ + Enter:${beforeFt} → ${afterFt}${afterFt !== beforeFt ? '  ✓' : '  ✗ 未跳转'}`)
} finally {
  await browser.close()
}

// README / 商店截图的 README 那一半。产出到 docs/images/。
//
// **取样口径不在这个文件里**，在 `shot-fixture.mjs` —— 它和 `shot-store.mjs` 共用
// 同一份。口径曾经在这里各写一份，结果是：这里写着"不要改成合成项目"，商店那批
// 却真的用了一个合成的 2 文件玩具项目，**两份都没红**。一条规则只要有两个副本，
// 它就会漂移，而漂移时两边看上去都在正常工作。
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { PROJECT } from './paths.mjs'
import {
  collectRealFiles, launchViewer, openRealProject, makeClickRow, settle,
} from './shot-fixture.mjs'
import { execSync } from 'node:child_process'

const OUT = join(PROJECT, 'docs', 'images')

console.log('building dev bundle…')
execSync('npx vite build --mode development --outDir dist-dev', { cwd: PROJECT, stdio: 'inherit' })
mkdirSync(OUT, { recursive: true })

const payload = collectRealFiles()
console.log(`真实文件 ${payload.length} 个`)

const { browser, page } = await launchViewer({ width: 1440, height: 900, deviceScaleFactor: 2 })
const clickRow = makeClickRow(page)

const shot = async (name) => {
  await settle()
  await page.screenshot({ path: join(OUT, name) })
  console.log('截图:', join('docs/images', name))
}

try {
  await openRealProject(page, payload)

  await clickRow('src')
  await clickRow('intel')
  await clickRow('extract.ts')
  await page.waitForSelector('.cm-content', { timeout: 10000 })
  await settle(900)

  await shot('hero-light.png')

  await page.click('.theme-toggle')
  await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark', { timeout: 5000 })
  await shot('hero-dark.png')

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
  await shot('tree-hidden-light.png')

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
  if (help) await shot('keyboard-help.png')

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

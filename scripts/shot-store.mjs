// Chrome 应用商店的 5 张截图 + README 的 jump-affordance。
//
//     node scripts/shot-store.mjs
//
// **这个脚本存在的理由，就是它以前不存在。** 0.3.2 换主题时，`docs/images/` 那 4 张
// 有 `shot-readme.mjs` 可以重跑，这 6 张没有任何产出路径 —— 于是改版把它们落下了，
// 而**没有任何检查会因此变红**：构建绿、E2E 绿、五道门禁绿，商店里却挂着一个已经
// 不存在的产品外观。发布物里存在"没有可复现产出路径的东西"，就等于存在一件
// **只能靠人记得**的事；人不会一直记得。
//
// 取材口径与 README 图共用 `shot-fixture.mjs`（同一份，不是抄一份）：真实仓库、
// 真实文件、真实的 node_modules/.git。旧的 `02-jump-to-definition` 与
// `jump-affordance` 拍的是一个合成的 2 文件玩具项目，与那条口径相抵触，这次一并改掉。
//
// 每个场景都**先断言它要展示的东西真的在画面里**，断不下来就抛错中止。
// 一张"少了主角"的截图看上去和正常图没有区别 —— 这正是最贵的一类静默失败。
import { execSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { PROJECT } from './paths.mjs'
import {
  collectRealFiles, launchViewer, openRealProject, makeClickRow, setTheme, settle,
} from './shot-fixture.mjs'

const STORE = join(PROJECT, 'assets', 'chrome-web-store', 'screenshots')
const DOCS = join(PROJECT, 'docs', 'images')

// 商店要求截图正好是 1280×800（或 640×400）。deviceScaleFactor 必须是 1：
// 2 倍图会得到 2560×1600，商店会拒收。
const STORE_VIEWPORT = { width: 1280, height: 800, deviceScaleFactor: 1 }
const AFFORDANCE_VIEWPORT = { width: 1360, height: 820, deviceScaleFactor: 1 }

console.log('building dev bundle…')
execSync('npx vite build --mode development --outDir dist-dev', { cwd: PROJECT, stdio: 'inherit' })
mkdirSync(STORE, { recursive: true })
mkdirSync(DOCS, { recursive: true })

const payload = collectRealFiles()
console.log(`真实文件 ${payload.length} 个`)

const { browser, page } = await launchViewer(STORE_VIEWPORT)
const clickRow = makeClickRow(page)

const shot = async (dir, name) => {
  await settle()
  await page.screenshot({ path: join(dir, name) })
  console.log('截图:', name)
}

/** 断言画面里有某个东西，没有就中止 —— 不出一张缺了主角的图 */
const must = async (selector, what) => {
  const el = await page.$(selector)
  if (!el) throw new Error(`${what}：画面里没有 ${selector} —— 中止，不出这张图`)
  return el
}

/**
 * 造出「按住 ⌘ 时标识符变成可跳转下划线」那个状态。
 * 先把鼠标移开再移回来：hover 状态要靠一次真实的移动进入，
 * 直接 move 到已经在的位置不会触发 mousemove。
 */
const holdJumpHint = async (token) => {
  const spot = await page.evaluate((t) => {
    const el = [...document.querySelectorAll('.cm-content span')].find((s) => s.textContent === t)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  }, token)
  if (!spot) throw new Error(`代码区找不到标识符「${token}」—— 中止`)
  await page.keyboard.down('Meta')
  await page.mouse.move(spot.x + 160, spot.y)
  await page.mouse.move(spot.x, spot.y)
  await settle(200)
  const hint = await page.$('.cm-jump-hint')
  if (!hint) {
    await page.keyboard.up('Meta')
    throw new Error(`按住 ⌘ 后「${token}」没有出现 .cm-jump-hint —— 中止，不出一张没有提示的"跳转"图`)
  }
}

try {
  await openRealProject(page, payload)

  // ---- 01 概览（浅色）----
  await clickRow('src')
  await clickRow('intel')
  await clickRow('extract.ts')
  await page.waitForSelector('.cm-content', { timeout: 10000 })
  await settle(900)
  await must('.tree-row', '01 概览')
  await must('.outline-panel, .cm-content', '01 概览')
  await shot(STORE, '01-overview-light.png')

  // ---- 02 跳转到定义（真实仓库，不是玩具项目）----
  //
  // 拍的是**跳转之后**，不是"按住 ⌘ 时的下划线"。两者都真实，但商店截图要能
  // 一眼看懂在演什么：真实仓库满屏代码时，那道 1px 下划线小到访客不会注意；
  // 跳转后目标行有整行高亮，隔着缩略图也认得出。**诚实与清晰在这张图上有张力，
  // 解法不是退回玩具项目，而是换一个同样真实、但自身更显眼的瞬间。**
  const fileNow = () => page.$eval('.preview-header .file-path', (el) => el.textContent.trim())
  const from = await fileNow()
  await holdJumpHint('KIND')          // 先进入可跳转态，⌘ 仍按住
  await page.mouse.down(); await page.mouse.up()
  await page.keyboard.up('Meta')
  await page.waitForFunction((f) => {
    const el = document.querySelector('.preview-header .file-path')
    return el && el.textContent.trim() !== f
  }, { timeout: 8000 }, from)
  await settle(600)
  const to = await fileNow()
  // 目标行高亮**就是这张图要展示的东西**；它不在，这张图就什么也没演示
  await must('.cm-target-line', '02 跳转到定义')
  console.log(`跳转:${from} → ${to}  ✓ 目标行高亮在画面里`)
  await shot(STORE, '02-jump-to-definition.png')

  // 退回原文件：后面几张都以 extract.ts 为背景，跳转把它换掉了
  await page.keyboard.down('Alt'); await page.keyboard.press('ArrowLeft'); await page.keyboard.up('Alt')
  await page.waitForFunction((f) => {
    const el = document.querySelector('.preview-header .file-path')
    return el && el.textContent.trim() === f
  }, { timeout: 8000 }, from)
  await settle(500)

  // ---- 05 概览（深色）：趁文件还开着先拍，省一次来回 ----
  await setTheme(page, 'dark')
  await settle(600)
  await shot(STORE, '05-overview-dark.png')
  await setTheme(page, 'light')
  await settle(400)

  // ---- 04 键盘操作（帮助面板）----
  await page.click('.help-toggle')
  await settle(700)
  await must('.help-panel', '04 键盘操作')
  await shot(STORE, '04-keyboard-navigation.png')
  await page.keyboard.press('Escape')
  await settle(500)

  // ---- 03 默认排除但不静默（「已隐藏 N 项」那一行）----
  // 收起展开的目录，让那一行回到视口。它是"默认排除但不静默"这条产品承诺
  // **唯一看得见的证据**，把它裁出画面等于把最想展示的克制裁掉。
  await clickRow('intel')
  await clickRow('src')
  const hiddenLabel = await page
    .$eval('.tree-row.tree-hidden .label', (el) => el.textContent.trim())
    .catch(() => null)
  if (!hiddenLabel) throw new Error('「已隐藏 N 项」不在视口内 —— 中止，不出一张缺了它的树图')
  console.log('隐藏提示行:', hiddenLabel)
  await shot(STORE, '03-hidden-directories.png')

  // ---- jump-affordance（README 用，另一个尺寸）----
  await page.setViewport(AFFORDANCE_VIEWPORT)
  await settle(400)
  await clickRow('src')
  await clickRow('intel')
  await clickRow('extract.ts')
  await page.waitForSelector('.cm-content', { timeout: 10000 })
  await settle(700)
  await holdJumpHint('KIND')
  await shot(DOCS, 'jump-affordance.png')
  await page.keyboard.up('Meta')
} finally {
  await browser.close()
}

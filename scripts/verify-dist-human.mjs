// 发布产物人在环验收:真实目录选择器 + 真 dist + 行为观测。
//
// 唯一需要人工完成的步骤是 Chrome 的 showDirectoryPicker 授权。之后所有动作
// 都通过键盘输入完成,断言只读取用户可见的 DOM 与浏览器焦点;不得引用 __cv 等
// 仅开发构建存在的测试钩子。
import puppeteer from 'puppeteer-core'
import { mkdtempSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { PROJECT, resolveChrome } from './paths.mjs'

const DIST = join(PROJECT, 'dist')
const suggestedProject = process.env.LECTERN_VERIFY_PROJECT ?? join(homedir(), 'Desktop', 'lectern-verify-project')
const profile = mkdtempSync(join(tmpdir(), 'lectern-human-'))
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const results = []

function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

async function chord(page, keys, key) {
  for (const modifier of keys) await page.keyboard.down(modifier)
  await page.keyboard.press(key)
  for (const modifier of [...keys].reverse()) await page.keyboard.up(modifier)
}

const browser = await puppeteer.launch({
  executablePath: resolveChrome(),
  headless: false,
  pipe: true,
  enableExtensions: true,
  protocolTimeout: 0,
  args: [
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1440,900',
  ],
  defaultViewport: null,
})

try {
  const extensionId = await browser.installExtension(DIST)
  const page = await browser.newPage()
  await page.goto(`chrome-extension://${extensionId}/viewer.html`, { waitUntil: 'domcontentloaded' })

  console.log('\n============================================================')
  console.log('已打开冻结的 dist。请在 Chrome 中点击“打开文件夹”,选择:')
  console.log(suggestedProject)
  console.log('授权完成后脚本自动接管;等待上限 5 分钟。')
  console.log('============================================================\n')

  // 真实文件系统入口不可由脚本代替用户授权;tree-row 出现是入口成功的行为证据。
  await page.waitForSelector('.tree-row', { timeout: 300_000 })
  check('[5.4] showDirectoryPicker 真实入口可打开项目', true)
  await sleep(1000)

  const probe = () => page.evaluate(() => {
    const selection = window.getSelection()
    const node = selection?.anchorNode
    const selectedLine = (node?.nodeType === Node.TEXT_NODE ? node.parentElement : node)
      ?.closest?.('.cm-line')?.textContent ?? null
    const activeLine = document.querySelector('.cm-activeLine')?.textContent ?? null
    const active = document.activeElement
    return {
      line: selectedLine ?? activeLine,
      file: document.querySelector('.preview-header .file-path')?.textContent?.trim() ?? null,
      focus: active?.closest?.('.cm-editor')
        ? 'editor'
        : active?.classList?.contains('search-input')
          ? 'search-input'
          : active === document.body
            ? 'body'
            : String(active?.className || active?.tagName || 'unknown'),
    }
  })

  const openFile = async (name) => {
    await chord(page, ['Meta'], 'KeyK')
    await page.keyboard.type(name)
    await page.waitForFunction(
      (expected) => [...document.querySelectorAll('.search-result .result-name')]
        .some((node) => node.textContent?.includes(expected)),
      { timeout: 20_000 },
      name,
    )
    await page.keyboard.press('Enter')
    await page.waitForFunction(
      (expected) => document.querySelector('.preview-header .file-path')?.textContent?.endsWith(expected),
      { timeout: 10_000 },
      name,
    )
    await sleep(500)
  }

  // 符号搜索:远离文件头的定义行 + 焦点交接。
  await openFile('main.ts')
  await chord(page, ['Meta', 'Shift'], 'KeyO')
  await page.keyboard.type('targetBeta')
  await page.waitForFunction(
    () => [...document.querySelectorAll('.search-result .result-name')]
      .some((node) => node.textContent === 'targetBeta'),
    { timeout: 20_000 },
  )
  await page.keyboard.press('Enter')
  await page.waitForFunction(
    () => document.querySelector('.preview-header .file-path')?.textContent?.endsWith('beta.ts'),
    { timeout: 10_000 },
  )
  await sleep(500)
  {
    const state = await probe()
    check(
      '[5.3] ⌘⇧O 后 caret 落在 targetBeta 且焦点在编辑器',
      state.line?.includes('targetBeta') && state.focus === 'editor',
      JSON.stringify(state),
    )
  }

  // 定义跳转:从 main.ts 第 4 行的调用处用纯键盘定位与触发。
  await openFile('main.ts')
  await page.keyboard.press('Home')
  for (let i = 0; i < 3; i += 1) await page.keyboard.press('ArrowDown')
  for (let i = 0; i < 12; i += 1) await page.keyboard.press('ArrowRight')
  await chord(page, ['Meta'], 'Enter')
  await page.waitForFunction(
    () => document.querySelector('.preview-header .file-path')?.textContent?.endsWith('alpha.ts'),
    { timeout: 10_000 },
  )
  await sleep(500)
  {
    const state = await probe()
    check(
      '[5.3] ⌘↩ 后 caret 落在 targetAlpha 定义行',
      state.line?.includes('targetAlpha') && state.focus === 'editor',
      JSON.stringify(state),
    )
  }

  // 导航历史:离开位置不是文件头,回来后能直接继续向下移动。
  await openFile('beta.ts')
  await page.keyboard.press('Home')
  for (let i = 0; i < 40; i += 1) await page.keyboard.press('ArrowDown')
  const before = await probe()
  await chord(page, ['Meta', 'Shift'], 'KeyO')
  await page.keyboard.type('targetAlpha')
  await page.waitForFunction(
    () => [...document.querySelectorAll('.search-result .result-name')]
      .some((node) => node.textContent === 'targetAlpha'),
    { timeout: 20_000 },
  )
  await page.keyboard.press('Enter')
  await page.waitForFunction(
    () => document.querySelector('.preview-header .file-path')?.textContent?.endsWith('alpha.ts'),
    { timeout: 10_000 },
  )
  await chord(page, ['Alt'], 'ArrowLeft')
  await page.waitForFunction(
    () => document.querySelector('.preview-header .file-path')?.textContent?.endsWith('beta.ts'),
    { timeout: 10_000 },
  )
  await sleep(400)
  const returned = await probe()
  await page.keyboard.press('ArrowDown')
  const continued = await probe()
  check(
    '[5.3] ⌥← 回到离开位置、焦点在编辑器、↓ 从该行继续',
    before.line === '// B padding 41'
      && returned.line === before.line
      && returned.focus === 'editor'
      && continued.line === '// B padding 42',
    JSON.stringify({ before, returned, continued }),
  )

  // 全文结果保持列表焦点;关闭后严格回触发搜索框;Tab 回编辑器后从命中行继续。
  await chord(page, ['Meta', 'Shift'], 'KeyF')
  await page.keyboard.type('NEEDLE_MARKER_XYZ')
  await page.keyboard.press('Enter')
  await page.waitForSelector('.content-panel .ref-row', { timeout: 20_000 })
  await page.keyboard.press('Enter')
  await page.waitForFunction(
    () => document.querySelector('.preview-header .file-path')?.textContent?.endsWith('gamma.ts'),
    { timeout: 10_000 },
  )
  await sleep(500)
  const selected = await probe()
  check(
    '[5.3] 全文结果激活后焦点仍在列表且目标文件已打开',
    selected.focus !== 'editor'
      && selected.focus !== 'body'
      && selected.file?.endsWith('gamma.ts'),
    JSON.stringify(selected),
  )
  await page.keyboard.press('Escape')
  await sleep(300)
  const closed = await probe()
  check(
    '[5.3] 全文面板 Esc 后焦点严格归还搜索框',
    closed.focus === 'search-input',
    JSON.stringify(closed),
  )
  let editorFocused = false
  const focusTrail = []
  for (let i = 0; i < 20 && !editorFocused; i += 1) {
    await page.keyboard.press('Tab')
    const state = await probe()
    focusTrail.push(state.focus)
    editorFocused = state.focus === 'editor'
  }
  const atContent = await probe()
  await page.keyboard.press('ArrowDown')
  const afterContent = await probe()
  check(
    '[5.3] Tab 进入代码区时 caret 已在全文命中行,↓ 从该行继续',
    editorFocused
      && atContent.line?.includes('NEEDLE_MARKER_XYZ')
      && afterContent.line?.includes('AFTER_NEEDLE_LINE'),
    JSON.stringify({ focusTrail, atContent, afterContent }),
  )
} catch (error) {
  check('验收脚本完整执行', false, error instanceof Error ? error.stack ?? error.message : String(error))
} finally {
  const failed = results.filter((result) => !result.ok)
  console.log(`\n===== 人在环验收: ${results.length - failed.length}/${results.length} PASS =====`)
  await browser.close()
  if (failed.length > 0) process.exitCode = 1
}

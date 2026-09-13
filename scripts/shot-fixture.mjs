// 出图脚本的公共取材层：把**本仓库自己的真实文件**灌进 OPFS，再打开查看器。
//
// **为什么这是一个共享模块而不是各脚本各抄一份**：下面 `collectRealFiles()` 承载的
// 不是代码，是**取样口径**——"截图必须是真实仓库打开后的样子"。这条口径一旦有两份
// 副本，它们会漂移，而且**漂移的那一刻两份都还在正常出图**，没有任何东西会变红。
// 这不是假设：0.3.2 备料时发现，商店那批截图用的是一个合成的 2 文件玩具项目
// （"索引已完成(2 个文件 / 2 个符号)"），而 `shot-readme.mjs` 开头明写着"不要改成
// 合成项目"——同一个仓库里，两套发布图执行着**互相矛盾的口径**，谁都没红。
//
// 口径本身（不要绕过）：
//   * 用真实文件名、真实代码、真实的 `node_modules` / `.git` —— 后两者正是
//     「已隐藏 N 项」存在的理由，合成项目不长这两样，拿它拍出来的图证明不了任何事。
//   * 仍然经由 OPFS，是因为原生目录选择器无法自动化（浏览器 UI，CDP 合成事件进不去）。
//     "合成"的只剩"字节是怎么进去的"，那一点观者看不见，也不构成虚假陈述。
//   * **不接受的是另外两种**：造一个好看的假项目，或挑一个不会触发缺陷的样本
//     —— 那是修图的变体。
import puppeteer from 'puppeteer-core'
import { mkdtempSync, readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, extname } from 'node:path'
import { PROJECT, resolveChrome } from './paths.mjs'

export const DIST_DEV = join(PROJECT, 'dist-dev')

// 真实文件：体积上限只是为了让 CDP 传输可控，不改变"内容是真的"这一点
const MAX_BYTES = 96 * 1024
const TEXT_EXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.json', '.md', '.html', '.css', '.svg', '.yml', '.yaml', ''])
const INCLUDE = ['src', 'docs', 'openspec', 'scripts', 'public', 'assets', '.github']
const ROOT_FILES = [
  'README.md', 'README.zh-CN.md', 'CONTRIBUTING.md', 'SECURITY.md', 'PRIVACY.md',
  'LICENSE', 'NOTICE', 'package.json', 'tsconfig.json', 'vite.config.ts', 'viewer.html',
]

/** 收集真实文件 → [{path, text}]，路径相对仓库根 */
export function collectRealFiles() {
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
  // 被默认排除的重目录。**「已隐藏 N 项」的 N 数的是"该层被排除的条目数"，不是文件数**，
  // 所以这里放的是真实存在的那几个目录名即可 —— 把 node_modules 的几千个文件灌进来
  // 只会让脚本跑几分钟，**图上一个字都不会变**。
  const real = readdirSync(join(PROJECT, 'node_modules')).filter((n) => !n.startsWith('.')).slice(0, 3)
  for (const name of real) files.push({ path: `node_modules/${name}/package.json`, text: `{ "name": "${name}" }` })
  files.push({ path: '.git/HEAD', text: 'ref: refs/heads/main\n' })
  files.push({ path: 'dist/manifest.json', text: '{}' })
  return files
}

export const settle = (ms = 500) => new Promise((r) => setTimeout(r, ms))

/** 装好扩展、开一个页面。viewport 由调用方给 —— 商店图和 README 图尺寸不同。 */
export async function launchViewer(viewport) {
  const browser = await puppeteer.launch({
    executablePath: resolveChrome(),
    headless: false,
    pipe: true,
    enableExtensions: true,
    args: [
      `--user-data-dir=${mkdtempSync(join(tmpdir(), 'lectern-shot-'))}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
    defaultViewport: viewport,
  })
  const extId = await browser.installExtension(DIST_DEV)
  const page = await browser.newPage()
  await page.goto(`chrome-extension://${extId}/viewer.html`, { waitUntil: 'load' })
  await page.waitForSelector('.welcome', { timeout: 10000 })
  return { browser, page }
}

/** 把真实文件写进 OPFS 并进入项目 */
export async function openRealProject(page, payload) {
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
}

/**
 * 点目录树的一行。**按 `.label` 的精确文本匹配，不按整行前缀** —— 行的 textContent
 * 以三角符号开头（`▸`），前缀匹配在这里静默失效过一次：点击没发生、脚本照常出图。
 * 找不到就抛，不继续 —— 出一张"没打开文件的首屏图"比报错难发现得多。
 */
export function makeClickRow(page) {
  return async (name) => {
    const ok = await page.evaluate((n) => {
      const label = [...document.querySelectorAll('.tree-row .label')].find((el) => el.textContent.trim() === n)
      if (!label) return false
      label.closest('.tree-row').dispatchEvent(new MouseEvent('click', { bubbles: true }))
      return true
    }, name)
    await settle(700)
    if (!ok) throw new Error(`目录树里找不到「${name}」—— 出图前中止，免得产出一张没打开文件的图`)
    return ok
  }
}

/** 切到指定主题并等它真的生效（不是等固定时长） */
export async function setTheme(page, want /* 'dark' | 'light' */) {
  const now = await page.evaluate(() => document.documentElement.getAttribute('data-theme'))
  const isDark = now === 'dark'
  if (isDark === (want === 'dark')) return
  await page.click('.theme-toggle')
  await page.waitForFunction(
    (w) => (document.documentElement.getAttribute('data-theme') === 'dark') === (w === 'dark'),
    { timeout: 5000 }, want,
  )
}

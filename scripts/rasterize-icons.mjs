// 把 assets 里的两版 SVG 栅格化成 public/icons 的四档 PNG。
//
// 为什么是两版而不是一版缩放:16×16 上,一个在 128 上好看的设计会糊成一团。
// 细节版(48/128)保留三条代码行与细立柱;小尺寸版(16/32)加粗笔画、减到两条行。
//
// **每档用独立的 user-data-dir**:headless Chrome 的截图模式进程不会立刻退出,
// 连续复用同一个 profile 会撞上 profile 锁,表现为"卡住直到超时"(这个坑踩过)。
import puppeteer from 'puppeteer-core'
import { readFileSync, mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PROJECT, resolveChrome } from './paths.mjs'

const CHROME = resolveChrome()
const OUT = join(PROJECT, 'public/icons')
mkdirSync(OUT, { recursive: true })

// 档位 → 用哪一版 SVG。16/32 走加粗版,48/128 走细节版。
const SIZES = [
  { px: 16, svg: 'assets/icon-small.svg' },
  { px: 32, svg: 'assets/icon-small.svg' },
  { px: 48, svg: 'assets/icon.svg' },
  { px: 128, svg: 'assets/icon.svg' },
]

for (const { px, svg } of SIZES) {
  const markup = readFileSync(join(PROJECT, svg), 'utf8')
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: [`--user-data-dir=${mkdtempSync(join(tmpdir(), `cv-icon-${px}-`))}`, '--no-first-run'],
  })
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: px, height: px, deviceScaleFactor: 1 })
    // 背景透明 + 零边距,保证 PNG 恰好是图标本身
    await page.setContent(
      `<html><body style="margin:0;background:transparent">
         <div style="width:${px}px;height:${px}px">${markup.replace(/width="128" height="128"/, `width="${px}" height="${px}"`)}</div>
       </body></html>`,
      { waitUntil: 'load' },
    )
    await page.screenshot({ path: join(OUT, `icon-${px}.png`), omitBackground: true })
    console.log(`icon-${px}.png  ←  ${svg}`)
  } finally {
    await browser.close()
  }
}

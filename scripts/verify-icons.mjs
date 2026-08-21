// 图标接入验证:真机装载正式 dist,确认 manifest 解析、四档图标资源可解码。
import puppeteer from 'puppeteer-core'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PROJECT, resolveChrome } from './paths.mjs'

const DIST = join(PROJECT, 'dist')
const CHROME = resolveChrome()

const results = []
const check = (name, ok, extra = '') => {
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`)
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  pipe: true,
  enableExtensions: true,
  args: [
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'cv-icon-'))}`,
    '--no-first-run',
    '--no-default-browser-check',
  ],
  defaultViewport: { width: 1200, height: 800 },
})

try {
  // 装载正式 dist(非 dist-dev):manifest 非法会直接抛错
  const extId = await browser.installExtension(DIST)
  check('正式 dist 装载成功(manifest 合法)', !!extId, extId)

  const page = await browser.newPage()
  await page.goto(`chrome-extension://${extId}/viewer.html`, { waitUntil: 'load' })

  // manifest 经 Chrome 解析后的实际内容
  const manifest = await page.evaluate(() => chrome.runtime.getManifest())
  const sizes = ['16', '32', '48', '128']
  check(
    'Chrome 解析后的 manifest.icons 四档齐全',
    sizes.every((s) => manifest.icons?.[s] === `icons/icon-${s}.png`),
    JSON.stringify(manifest.icons),
  )
  check(
    'action.default_icon 四档齐全',
    sizes.every((s) => manifest.action?.default_icon?.[s] === `icons/icon-${s}.png`),
    JSON.stringify(manifest.action?.default_icon),
  )

  // 逐档确认 PNG 可被浏览器实际解码(尺寸正确、非空白)
  for (const s of sizes) {
    const info = await page.evaluate(async (size) => {
      const url = chrome.runtime.getURL(`icons/icon-${size}.png`)
      const bitmap = await createImageBitmap(await (await fetch(url)).blob())
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      const ctx = canvas.getContext('2d')
      ctx.drawImage(bitmap, 0, 0)
      const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data
      let opaque = 0
      for (let i = 3; i < data.length; i += 4) if (data[i] > 8) opaque++
      return { w: bitmap.width, h: bitmap.height, opaqueRatio: opaque / (data.length / 4) }
    }, s)
    check(
      `icon-${s}.png 可解码且有可见内容`,
      info.w === +s && info.h === +s && info.opaqueRatio > 0.3,
      `${info.w}x${info.h} 不透明像素占比 ${(info.opaqueRatio * 100).toFixed(0)}%`,
    )
  }

  // 扩展页仍正常工作(图标接入未影响功能)
  await page.waitForSelector('.welcome', { timeout: 8000 })
  check('查看器页面仍正常渲染', true)
} catch (err) {
  check('脚本执行', false, String(err).split('\n')[0])
} finally {
  await browser.close()
  const pass = results.filter(Boolean).length
  console.log(`\n===== ${pass}/${results.length} PASS =====`)
  process.exit(results.every(Boolean) ? 0 : 1)
}

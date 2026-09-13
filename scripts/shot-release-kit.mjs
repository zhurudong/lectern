// Capture the actual AI candidate in a disposable browser profile. No store automation.
import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PROJECT, resolveChrome } from './paths.mjs'
import { collectRealFiles, makeClickRow, setTheme, settle } from './shot-fixture.mjs'
const temp = mkdtempSync(join(tmpdir(), 'lectern-kit-shots-'))
const version = JSON.parse(readFileSync(join(PROJECT, 'package.json'), 'utf8')).version
const output = join(PROJECT, 'release-artifacts', `web-store-${version}`, 'images')
const browser = await puppeteer.launch({ executablePath: resolveChrome(), userDataDir: temp, headless: false, pipe: true,
  enableExtensions: true, args: ['--no-first-run', '--no-default-browser-check'],
  defaultViewport: { width: 1280, height: 800, deviceScaleFactor: 1 } })
try {
  const id = await browser.installExtension(join(PROJECT, 'dist-ai'))
  // The real system companion must never run during screenshot generation.
  const hosts = join(temp, 'NativeMessagingHosts'); mkdirSync(hosts, { recursive: true })
  writeFileSync(join(hosts, 'com.lectern.agent.json'), JSON.stringify({ name: 'com.lectern.agent', description: 'Screenshot first use', path: join(temp, 'not-installed'), type: 'stdio', allowed_origins: [`chrome-extension://${id}/`] }))
  if (!process.argv.includes('--promos-only')) for (const locale of ['en', 'zh']) {
    const page = await browser.newPage(), errors = []
    page.on('pageerror', e => errors.push(String(e)))
    await page.evaluateOnNewDocument((lang) => localStorage.setItem('cv-lang', lang), locale)
    await page.goto(`chrome-extension://${id}/viewer.html`)
    await page.waitForSelector('.welcome')
    await page.evaluate(async (files) => {
      const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('lectern', { create: true })
      for (const { path, text } of files) {
        const parts = path.split('/'); let dir = root
        for (const name of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(name, { create: true })
        const f = await dir.getFileHandle(parts.at(-1), { create: true }), w = await f.createWritable()
        await w.write(text); await w.close()
      }
      window.showDirectoryPicker = async () => root
    }, collectRealFiles())
    await page.evaluate((label) => [...document.querySelectorAll('button')].find(el => el.textContent.trim() === label).click(), locale === 'en' ? 'Open Folder' : '打开文件夹')
    await page.waitForSelector('.tree-row')
    const clickRow = makeClickRow(page)
    await clickRow('src'); await clickRow('intel'); await clickRow('extract.ts')
    await page.waitForSelector('.cm-content')
    const dir = join(output, locale === 'en' ? 'en' : 'zh_CN'); mkdirSync(dir, { recursive: true })
    await setTheme(page, 'light'); await settle(1000)
    await page.screenshot({ path: join(dir, '01-code-reader.png') })
    await setTheme(page, 'dark'); await settle()
    await page.screenshot({ path: join(dir, '02-dark-reader.png') })
    await setTheme(page, 'light'); await page.click('.ai-toggle')
    await page.waitForSelector('.ai-onboarding')
    assert.ok(await page.$('.ai-onboarding a'))
    await settle()
    await page.screenshot({ path: join(dir, '03-terminal-first-use.png') })
    assert.deepEqual(errors, [])
    console.log(`PASS ${locale}: 3 actual candidate screenshots; terminal shows first-use installation, no simulated AI output`)
    await page.close()
  }
  const promos = join(output, 'promos'); mkdirSync(promos, { recursive: true })
  const icon = readFileSync(join(PROJECT, 'public/icons/icon-128.png')).toString('base64')
  const promo = await browser.newPage()
  for (const [name, width, height] of [['small-promo-440x280.png', 440, 280], ['marquee-promo-1400x560.png', 1400, 560]]) {
    await promo.setViewport({ width, height, deviceScaleFactor: 1 })
    await promo.setContent(`<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#132033;color:#f6f8ff;font-family:system-ui;padding:${width === 440 ? '28px 30px' : '60px 100px'};height:100vh;display:flex;flex-direction:column;justify-content:space-between}.brand{display:flex;align-items:center;gap:16px;font-weight:700;font-size:${width === 440 ? 30 : 54}px}.brand img{width:${width === 440 ? 48 : 80}px}h1{font-size:${width === 440 ? 31 : 76}px;line-height:1.12;font-weight:600;letter-spacing:-1px;margin:12px 0}p{color:#b9cbe5;font-size:${width === 440 ? 14 : 25}px;margin:0;border-top:1px solid #3b4c64;padding-top:16px}</style><div class="brand"><img src="data:image/png;base64,${icon}">Lectern</div><h1>Read code.<br>Keep your context.</h1><p>Local code reader · Optional AI terminal</p>`)
    await promo.screenshot({ path: join(promos, name) })
  }
  await promo.close()
  console.log('PASS global promo sizes; copy distinguishes the optional AI terminal')
} finally { await browser.close(); rmSync(temp, { recursive: true, force: true }) }

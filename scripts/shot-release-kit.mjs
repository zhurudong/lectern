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
    await page.evaluateOnNewDocument((lang) => {
      localStorage.setItem('cv-lang', lang)
      // Each locale starts with the same screenshot sequence, independently of
      // the docking preference retained by the preceding locale's page.
      localStorage.setItem('lectern-ai-terminal-dock', 'right')
    }, locale)
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
    await page.waitForSelector('.ai-panel[data-dock="right"]')
    assert.ok(await page.$('.ai-onboarding a'))
    await settle()
    await page.screenshot({ path: join(dir, '03-terminal-first-use.png') })
    await page.click('.ai-dock-toggle')
    await page.waitForSelector('.ai-panel[data-dock="bottom"]')
    await settle()
    await page.screenshot({ path: join(dir, '04-terminal-bottom.png') })
    assert.deepEqual(errors, [])
    console.log(`PASS ${locale}: 4 actual candidate screenshots; both terminal layouts show first-use installation, no simulated AI output`)
    await page.close()
  }
  const promos = join(output, 'promos'); mkdirSync(promos, { recursive: true })
  const icon = readFileSync(join(PROJECT, 'public/icons/icon-128.png')).toString('base64')
  const reader = readFileSync(join(output, 'en', '02-dark-reader.png')).toString('base64')
  const promo = await browser.newPage()
  for (const [name, width, height] of [['small-promo-440x280.png', 440, 280], ['marquee-promo-1400x560.png', 1400, 560]]) {
    await promo.setViewport({ width, height, deviceScaleFactor: 1 })
    const compact = width === 440
    const headline = compact ? 'Read code. Run your AI CLI.' : 'Read your code.<br>Keep your AI CLI<br>beside it.'
    await promo.setContent(`<!doctype html><meta charset="utf-8"><style>
      *{box-sizing:border-box}
      body{margin:0;background:#132033;color:#f6f8ff;font-family:system-ui;height:100vh;overflow:hidden}
      .copy{position:absolute;left:${compact ? 24 : 44}px;top:${compact ? 16 : 42}px;width:${compact ? 392 : 482}px}
      .brand{display:flex;align-items:center;gap:${compact ? 10 : 16}px;font-weight:700;font-size:${compact ? 28 : 44}px}
      .brand img{width:${compact ? 36 : 64}px}
      h1{font-size:${compact ? 25 : 48}px;line-height:1.14;font-weight:600;letter-spacing:-1px;margin:${compact ? '12px 0 0' : '42px 0 26px'}}
      p{color:#c5d5eb;font-size:19px;line-height:1.5;margin:0;max-width:410px}
      small{position:absolute;left:${compact ? 24 : 44}px;bottom:${compact ? 12 : 38}px;width:${compact ? 392 : 440}px;color:#a6b8d0;font-size:${compact ? 10 : 14}px;line-height:1.5}
      .product{position:absolute;left:${compact ? 24 : 568}px;top:${compact ? 101 : 34}px;width:${compact ? 392 : 792}px;height:${compact ? 145 : 495}px;border:1px solid #45546a;border-radius:${compact ? 7 : 12}px;overflow:hidden;box-shadow:0 18px 50px #0005;background:#191713}
      .product img{display:block;width:100%;height:100%;object-fit:cover;object-position:center top}
    </style><main class="copy"><div class="brand"><img src="data:image/png;base64,${icon}">Lectern</div>
    <h1>${headline}</h1>${compact ? '' : '<p>Browse local files. Follow definitions.<br>Review changes with your AI CLI alongside.</p>'}</main>
    <div class="product"><img src="data:image/png;base64,${reader}" alt="Lectern code reader with file tree, syntax highlighting, and symbol outline"></div>
    <small>AI terminal requires macOS companion + installed CLI.</small>`)
    await promo.evaluate(() => document.fonts.ready)
    await promo.evaluate(() => Promise.all([...document.images].map(img => img.decode())))
    await promo.screenshot({ path: join(promos, name) })
  }
  await promo.close()
  console.log('PASS global promo sizes; copy distinguishes the optional AI terminal')
} finally { await browser.close(); rmSync(temp, { recursive: true, force: true }) }

// Chrome Web Store promotional images.
//
// These are not resized product screenshots: the store gives promo tiles a
// different job and a different aspect ratio. Keep the copy short, use the
// real product icon, and use a real in-product screenshot where UI is shown.
import puppeteer from 'puppeteer-core'
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PROJECT, resolveChrome } from './paths.mjs'

const OUT = join(PROJECT, 'assets', 'chrome-web-store', 'promos')
const icon = readFileSync(join(PROJECT, 'assets', 'icon.svg'), 'utf8')
const hero = readFileSync(join(PROJECT, 'docs', 'images', 'hero-dark.png')).toString('base64')

mkdirSync(OUT, { recursive: true })

const shared = `
  * { box-sizing: border-box; }
  html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
      "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    color: #f7f9ff;
    -webkit-font-smoothing: antialiased;
  }
  .canvas {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background:
      radial-gradient(circle at 18% 8%, rgba(91, 140, 255, .28), transparent 35%),
      radial-gradient(circle at 93% 88%, rgba(78, 201, 176, .18), transparent 34%),
      linear-gradient(135deg, #111827 0%, #17213a 52%, #101725 100%);
  }
  .canvas::after {
    content: "";
    position: absolute;
    inset: 0;
    background-image:
      linear-gradient(rgba(255,255,255,.025) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255,255,255,.025) 1px, transparent 1px);
    background-size: 28px 28px;
    mask-image: linear-gradient(to bottom right, black, transparent 72%);
    pointer-events: none;
  }
  .icon { flex: 0 0 auto; filter: drop-shadow(0 12px 28px rgba(0,0,0,.28)); }
  .icon svg { display: block; width: 100%; height: 100%; }
  .eyebrow { color: #9db8ff; font-weight: 650; letter-spacing: .08em; }
  .pills { display: flex; gap: 10px; flex-wrap: wrap; }
  .pill {
    border: 1px solid rgba(157, 184, 255, .30);
    background: rgba(255,255,255,.07);
    color: #dce6ff;
    border-radius: 999px;
    font-weight: 650;
  }
`

const small = `<!doctype html><meta charset="utf-8"><style>
  ${shared}
  .content { position: absolute; z-index: 1; inset: 34px 36px; }
  .brand { display: flex; align-items: center; gap: 18px; }
  .icon { width: 68px; height: 68px; }
  .name { font-size: 36px; line-height: 1; font-weight: 760; letter-spacing: -.02em; }
  .eyebrow { margin-top: 6px; font-size: 12px; }
  h1 { margin: 27px 0 20px; font-size: 29px; line-height: 1.18; letter-spacing: -.025em; }
  .pill { padding: 7px 12px; font-size: 13px; }
</style><div class="canvas"><main class="content">
  <div class="brand"><div class="icon">${icon}</div><div><div class="name">Lectern</div><div class="eyebrow">LOCAL CODE READER</div></div></div>
  <h1>读懂 AI 生成的代码</h1>
  <div class="pills"><span class="pill">零网络</span><span class="pill">只读</span><span class="pill">本地运行</span></div>
</main></div>`

const marquee = `<!doctype html><meta charset="utf-8"><style>
  ${shared}
  .copy { position: absolute; z-index: 2; left: 68px; top: 58px; width: 540px; }
  .brand { display: flex; align-items: center; gap: 20px; }
  .icon { width: 82px; height: 82px; }
  .name { font-size: 43px; line-height: 1; font-weight: 760; letter-spacing: -.025em; }
  .eyebrow { margin-top: 8px; font-size: 13px; }
  h1 { margin: 40px 0 18px; font-size: 49px; line-height: 1.13; letter-spacing: -.035em; }
  .subtitle { margin-bottom: 30px; color: #c5d0e8; font-size: 20px; line-height: 1.5; }
  .pill { padding: 8px 14px; font-size: 15px; }
  .product {
    position: absolute;
    z-index: 1;
    left: 650px;
    top: 43px;
    width: 760px;
    height: 475px;
    padding: 9px;
    border: 1px solid rgba(157, 184, 255, .30);
    border-radius: 17px;
    background: rgba(255,255,255,.08);
    box-shadow: 0 30px 70px rgba(0,0,0,.43), 0 0 0 1px rgba(255,255,255,.04) inset;
    transform: perspective(1300px) rotateY(-3deg);
    transform-origin: left center;
  }
  .product img { display: block; width: 100%; height: 100%; object-fit: cover; border-radius: 10px; }
</style><div class="canvas">
  <main class="copy">
    <div class="brand"><div class="icon">${icon}</div><div><div class="name">Lectern</div><div class="eyebrow">LOCAL CODE READER</div></div></div>
    <h1>AI 写得更快<br>你要更快读懂它</h1>
    <div class="subtitle">无需上传代码，在浏览器中理解陌生代码库。</div>
    <div class="pills"><span class="pill">零网络</span><span class="pill">只读</span><span class="pill">本地运行</span></div>
  </main>
  <div class="product"><img src="data:image/png;base64,${hero}" alt="Lectern 产品界面"></div>
</div>`

const browser = await puppeteer.launch({
  executablePath: resolveChrome(),
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
})

try {
  const page = await browser.newPage()
  const render = async (html, width, height, name) => {
    await page.setViewport({ width, height, deviceScaleFactor: 1 })
    await page.setContent(html, { waitUntil: 'load' })
    await page.screenshot({ path: join(OUT, name), type: 'png', omitBackground: false })
  }

  await render(small, 440, 280, 'small-promo-440x280.png')
  await render(marquee, 1400, 560, 'marquee-promo-1400x560.png')
} finally {
  await browser.close()
}

console.log(`Chrome Web Store promo images written to ${OUT}`)

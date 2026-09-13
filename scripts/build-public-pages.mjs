import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import MarkdownIt from 'markdown-it'
import { PROJECT } from './paths.mjs'
const md = new MarkdownIt({ html: false, linkify: true })
export const render = (title, body, lang = 'en') => `<!doctype html><html lang="${lang}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${md.utils.escapeHtml(title)}</title><style>body{font:16px/1.8 system-ui,sans-serif;color:#222b38;max-width:920px;padding:32px 24px 80px;margin:auto}h1{font-size:30px}h2{margin-top:36px}a{color:#185dc7}pre,code{background:#f0f3f6;border-radius:4px}code{padding:2px 4px}pre{padding:16px;overflow:auto}table{border-collapse:collapse;width:100%}td,th{padding:10px;border:1px solid #d6dce5;text-align:left}img{max-width:100%}blockquote{margin:16px 0;padding:4px 20px;border-left:4px solid #e7b74a;background:#fff9ea}</style><main>${md.render(body)}</main></html>`
export function buildPages(out, download = process.env.LECTERN_DOWNLOAD_URL) {
  if (download && new URL(download).protocol !== 'https:') throw new Error('Download must use HTTPS')
  mkdirSync(out, { recursive: true })
  for (const [source, dest, lang] of [['PRIVACY.md','privacy.html','en'],['PRIVACY.zh-CN.md','privacy.zh-CN.html','zh-CN']]) {
    const body = readFileSync(join(PROJECT, source), 'utf8').replaceAll('(PRIVACY.zh-CN.md)', '(privacy.zh-CN.html)').replaceAll('(PRIVACY.md)', '(privacy.html)')
    writeFileSync(join(out, dest), render('Lectern Privacy Policy', body, lang))
  }
  const body = `# Lectern\n\nRead local code in Chrome. Optional AI terminal with a separately installed macOS companion.\n\n在 Chrome 中阅读本地代码；可选安装 macOS 伴随程序，在右侧使用自己的 AI CLI。\n\n${download ? `[Download Lectern Companion / 下载伴随程序](${download})` : '**The companion release download is not available on this page yet. / 本页尚未提供正式伴随程序下载。**'}\n\nRequires macOS 13.5+ and Google Chrome for the terminal. Choose the installer matching your Mac chip. Your CLI must be installed and authenticated separately. CLI commands can modify files and contact your configured model provider.\n\n[Privacy policy](privacy.html) · [隐私政策](privacy.zh-CN.html) · [Source](https://github.com/zhurudong/lectern) · [Support](https://github.com/zhurudong/lectern/issues)`
  writeFileSync(join(out, 'index.html'), render('Lectern', body))
  writeFileSync(join(out, '.nojekyll'), '')
}
if (process.argv[1]?.endsWith('build-public-pages.mjs')) buildPages(join(PROJECT, 'release-artifacts', 'public-site'))

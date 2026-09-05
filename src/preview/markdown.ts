import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'
import { highlightCode, classHighlighter } from '@lezer/highlight'
import { t } from '../i18n'
import { languageParser, normalizeFenceLang } from './languages'
import { resolveFile } from '../lib/resolve'

// Markdown 渲染管线(design.md D3 + 评审提出的实现期注意事项):
//   markdown-it 渲染 → DOMPurify 净化 → 相对资源重写(img/a)
// 重写必须放在净化之后:blob: objectURL 与 data-cv-path 标记都是净化后才写入 DOM,
// 不经过 DOMPurify 的 URI 过滤,避免被净化器剥掉(同时净化配置也显式放行 blob:,双保险)。

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

const md: MarkdownIt = new MarkdownIt({
  html: true, // 原始 HTML 交给 DOMPurify 净化
  linkify: true,
  highlight: (code, lang) => {
    const id = normalizeFenceLang(lang)
    const parser = id ? languageParser(id) : null
    if (!parser) return '' // 返回空串 → markdown-it 自行转义为纯文本代码块
    try {
      let out = ''
      highlightCode(
        code,
        parser.parse(code),
        classHighlighter,
        (text, classes) => {
          const esc = escapeHtml(text)
          out += classes ? `<span class="${classes}">${esc}</span>` : esc
        },
        () => {
          out += '\n'
        },
      )
      return `<pre class="md-code"><code>${out}</code></pre>`
    } catch {
      return ''
    }
  },
})

// 给标题元素打上源码行号:富文本视图没有"行"的概念,大纲定位要靠它把
// "源码第 N 行" 映射回渲染后的元素(file-preview spec「按行定位与高亮」的非行式通道)。
// token.map[0] 是该 block 的源码起始行(0-based),与大纲抽取的 1-based 行号差 1。
// ⚠️ 签名必须是完整的五参数 `(tokens, idx, options, env, self)`。
// 写成四参数时第四个拿到的其实是 `env`,`self.renderToken` 运行时直接抛;
// 而 **TypeScript 不会报错** —— 该参数类型是 any,类型检查照样绿。
// 凡是类型退化成 any 的位置,tsc 给的是虚假的安全感。
md.renderer.rules.heading_open = (tokens, idx, options, _env, self) => {
  const map = tokens[idx].map
  if (map) tokens[idx].attrSet('data-cv-line', String(map[0] + 1))
  return self.renderToken(tokens, idx, options)
}

const PURIFY_CONFIG = {
  USE_PROFILES: { html: true },
  // 默认基础上放行 blob:(本地 objectURL)——重写在净化之后执行,此处为双保险
  ALLOWED_URI_REGEXP:
    /^(?:(?:https?|mailto|tel|blob|data):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
  FORBID_TAGS: ['style', 'form', 'input', 'button', 'select', 'textarea'],
  ADD_ATTR: ['data-cv-path', 'data-cv-line'],
}

export interface MdContext {
  /** 项目根句柄;单文件模式为 null */
  root: FileSystemDirectoryHandle | null
  /** 当前 Markdown 文件所在目录(相对根的路径段) */
  baseDir: string[]
}

export interface RenderedMarkdown {
  html: string
  /** 本次渲染创建的 objectURL,由调用方在替换/卸载时统一释放 */
  objectUrls: string[]
}

function replaceWithPlaceholder(img: HTMLImageElement, reason: string): void {
  const span = img.ownerDocument.createElement('span')
  span.className = 'md-img-placeholder'
  const alt = img.getAttribute('alt')
  span.textContent = `🖼 ${alt || img.getAttribute('src') || t('md.imageAlt')}`
  span.title = reason
  img.replaceWith(span)
}

function markDeadLink(a: HTMLAnchorElement): void {
  a.removeAttribute('href')
  a.classList.add('md-link-dead')
  a.title = t('md.linkUnresolved')
}

/** 是否带协议(含 // 开头的协议相对地址) */
function hasScheme(url: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//')
}

/**
 * 渲染 + 净化 + 相对资源重写。
 * - 相对图片:经目录句柄解析成功 → objectURL;失败/无目录上下文 → 占位符。
 * - 远程图片:一律占位符(零网络边界)。data: URI 属本地内容,保留。
 * - 相对链接:解析成功 → 打 data-cv-path 标记(点击在查看器内打开);失败 → 置灰。
 * - 外部链接:新标签页打开,加 rel 防护。
 */
export async function renderMarkdown(text: string, ctx: MdContext): Promise<RenderedMarkdown> {
  const clean = DOMPurify.sanitize(md.render(text), PURIFY_CONFIG)
  const doc = new DOMParser().parseFromString(`<div id="cv-md-root">${clean}</div>`, 'text/html')
  const container = doc.getElementById('cv-md-root')!
  const objectUrls: string[] = []

  for (const img of Array.from(container.querySelectorAll('img'))) {
    const src = img.getAttribute('src') ?? ''
    if (!src) {
      replaceWithPlaceholder(img, t('md.imgNoSrc'))
      continue
    }
    if (/^data:/i.test(src)) continue // 内联本地内容,保留
    if (hasScheme(src)) {
      replaceWithPlaceholder(img, t('md.imgRemote'))
      continue
    }
    if (!ctx.root) {
      replaceWithPlaceholder(img, t('md.imgNoContext'))
      continue
    }
    const resolved = await resolveFile(ctx.root, ctx.baseDir, src)
    if (!resolved) {
      replaceWithPlaceholder(img, t('md.imgRelUnresolved'))
      continue
    }
    try {
      const file = await resolved.handle.getFile()
      const url = URL.createObjectURL(file)
      objectUrls.push(url)
      img.setAttribute('src', url)
    } catch {
      replaceWithPlaceholder(img, t('md.imgReadFailed'))
    }
  }

  for (const a of Array.from(container.querySelectorAll('a'))) {
    const href = a.getAttribute('href') ?? ''
    if (!href || href.startsWith('#')) continue // 页内锚点保持默认
    if (hasScheme(href)) {
      // 外部链接:允许用户主动点击,新标签页打开
      a.setAttribute('target', '_blank')
      a.setAttribute('rel', 'noopener noreferrer')
      continue
    }
    if (!ctx.root) {
      markDeadLink(a)
      continue
    }
    const resolved = await resolveFile(ctx.root, ctx.baseDir, href)
    if (resolved) {
      a.setAttribute('data-cv-path', resolved.path.join('/'))
      a.removeAttribute('href')
      a.classList.add('md-link-internal')
    } else {
      markDeadLink(a)
    }
  }

  return { html: container.innerHTML, objectUrls }
}

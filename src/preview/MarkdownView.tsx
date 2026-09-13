import { useEffect, useRef, useState } from 'preact/hooks'
import { t } from '../i18n'
import { rootHandle, selectFile, targetLine } from '../state'
import { revealPath } from '../tree/treeStore'
import { resolveFile } from '../lib/resolve'
import { renderMarkdown } from './markdown'
import { CodeView } from './CodeView'

// Markdown 双视图(file-preview spec):默认富文本渲染,可切换到带高亮的源码视图。
//
// 按行定位在两个通道里机制不同、契约只有一份(file-preview spec「按行定位与高亮」):
// 源码视图有"行",由 CodeView 处理;**富文本视图没有行**,就定位到该源码行对应的
// 渲染元素(渲染时给标题打了 data-cv-line),MUST NOT 因为"渲染视图没有行"而静默不动作。

/** 落点标识持续时间,与 CodeView 的行高亮一致 */
const HIGHLIGHT_MS = 1600

export function MarkdownView({ text, path }: { text: string; path: string[] }) {
  const [view, setView] = useState<'rendered' | 'source'>('rendered')
  const [html, setHtml] = useState<string | null>(null)
  const urlsRef = useRef<string[]>([])
  const bodyRef = useRef<HTMLDivElement>(null)
  const root = rootHandle.value
  const target = targetLine.value

  useEffect(() => {
    if (view !== 'rendered') return
    let cancelled = false
    renderMarkdown(text, { root, baseDir: path.slice(0, -1) }).then((res) => {
      if (cancelled) {
        res.objectUrls.forEach((u) => URL.revokeObjectURL(u))
        return
      }
      urlsRef.current.forEach((u) => URL.revokeObjectURL(u))
      urlsRef.current = res.objectUrls
      setHtml(res.html)
    })
    return () => {
      cancelled = true
    }
    // path 变化必然伴随 text 变化(重新读取),依赖 text/view/root 即可
  }, [text, view, root])

  // 富文本视图的按行定位:找 data-cv-line 中"不超过目标行的最近一个"元素
  useEffect(() => {
    if (view !== 'rendered' || !target || html === null) return
    const body = bodyRef.current
    if (!body) return
    const marked = [...body.querySelectorAll<HTMLElement>('[data-cv-line]')]
    if (marked.length === 0) return
    let best: HTMLElement | null = null
    for (const el of marked) {
      const line = Number(el.dataset.cvLine)
      if (Number.isNaN(line) || line > target.line) continue
      best = el
    }
    // 目标行早于第一个标题时,退到第一个可定位元素而不是什么都不做
    const hit = best ?? marked[0]
    hit.scrollIntoView({ block: 'start' })
    hit.classList.add('md-target')
    const timer = setTimeout(() => hit.classList.remove('md-target'), HIGHLIGHT_MS)
    return () => {
      clearTimeout(timer)
      hit.classList.remove('md-target')
    }
  }, [target?.seq, view, html])

  // 卸载时释放本视图创建的所有 objectURL
  useEffect(
    () => () => {
      urlsRef.current.forEach((u) => URL.revokeObjectURL(u))
      urlsRef.current = []
    },
    [],
  )

  const onClick = async (e: MouseEvent) => {
    // 自动打开地址放在片段内，页内链接只滚动内容；不能覆盖文件来源，
    // 否则刷新会丢失文件，恶意片段还可能把来源换成另一个本地地址。
    const anchor = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#"]')
    if (anchor && location.hash.startsWith('#file=')) {
      e.preventDefault()
      const fragment = anchor.getAttribute('href')!.slice(1)
      let id = fragment
      try { id = decodeURIComponent(fragment) } catch { /* 使用原始 ID */ }
      const body = bodyRef.current
      const destination = [...body?.querySelectorAll<HTMLElement>('[id]') ?? []].find((node) => node.id === id)
      if (destination) destination.scrollIntoView({ block: 'start' })
      else if (!id) body?.scrollIntoView({ block: 'start' })
      return
    }
    const target = (e.target as HTMLElement).closest('a[data-cv-path]')
    if (!target || !root) return
    e.preventDefault()
    const pathStr = target.getAttribute('data-cv-path')!
    // 点击时重新解析(文件可能已被外部改动),失败则静默——预览层会在读取时给出错误
    const resolved = await resolveFile(root, [], pathStr)
    if (resolved) {
      selectFile(resolved.handle, resolved.path)
      void revealPath(resolved.path)
    }
  }

  return (
    <>
      <div class="md-toolbar">
        <button class={view === 'rendered' ? 'active' : ''} onClick={() => setView('rendered')}>
          {t('mdview.tabRendered')}
        </button>
        <button class={view === 'source' ? 'active' : ''} onClick={() => setView('source')}>
          {t('mdview.tabSource')}
        </button>
      </div>
      {view === 'source' ? (
        <CodeView text={text} language="markdown" />
      ) : html === null ? (
        <div class="preview-placeholder">{t('mdview.rendering')}</div>
      ) : (
        <div
          class="markdown-body"
          ref={bodyRef}
          onClick={(e) => void onClick(e as unknown as MouseEvent)}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </>
  )
}

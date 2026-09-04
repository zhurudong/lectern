import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { getChunks, goToNextChunk, goToPreviousChunk, unifiedMergeView } from '@codemirror/merge'
import { useEffect, useRef, useState } from 'preact/hooks'
import { identifyByName, looksBinary } from '../lib/filetypes'
import { KEYS, display } from '../lib/keys'
import { appTheme } from '../preview/cmTheme'
import { languageExtension } from '../preview/languages'
import { theme } from '../theme'
import type { ChangedFile, LoadedContentSide, LoadedFilePair, LoadedFileSide } from './protocol'

interface UnifiedDiffProps {
  file: ChangedFile
  pair: LoadedFilePair | null
  loading: boolean
  error?: string
}

function content(side: LoadedFileSide): side is LoadedContentSide {
  return side.kind === 'content'
}

function textFor(side: LoadedFileSide): string {
  return content(side) ? new TextDecoder().decode(side.bytes) : ''
}

function metadataReason(side: LoadedFileSide): string | null {
  if (side.kind === 'content' || side.reason === 'absent') return null
  if (side.reason === 'gitlink') return 'Git 子模块指针仅展示元数据'
  if (side.reason === 'over-5-mb') return '文件超过 5 MB 文本差异上限'
  return '当前内容不可读取'
}

function metadataOnly(file: ChangedFile, pair: LoadedFilePair): string | null {
  const sideReason = metadataReason(pair.old) ?? metadataReason(pair.new)
  if (sideReason) return sideReason
  const oldKind = file.old?.objectKind
  const newKind = file.new?.objectKind === 'regular-observed' ? 'regular' : file.new?.objectKind
  if (oldKind && newKind && oldKind !== newKind) return `对象类型变化：${oldKind} → ${newKind}`
  if (file.old && file.new && file.old.source === 'git' && file.new.source === 'git' && file.old.oid === file.new.oid && file.old.mode !== file.new.mode) {
    return `仅文件模式变化：${file.old.mode} → ${file.new.mode}`
  }
  if ((content(pair.old) && looksBinary(pair.old.bytes.subarray(0, 8192))) ||
      (content(pair.new) && looksBinary(pair.new.bytes.subarray(0, 8192)))) return '二进制内容不生成文本差异'
  return null
}

function size(side: LoadedFileSide): string {
  if (side.kind === 'content') return `${side.size.toLocaleString()} B`
  return side.size == null ? '—' : `${side.size.toLocaleString()} B`
}

export function UnifiedDiff({ file, pair, loading, error }: UnifiedDiffProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const [hunks, setHunks] = useState({ current: 0, total: 0, approximate: false })
  const currentTheme = theme.value
  const reason = pair ? metadataOnly(file, pair) : null

  const syncHunks = (view: EditorView) => {
    const data = getChunks(view.state)
    if (!data || data.chunks.length === 0) {
      setHunks({ current: 0, total: 0, approximate: false })
      return
    }
    const head = view.state.selection.main.head
    let index = data.chunks.findIndex((chunk) => head <= chunk.endB)
    if (index < 0) index = data.chunks.length - 1
    setHunks({
      current: index + 1,
      total: data.chunks.length,
      approximate: data.chunks.some((chunk) => chunk.precise === false),
    })
  }

  useEffect(() => {
    const host = hostRef.current
    viewRef.current?.destroy()
    viewRef.current = null
    setHunks({ current: 0, total: 0, approximate: false })
    if (!host || !pair || reason) return
    const oldText = textFor(pair.old)
    const newText = textFor(pair.new)
    const languageName = file.status === 'D' ? file.path : file.path
    const language = identifyByName(languageName)?.language
    let view: EditorView
    view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: newText,
        extensions: [
          EditorState.readOnly.of(true),
          appTheme(currentTheme),
          languageExtension(language),
          unifiedMergeView({
            original: oldText,
            mergeControls: false,
            gutter: true,
            highlightChanges: true,
            allowInlineDiffs: false,
            collapseUnchanged: { margin: 4, minSize: 10 },
            diffConfig: { timeout: 900 },
          }),
          keymap.of([
            { key: KEYS.previousHunk.key!, run: (target) => goToPreviousChunk(target) },
            { key: KEYS.nextHunk.key!, run: (target) => goToNextChunk(target) },
          ]),
          EditorView.updateListener.of((update) => {
            if (update.selectionSet || update.docChanged) syncHunks(update.view)
          }),
        ],
      }),
    })
    viewRef.current = view
    const data = getChunks(view.state)
    if (data?.chunks.length) {
      const first = data.chunks[0]
      view.dispatch({
        selection: { anchor: Math.min(first.fromB, view.state.doc.length) },
        effects: EditorView.scrollIntoView(Math.min(first.fromB, view.state.doc.length), { y: 'center' }),
      })
    }
    syncHunks(view)
    return () => {
      view.destroy()
      if (viewRef.current === view) viewRef.current = null
    }
  }, [pair, reason, file.path, currentTheme])

  const move = (direction: 'previous' | 'next') => {
    const view = viewRef.current
    if (!view) return
    const moved = direction === 'next' ? goToNextChunk(view) : goToPreviousChunk(view)
    if (moved) syncHunks(view)
    view.focus()
  }

  if (loading) return <div class="git-diff-state" role="status">正在读取文件差异…</div>
  if (error) return <div class="git-diff-state git-diff-state-error" role="alert">{error}</div>
  if (!pair) return <div class="git-diff-state">选择一个变更文件查看差异</div>
  if (reason) {
    return (
      <div class="git-metadata-view" data-diff-kind="metadata">
        <div class="git-metadata-mark" aria-hidden="true">◇</div>
        <h2>此文件只展示事实元数据</h2>
        <p>{reason}</p>
        <dl>
          <div><dt>旧侧</dt><dd>{size(pair.old)} · {pair.old.oid ? pair.old.oid.slice(0, 12) : '不存在'}</dd></div>
          <div><dt>新侧</dt><dd>{size(pair.new)} · {pair.new.oid ? pair.new.oid.slice(0, 12) : '不存在'}</dd></div>
        </dl>
      </div>
    )
  }

  return (
    <div class="git-diff-stack" data-diff-kind="text">
      <div class="git-hunk-toolbar">
        {hunks.approximate && <span class="git-approx-warning" role="status">近似结果，可能遗漏细节</span>}
        <span class="spacer" />
        <span aria-live="polite">{hunks.total ? `${hunks.current} / ${hunks.total} 处差异` : '无行级差异'}</span>
        <button type="button" onClick={() => move('previous')} title={`上一处（${display('previousHunk')}）`} disabled={!hunks.total}>↑</button>
        <button type="button" onClick={() => move('next')} title={`下一处（${display('nextHunk')}）`} disabled={!hunks.total}>↓</button>
      </div>
      <div class="git-cm-host" ref={hostRef} aria-label={`${file.path} 只读统一差异`} />
    </div>
  )
}

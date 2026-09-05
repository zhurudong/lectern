import { useEffect } from 'preact/hooks'
import { t } from '../i18n'
import { navigateWithHistory } from '../intel/navStack'
import { useOverlayKeyboard } from '../lib/useOverlayKeyboard'
import type { GrepHit } from '../intel/symbolWorker'
import {
  CONTENT_LIMIT, MIN_QUERY, cancelContentSearch, caseSensitive, closeContentSearch,
  contentHits, contentQuery, contentScanned, contentStatus, contentTotal, toggleCaseSensitive,
} from './contentStore'

// 全文搜索结果面板(content-search spec):按文件分组、行号 + 行片段 + 命中位置标出、
// 点击直达行;展示扫描进度与结束状态,并提供手动停止。

function groupByFile(hits: GrepHit[]): { path: string; partial: boolean; items: GrepHit[] }[] {
  const map = new Map<string, GrepHit[]>()
  for (const h of hits) {
    const list = map.get(h.path)
    if (list) list.push(h)
    else map.set(h.path, [h])
  }
  return [...map].map(([path, items]) => ({ path, partial: items[0]?.partial ?? false, items }))
}

function statusText(): string {
  switch (contentStatus.value) {
    case 'too-short': return t('content.tooShort', { n: MIN_QUERY })
    case 'scanning': return t('content.scanning', { scanned: contentScanned.value, total: contentTotal.value })
    case 'done': return t('content.done', { n: contentScanned.value })
    case 'cancelled': return t('content.cancelled')
    case 'truncated': return t('content.truncated', { limit: CONTENT_LIMIT })
    default: return ''
  }
}

export function ContentPanel() {
  const hits = contentHits.value
  const groups = groupByFile(hits)
  const scanning = contentStatus.value === 'scanning'
  const tooShort = contentStatus.value === 'too-short'
  const q = contentQuery.value

  // 4.2:全文结果面板与引用面板是**同一个形状**(`<div class="ref-row">` + onClick,
  // 键盘够不着),所以并进本 change 一起修 —— 同一形状不该分两次发现、两次修。
  const flat = groups.flatMap((g) => g.items)
  const kb = useOverlayKeyboard({
    open: true,
    count: flat.length,
    idPrefix: 'cv-content',
    onActivate: (i) => {
      const h = flat[i]
      if (h) void navigateWithHistory(h.path, h.line, undefined, { col: h.col })
    },
    onClose: closeContentSearch,
  })
  // 面板保持打开、只是换了一次查询(⇧⌘F 再按一次)时不会重新挂载,
  // `useOverlayKeyboard` 挂载时的 `setSelected(0)` 不会再跑一遍 ——
  // 不重置的话,新结果会从上一次查询残留的下标开始高亮,跟"新结果"对不上。
  useEffect(() => {
    kb.setSelected(0)
  }, [q])
  let flatIndex = -1

  return (
    <div class="ref-panel content-panel">
      <div class="ref-header">
        <span class="ref-title">
          {t('content.title', { q, hits: hits.length, files: groups.length })}
        </span>
        <span class={`ref-status${contentStatus.value === 'truncated' || tooShort ? ' ref-status-warn' : ''}`}>
          {statusText()}
        </span>
        <span class="spacer" />
        <label class="case-toggle" title={t('content.caseSensitive')}>
          <input type="checkbox" checked={caseSensitive.value} onChange={toggleCaseSensitive} />
          Aa
        </label>
        {scanning && (
          <button class="ref-btn" title={t('content.stop')} onClick={() => cancelContentSearch(true)}>
            {t('content.stopBtn')}
          </button>
        )}
        <button class="ref-btn" title={t('content.close')} onClick={kb.close}>
          ✕
        </button>
      </div>
      <div
        class="ref-body"
        tabIndex={-1}
        ref={kb.containerRef}
        role="listbox"
        aria-label={t('content.resultsLabel')}
        aria-activedescendant={kb.activeId}
        onKeyDown={(e) => {
          const ke = e as unknown as KeyboardEvent
          // 键盘环的另一半:输入框按 ↓ 能进结果列表(见 SearchBox.onInputKey),
          // 结果首行(selected===0)再按 ↑ 就该退回去,不然只能进不能退,
          // 退回去还得靠鼠标点输入框。首行以外的 ↑ 仍走通用的"移动选中项"。
          // content-search spec 待补 Scenario:结果首行 ↑ 返回搜索输入框。
          if (ke.key === 'ArrowUp' && kb.selected === 0) {
            ke.preventDefault()
            document.querySelector<HTMLInputElement>('.search-input')?.focus()
            return
          }
          kb.onKeyDown(ke)
        }}
      >
        {tooShort ? (
          <div class="ref-empty">{t('content.tooShortEmpty')}</div>
        ) : hits.length === 0 ? (
          <div class="ref-empty">{scanning ? t('content.scanningShort') : t('content.noMatch')}</div>
        ) : (
          groups.map((g) => (
            <div key={g.path} class="ref-group">
              <div class="ref-file">
                {g.path} <span class="ref-count">{g.items.length}</span>
                {g.partial && <span class="ref-partial">{t('content.filePartial')}</span>}
              </div>
              {g.items.map((h, i) => {
                flatIndex += 1
                const idx = flatIndex
                return (
                <div
                  key={`${h.line}-${h.col}-${i}`}
                  id={`cv-content-${idx}`}
                  role="option"
                  aria-selected={kb.selected === idx}
                  class={`ref-row${kb.selected === idx ? ' selected' : ''}`}
                  onClick={() => void navigateWithHistory(h.path, h.line, undefined, { col: h.col })}
                >
                  <span class="ref-line">{h.line}</span>
                  <span class="ref-text">
                    {h.text.slice(0, h.col)}
                    <mark class="ref-mark">{h.text.slice(h.col, h.col + q.length)}</mark>
                    {h.text.slice(h.col + q.length)}
                  </span>
                </div>
                )
              })}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

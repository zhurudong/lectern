import { closeReferences, cancelReferences, refHits, refName, refStatus, REF_LIMIT } from './references'
import { navigateWithHistory } from './navStack'
import type { RefHit } from './symbolWorker'
import { useOverlayKeyboard } from '../lib/useOverlayKeyboard'

// 查找引用结果面板(code-intelligence spec「查找引用」):
// 预览区下方抽屉,按文件分组、行号 + 行片段 + 命中高亮,点击直达行。
// 面板必须明示"结果基于名称匹配,可能包含同名但无关的位置" —— 精度边界不能藏在文档角落。

function groupByFile(hits: RefHit[]): { path: string; items: RefHit[] }[] {
  const map = new Map<string, RefHit[]>()
  for (const h of hits) {
    const list = map.get(h.path)
    if (list) list.push(h)
    else map.set(h.path, [h])
  }
  return [...map].map(([path, items]) => ({ path, items }))
}

function statusText(): string {
  switch (refStatus.value) {
    case 'scanning': return '扫描中…'
    case 'done': return '扫描完成'
    case 'truncated': return `已达上限 ${REF_LIMIT} 条,结果已截断`
    case 'cancelled': return '已取消'
    default: return ''
  }
}

export function ReferencePanel() {
  const hits = refHits.value
  const groups = groupByFile(hits)
  const scanning = refStatus.value === 'scanning'

  // 键盘可达(3.1–3.3)。**下标建在展平后的顺序上,不是每组各数一套** ——
  // 这样 ↑↓ 跨文件分组时是连续的,不会在组边界卡住(3.3)。
  // 展平顺序必须与渲染顺序一致:两者都按 groups → items 走。
  const flat = groups.flatMap((g) => g.items)
  const kb = useOverlayKeyboard({
    open: true,
    count: flat.length,
    idPrefix: 'cv-ref',
    onActivate: (i) => {
      const h = flat[i]
      // 引用命中自带列号 —— 比按符号名再找一次更准(同一行可能出现多次)
      if (h) void navigateWithHistory(h.path, h.line, undefined, { col: h.col })
    },
    onClose: closeReferences,
  })
  // 展平下标 → 渲染时能查到的映射(渲染是嵌套的,拿不到全局序号)
  let flatIndex = -1

  return (
    <div class="ref-panel">
      <div class="ref-header">
        <span class="ref-title">
          “{refName.value}” 的引用 · {hits.length} 处 / {groups.length} 个文件
        </span>
        <span class={`ref-status${refStatus.value === 'truncated' ? ' ref-status-warn' : ''}`}>
          {statusText()}
        </span>
        <span class="spacer" />
        {scanning && (
          <button class="ref-btn" title="停止扫描" onClick={() => cancelReferences(true)}>
            停止
          </button>
        )}
        <button class="ref-btn" title="关闭引用面板" onClick={kb.close}>
          ✕
        </button>
      </div>
      <div class="ref-hint">
        结果基于名称匹配,可能包含同名但无关的位置;注释与字符串字面量中的同名文本已排除。
      </div>
      <div
        class="ref-body"
        tabIndex={-1}
        ref={kb.containerRef}
        role="listbox"
        aria-label="引用结果"
        aria-activedescendant={kb.activeId}
        onKeyDown={(e) => kb.onKeyDown(e as unknown as KeyboardEvent)}
      >
        {hits.length === 0 ? (
          <div class="ref-empty">{scanning ? '扫描中…' : '未找到引用'}</div>
        ) : (
          groups.map((g) => (
            <div key={g.path} class="ref-group">
              <div class="ref-file">
                {g.path} <span class="ref-count">{g.items.length}</span>
              </div>
              {g.items.map((h, i) => {
                flatIndex += 1
                const idx = flatIndex
                return (
                <div
                  key={`${h.line}-${h.col}-${i}`}
                  id={`cv-ref-${idx}`}
                  role="option"
                  aria-selected={kb.selected === idx}
                  class={`ref-row${kb.selected === idx ? ' selected' : ''}`}
                  onClick={() => void navigateWithHistory(h.path, h.line, undefined, { col: h.col })}
                >
                  <span class="ref-line">{h.line}</span>
                  <span class="ref-text">
                    {h.text.slice(0, h.col)}
                    <mark class="ref-mark">{h.text.slice(h.col, h.col + refName.value.length)}</mark>
                    {h.text.slice(h.col + refName.value.length)}
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

import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { mode, selectedFile } from '../state'
import { searchFiles, indexing, indexPaths } from '../search/searchStore'
import {
  comparePickerOpen,
  comparePickerNotice,
  closeComparePicker,
  chooseCompareTarget,
} from './compareStore'

// 对比目标选择器(design.md D1 / spec「选择对比目标不请求新授权」/ task 2.1-2.4)。
//
// **只从当前项目内检索选取**,复用既有的文件名索引(searchStore.searchFiles)——
// 与 ⌘K 同一份数据源。**MUST NOT 调 showOpenFilePicker 另开系统对话框**(task 2.2/2.3):
// 系统对话框自动化驱不动,主动线一旦建在它上面这个功能就永久只能靠人验;
// 且另开会拿到项目之外的新句柄,多一个授权面。
//
// 单文件模式没有项目树 → 没有可选的对比目标,给"说得出原因"的缺席(D5 / task 2.4)。

export function ComparePicker() {
  const open = comparePickerOpen.value
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const notice = comparePickerNotice.value
  const m = mode.value
  const sel = selectedFile.value

  // 打开时清空上次查询并聚焦输入框
  useEffect(() => {
    if (open) {
      setQuery('')
      setActive(0)
      // 下一帧输入框才在 DOM 里
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  const paths = indexPaths.value
  const curPath = sel ? sel.path.join('/') : ''
  const results = useMemo(() => {
    if (m !== 'project') return []
    // 当前文件本身排除在候选之外(与自身对比没有意义;真选到了也会被 chooseCompareTarget 拦下)
    return searchFiles(query, 50).filter((p) => p !== curPath)
  }, [query, paths, m, curPath])

  useEffect(() => setActive(0), [query])

  if (!open) return null

  const pick = (path: string) => {
    void chooseCompareTarget(path)
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      closeComparePicker()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const t = results[active]
      if (t) pick(t)
    }
  }

  return (
    <div class="compare-picker-backdrop" onClick={closeComparePicker}>
      <div
        class="compare-picker"
        role="dialog"
        aria-label="选择对比目标"
        onClick={(e) => e.stopPropagation()}
      >
        <div class="compare-picker-header">
          <span class="compare-picker-title">选择要与当前文件对比的另一个文件</span>
          <button class="compare-picker-close" title="关闭" onClick={closeComparePicker}>
            ✕
          </button>
        </div>

        {m !== 'project' ? (
          // 单文件模式:可解释地缺席(task 2.4 / 5.1),不是报错也不是点了没反应的入口
          <div class="compare-picker-empty">
            文件对比需要先打开一个<b>项目(文件夹)</b>才能选取对比目标。
            当前是单文件模式,没有项目树,因而没有可选的另一个文件。
          </div>
        ) : (
          <>
            <input
              ref={inputRef}
              class="search-input compare-picker-input"
              type="text"
              placeholder="按文件名搜索项目内的文件"
              value={query}
              onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)}
              onKeyDown={onKey}
            />
            {notice && <div class="compare-picker-notice">{notice}</div>}
            <div class="compare-picker-results">
              {query.trim() === '' ? (
                <div class="search-status">输入文件名开始搜索</div>
              ) : results.length === 0 ? (
                <div class="search-status">
                  {indexing.value ? '暂无匹配(索引仍在构建)' : '无匹配文件'}
                </div>
              ) : (
                results.map((path, i) => {
                  const name = path.slice(path.lastIndexOf('/') + 1)
                  const dir = path.slice(0, path.lastIndexOf('/') + 1)
                  return (
                    <div
                      key={path}
                      class={`search-result${i === active ? ' active' : ''}`}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        pick(path)
                      }}
                      onMouseEnter={() => setActive(i)}
                    >
                      <span class="result-name">{name}</span>
                      {dir && <span class="result-dir">{dir}</span>}
                    </div>
                  )
                })
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

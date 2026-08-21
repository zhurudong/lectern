import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { rootHandle, navigateTo } from '../state'
import { revealPath } from '../tree/treeStore'
import { resolveFile } from '../lib/resolve'
import { navigateWithHistory } from '../intel/navStack'
import { focusEditorWhenReady } from '../lib/focusEditor'
import { verifiedShortcuts } from '../lib/platform'
import { searchSymbols, indexState, indexedFiles, indexVersion, type SymbolHit } from '../intel/indexStore'
import { KIND_BADGE, KIND_LABEL } from '../intel/symbols'
import { searchFiles, indexing, indexDone, indexPaths } from './searchStore'
import { closeContentSearch, runContentSearch } from './contentStore'

// 顶部搜索面板(file-tree spec「文件名快速搜索」+ code-intelligence spec「全局符号搜索」)。
//
// **模式切换是不依赖快捷键的界面入口**(spec「入口可达性不依赖浏览器保留键」):
// 点"文件名"/"符号"即可切换,两种模式的搜索范围互不改变 —— ⌘K 恒为仅文件名。
// 快捷键只是便捷层:⌘K 保留(已验证可 preventDefault),⌘⇧O 仅在 macOS 绑定与提示,
// Windows/Linux 的 Ctrl+Shift+O 是 Chrome 书签管理器保留键,按保守假定不绑定、不提示。

export type SearchMode = 'file' | 'symbol' | 'content'

/** 全文搜索按输入去抖触发,避免每敲一个字就扫全项目 */
const CONTENT_DEBOUNCE_MS = 250

export function SearchBox() {
  const [searchMode, setSearchMode] = useState<SearchMode>('file')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const macKeys = verifiedShortcuts()

  const focusInput = (next: SearchMode) => {
    setSearchMode(next)
    setOpen(true)
    // 输入框在所有模式下都常驻(只有下拉内容随模式变),可以同步取焦点
    inputRef.current?.focus()
    inputRef.current?.select()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // ⌘K / Ctrl+K:恒定切到"文件名"模式(spec 要求其范围 MUST 保持为仅文件名)
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        focusInput('file')
        return
      }
      // ⌘⇧O / ⌘⇧F:仅 macOS 绑定(Mac 的书签管理器是 ⌥⌘B,页内查找是 ⌘F);其他平台不绑定
      if (macKeys && e.metaKey && e.shiftKey && e.code === 'KeyO') {
        e.preventDefault()
        focusInput('symbol')
      } else if (macKeys && e.metaKey && e.shiftKey && e.code === 'KeyF') {
        e.preventDefault()
        focusInput('content')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [macKeys])

  // 订阅索引进度信号:增量到达时结果实时补全
  const paths = indexPaths.value
  const symVersion = indexVersion.value
  const fileResults = useMemo(
    () => (searchMode === 'file' ? searchFiles(query) : []),
    [query, paths, searchMode],
  )
  const symbolResults = useMemo(
    () => (searchMode === 'symbol' ? searchSymbols(query) : []),
    [query, symVersion, searchMode],
  )
  const count = searchMode === 'file' ? fileResults.length : searchMode === 'symbol' ? symbolResults.length : 0

  useEffect(() => setActive(0), [query, searchMode])

  // 全文搜索:输入去抖后触发;离开该模式即关闭面板并取消在途扫描
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (searchMode !== 'content') return
    if (query.trim() === '') return
    debounceRef.current = setTimeout(() => runContentSearch(query), CONTENT_DEBOUNCE_MS)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, searchMode])

  useEffect(() => {
    if (searchMode !== 'content') closeContentSearch()
  }, [searchMode])

  const openPath = async (path: string, line?: number, word?: string) => {
    const root = rootHandle.value
    if (!root) return
    setOpen(false)
    setQuery('')
    inputRef.current?.blur()
    // 符号搜索是导航入口之一,须统一入栈(任务 6.9);
    // 文件名搜索只是"打开文件",不带行号,走既有通道即可。
    if (line != null) {
      // 符号搜索知道自己搜的是哪个符号 —— 把它传下去,caret 才会停在符号上,
      // 而不是停在行首(那样紧接着按 ⌘⇧↩ 会查到一个无关的词)
      await navigateWithHistory(path, line, undefined, { word })
      // 1.1:导航完成后**把焦点交给代码区**。
      // 上面那句 `inputRef.current?.blur()` 主动放掉了焦点,而在此之前
      // **没有任何人接管** —— 于是焦点落到 body,用户跳过去了却按不动光标,
      // 也按不了 ⌘⇧↩(按键根本进不了编辑器)。
      focusEditorWhenReady()
      return
    }
    const resolved = await resolveFile(root, [], path)
    if (resolved) {
      navigateTo(resolved.handle, resolved.path, line)
      void revealPath(resolved.path)
      // 1.2:文件名搜索(不带行号那条分支)同样 blur 过,同样要交接
      focusEditorWhenReady()
    }
  }

  const openActive = () => {
    if (searchMode === 'file') {
      const target = fileResults[active]
      if (target) void openPath(target)
    } else {
      const target = symbolResults[active]
      if (target) void openPath(target.path, target.line, target.name)
    }
  }

  const onInputKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, count - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      // 全文模式没有下拉列表,Enter 表示"立即执行本次查询"(不等去抖)
      if (searchMode === 'content') runContentSearch(query)
      else openActive()
    } else if (e.key === 'Escape') {
      setOpen(false)
      inputRef.current?.blur()
    }
  }

  // 全文搜索的结果在下方抽屉里展示,不用下拉
  const showDropdown = open && query.trim() !== '' && searchMode !== 'content'
  const placeholder =
    searchMode === 'file'
      ? '搜索文件名(⌘K / Ctrl+K)'
      : searchMode === 'symbol'
        ? (macKeys ? '搜索符号(⌘⇧O)' : '搜索符号')
        : (macKeys ? '搜索文件内容(⌘⇧F)' : '搜索文件内容')

  return (
    <div class="search-wrap">
      <div class="search-modes" role="tablist">
        <button
          class={`search-mode${searchMode === 'file' ? ' active' : ''}`}
          title="按文件名搜索(不含文件内容)"
          onClick={() => focusInput('file')}
        >
          文件名
        </button>
        <button
          class={`search-mode${searchMode === 'symbol' ? ' active' : ''}`}
          title="按符号名搜索项目内的类型、函数、方法与常量"
          onClick={() => focusInput('symbol')}
        >
          符号
        </button>
        <button
          class={`search-mode${searchMode === 'content' ? ' active' : ''}`}
          title="在项目内所有文本文件的正文中搜索"
          onClick={() => focusInput('content')}
        >
          全文
        </button>
      </div>
      <input
        ref={inputRef}
        class="search-input"
        type="text"
        placeholder={placeholder}
        value={query}
        onInput={(e) => {
          setQuery((e.currentTarget as HTMLInputElement).value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        // 点击模式切换按钮会先让输入框 blur,随后 focusInput 又把焦点取回来;
        // 延时到点若焦点已回到输入框就不关闭下拉,否则切模式会把结果面板关掉。
        onBlur={() =>
          setTimeout(() => {
            if (document.activeElement !== inputRef.current) setOpen(false)
          }, 150)
        }
        onKeyDown={onInputKey}
      />
      {showDropdown && (
        <div class="search-results">
          {searchMode === 'file' ? (
            <FileResults results={fileResults} active={active} onPick={openPath} onHover={setActive} />
          ) : (
            <SymbolResults results={symbolResults} active={active} onPick={openPath} onHover={setActive} />
          )}
        </div>
      )}
    </div>
  )
}

function FileResults({
  results, active, onPick, onHover,
}: {
  results: string[]
  active: number
  onPick: (path: string) => void
  onHover: (i: number) => void
}) {
  if (results.length === 0) {
    return (
      <div class="search-status">
        {indexing.value ? '暂无匹配(索引仍在构建)' : indexDone.value ? '无匹配文件' : '索引未就绪'}
      </div>
    )
  }
  return (
    <>
      {indexing.value && (
        <div class="search-status">
          索引构建中…已索引 {indexPaths.value.length} 个文件,以下为部分结果
        </div>
      )}
      {results.map((path, i) => {
        const name = path.slice(path.lastIndexOf('/') + 1)
        const dir = path.slice(0, path.lastIndexOf('/') + 1)
        return (
          <div
            key={path}
            class={`search-result${i === active ? ' active' : ''}`}
            // mousedown 早于 input blur,避免下拉先关闭导致点击丢失
            onMouseDown={(e) => {
              e.preventDefault()
              onPick(path)
            }}
            onMouseEnter={() => onHover(i)}
          >
            <span class="result-name">{name}</span>
            {dir && <span class="result-dir">{dir}</span>}
          </div>
        )
      })}
    </>
  )
}

function SymbolResults({
  results, active, onPick, onHover,
}: {
  results: SymbolHit[]
  active: number
  // 鼠标与键盘走**同一条** openPath,连符号名一起传 —— 两条路各传各的
  // 就会出现"键盘跳过去 caret 在符号上、鼠标跳过去在行首"这种不一致
  onPick: (path: string, line: number, word?: string) => void
  onHover: (i: number) => void
}) {
  const building = indexState.value === 'building'
  if (results.length === 0) {
    return (
      <div class="search-status">
        {building
          ? `索引构建中…已索引 ${indexedFiles.value} 个文件,暂无匹配符号`
          : indexState.value === 'unavailable'
            ? '符号索引不可用'
            : '无匹配符号'}
      </div>
    )
  }
  return (
    <>
      {building && (
        <div class="search-status">
          索引构建中…已索引 {indexedFiles.value} 个文件,以下为部分结果
        </div>
      )}
      {results.map((s, i) => (
        <div
          key={`${s.path}:${s.line}:${s.name}`}
          class={`search-result${i === active ? ' active' : ''}`}
          onMouseDown={(e) => {
            e.preventDefault()
            onPick(s.path, s.line, s.name)
          }}
          onMouseEnter={() => onHover(i)}
        >
          <span class={`outline-kind kind-${s.kind}`} title={KIND_LABEL[s.kind]}>
            {KIND_BADGE[s.kind]}
          </span>
          <span class="result-name">{s.name}</span>
          {s.container && <span class="result-container">{s.container}</span>}
          <span class="result-dir">
            {s.path}:{s.line}
          </span>
        </div>
      ))}
    </>
  )
}

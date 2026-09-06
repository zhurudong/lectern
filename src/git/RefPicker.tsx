import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { GitRef, GitRefsSnapshot } from './refs'
import type { ImmutableEndpoint, TargetEndpoint } from './protocol'
import type { GitWorkerClient } from './workerClient'

type PickerSide = 'base' | 'target'

interface RefPickerProps {
  side: PickerSide
  refs: GitRefsSnapshot
  client: GitWorkerClient
  selected: ImmutableEndpoint | TargetEndpoint
  onSelect: (endpoint: ImmutableEndpoint | TargetEndpoint) => void
  onClose: () => void
}

function endpointFor(ref: GitRef): ImmutableEndpoint {
  return {
    kind: ref.group === 'local' ? 'branch' : ref.group,
    label: ref.shortName,
    oid: ref.oid,
  }
}

function errorText(error: unknown): string {
  if (typeof error === 'object' && error != null && 'message' in error && typeof error.message === 'string') {
    return error.message
  }
  return 'Commit SHA 无法解析'
}

export function RefPicker({ side, refs, client, selected, onSelect, onClose }: RefPickerProps) {
  const searchRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [sha, setSha] = useState('')
  const [shaState, setShaState] = useState<{ kind: 'idle' | 'loading' | 'error'; message?: string }>({ kind: 'idle' })

  useEffect(() => {
    searchRef.current?.focus()
  }, [])

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    document.addEventListener('keydown', closeOnEscape, true)
    return () => document.removeEventListener('keydown', closeOnEscape, true)
  }, [onClose])

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const filter = (items: GitRef[]) => needle
      ? items.filter((item) => `${item.shortName} ${item.shortOid}`.toLowerCase().includes(needle))
      : items
    return {
      local: filter(refs.groups.local),
      remote: filter(refs.groups.remote.filter((item) => !item.name.endsWith('/HEAD'))),
      tag: filter(refs.groups.tag),
    }
  }, [query, refs])

  const choose = (endpoint: ImmutableEndpoint | TargetEndpoint) => {
    onSelect(endpoint)
    onClose()
  }

  const resolveSha = async () => {
    const input = sha.trim()
    if (!input) return
    if (!/^[0-9a-f]{4,40}$/i.test(input)) {
      setShaState({ kind: 'error', message: 'Commit SHA 必须包含 4–40 位十六进制字符' })
      return
    }
    setShaState({ kind: 'loading' })
    try {
      const payload = await client.resolveCommit(input)
      if (payload.type !== 'resolve-commit-result') throw new Error('Commit SHA 返回了未知结果')
      choose({ kind: 'commit', label: payload.oid.slice(0, 8), oid: payload.oid })
    } catch (error) {
      setShaState({ kind: 'error', message: errorText(error) })
    }
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    if ((event.target as HTMLElement).closest('.git-sha-entry')) return
    const options = [...(panelRef.current?.querySelectorAll<HTMLButtonElement>(
      '.git-ref-option:not([disabled])',
    ) ?? [])]
    if (options.length === 0) return
    event.preventDefault()
    const at = options.indexOf(document.activeElement as HTMLButtonElement)
    const delta = event.key === 'ArrowDown' ? 1 : -1
    const next = at === -1
      ? (event.key === 'ArrowDown' ? 0 : options.length - 1)
      : (at + delta + options.length) % options.length
    options[next].focus()
  }

  const renderGroup = (title: string, items: GitRef[], snapshot = false) => {
    if (items.length === 0) return null
    return (
      <section class="git-ref-group" aria-label={title}>
        <div class="git-ref-group-title">{title}<span>{items.length}</span></div>
        {items.map((item) => {
          const active = selected.kind !== 'worktree' && selected.oid === item.oid && selected.label === item.shortName
          return (
            <button
              type="button"
              class="git-ref-option"
              aria-selected={active}
              role="option"
              onClick={() => choose(endpointFor(item))}
              key={item.name}
            >
              <span class="git-ref-option-name">{item.shortName}</span>
              {snapshot && <span class="git-snapshot-badge">本地快照</span>}
              <span class="git-ref-option-sha">{item.shortOid}</span>
              {active && <span aria-hidden="true">✓</span>}
            </button>
          )
        })}
      </section>
    )
  }

  return (
    <div
      class={`git-ref-picker git-ref-picker-${side}`}
      role="dialog"
      aria-label={`选择${side === 'base' ? '基准' : '目标'}`}
      ref={panelRef}
      onKeyDown={onKeyDown}
    >
      <div class="git-ref-search-wrap">
        <span aria-hidden="true">⌕</span>
        <input
          ref={searchRef}
          class="git-ref-search"
          value={query}
          onInput={(event) => setQuery((event.currentTarget as HTMLInputElement).value)}
          placeholder="搜索分支、Tag 或 SHA"
          aria-label="筛选引用"
        />
        <kbd>Esc</kbd>
      </div>
      <div class="git-ref-options" role="listbox" aria-label="本地 Git 引用">
        <section class="git-ref-group" aria-label="当前工作区">
          <div class="git-ref-group-title">当前工作区<span>1</span></div>
          <button
            type="button"
            class="git-ref-option"
            role="option"
            aria-selected={selected.kind === 'worktree'}
            disabled={side === 'base'}
            title={side === 'base' ? '当前工作区只能作为比较目标' : undefined}
            onClick={() => choose({ kind: 'worktree', label: '当前工作区', headOid: refs.head.oid })}
          >
            <span class="git-ref-option-name">当前工作区</span>
            <span class="git-ref-option-note">HEAD + 磁盘内容</span>
            {selected.kind === 'worktree' && <span aria-hidden="true">✓</span>}
          </button>
        </section>
        {renderGroup('本地分支', groups.local)}
        {renderGroup('远程跟踪分支', groups.remote, true)}
        {renderGroup('Tag', groups.tag)}
        {!query || groups.local.length + groups.remote.length + groups.tag.length > 0 ? null : (
          <div class="git-ref-no-result">没有匹配的引用</div>
        )}
      </div>
      <form
        class="git-sha-entry"
        onSubmit={(event) => {
          event.preventDefault()
          void resolveSha()
        }}
      >
        <label for={`git-sha-${side}`}>输入 Commit SHA</label>
        <div>
          <input
            id={`git-sha-${side}`}
            value={sha}
            onInput={(event) => {
              setSha((event.currentTarget as HTMLInputElement).value)
              setShaState({ kind: 'idle' })
            }}
            placeholder="完整或唯一前缀"
            spellcheck={false}
          />
          <button type="submit" disabled={!sha.trim() || shaState.kind === 'loading'}>
            {shaState.kind === 'loading' ? '解析中…' : '使用'}
          </button>
        </div>
        {shaState.kind === 'error' && <p class="git-sha-error" role="alert">{shaState.message}</p>}
      </form>
    </div>
  )
}

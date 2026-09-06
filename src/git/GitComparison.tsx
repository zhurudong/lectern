import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { switchProjectView } from '../lib/projectViewFocus'
import type { PublicGitError, RepoUnavailableReason } from './errors'
import type { GitRefsSnapshot } from './refs'
import type {
  ChangedFile,
  CompareMode,
  GitCompareState,
  ImmutableEndpoint,
  LoadedFilePair,
  TargetEndpoint,
} from './protocol'
import { RefPicker } from './RefPicker'
import { UnifiedDiff } from './UnifiedDiff'
import { GitWorkerClient } from './workerClient'

interface GitComparisonProps {
  root: FileSystemDirectoryHandle
  sidebarWidth: number
  onSidebarResizeStart: (event: MouseEvent) => void
}

type PickerSide = 'base' | 'target'

const STATUS_ORDER = ['M', 'A', 'D'] as const
const STATUS_LABEL = { M: '已修改', A: '已新增', D: '已删除' } as const

function immutableFor(ref: GitRefsSnapshot['refs'][number]): ImmutableEndpoint {
  return {
    kind: ref.group === 'local' ? 'branch' : ref.group,
    label: ref.shortName,
    oid: ref.oid,
  }
}

function unavailableText(reason: RepoUnavailableReason): string {
  const labels: Record<RepoUnavailableReason, string> = {
    'not-a-git-repository': '当前目录不是可读取的 Git 仓库',
    'malformed-gitdir': '.git 指针格式无效',
    'gitdir-outside-authorized-root': 'Git 对象库位于已授权目录之外',
    'repository-unreadable': '无法读取本地 Git 元数据',
    'unsupported-object-format': '暂不支持 SHA-256 Git 仓库',
    'external-alternates': 'Git 对象依赖授权目录之外的 alternates',
    'bare-repository': '当前版本不支持 bare repository',
  }
  return labels[reason]
}

function errorText(error: PublicGitError | unknown): string {
  if (typeof error === 'object' && error != null && 'message' in error && typeof error.message === 'string') {
    return error.message
  }
  return 'Git 比较失败'
}

function endpointSha(endpoint: ImmutableEndpoint | TargetEndpoint): string {
  return (endpoint.kind === 'worktree' ? endpoint.headOid : endpoint.oid).slice(0, 8)
}

function endpointButtonLabel(endpoint: ImmutableEndpoint | TargetEndpoint): string {
  return endpoint.kind === 'worktree'
    ? `${endpoint.label} · HEAD ${endpointSha(endpoint)}`
    : `${endpoint.label}  ${endpointSha(endpoint)}`
}

function FileViewTabs() {
  return (
    <nav class="project-view-tabs git-project-view-tabs" aria-label="项目视图">
      <button type="button" data-project-view="files" onClick={() => switchProjectView('files')}>文件</button>
      <button type="button" class="active" aria-current="page" data-project-view="changes" autoFocus>变更</button>
    </nav>
  )
}

function FileFacts({
  file,
  pair,
  base,
  target,
  compareState,
}: {
  file: ChangedFile | null
  pair: LoadedFilePair | null
  base: ImmutableEndpoint
  target: TargetEndpoint
  compareState: GitCompareState
}) {
  if (!file) return <aside class="git-facts"><div class="git-facts-empty">选择文件后显示事实元数据</div></aside>
  const oldMode = file.old?.source === 'git' ? file.old.mode : '—'
  const newMode = file.new?.source === 'git' ? file.new.mode : file.new?.source === 'worktree' ? '不可观测' : '—'
  const confidence = compareState.kind === 'ready' ? compareState.confidence : null
  return (
    <aside class="git-facts" aria-label="文件事实">
      <header><span>文件事实</span><span class={`git-status-badge git-status-${file.status}`}>{file.status}</span></header>
      <div class="git-fact-path">{file.path}</div>
      <dl>
        <div><dt>状态</dt><dd>{STATUS_LABEL[file.status]}</dd></div>
        <div><dt>基准</dt><dd>{base.label}<small>{endpointSha(base)}</small></dd></div>
        <div><dt>目标</dt><dd>{target.label}<small>{endpointSha(target)}</small></dd></div>
      </dl>
      <section>
        <h3>对象</h3>
        <dl>
          <div><dt>旧 OID</dt><dd class="mono">{file.old?.oid.slice(0, 12) ?? '—'}</dd></div>
          <div><dt>新 OID</dt><dd class="mono">{file.new?.oid.slice(0, 12) ?? '—'}</dd></div>
          <div><dt>旧模式</dt><dd class="mono">{oldMode}</dd></div>
          <div><dt>新模式</dt><dd class="mono">{newMode}</dd></div>
          {pair && <div><dt>内容大小</dt><dd>{pair.old.size ?? 0} → {pair.new.size ?? 0} B</dd></div>}
        </dl>
      </section>
      <section>
        <h3>可信度</h3>
        {confidence?.kind === 'exact' ? (
          <p class="git-fact-ok"><span aria-hidden="true">●</span> Git 历史快照，精确</p>
        ) : (
          <>
            <p class="git-fact-limited"><span aria-hidden="true">◐</span> 工作区读取有边界</p>
            <p class="git-fact-note">浏览器无法观察权限位和 symlink；不读取授权外的 global excludes。</p>
          </>
        )}
      </section>
      <section class="git-readonly-note">
        <span aria-hidden="true">⌁</span>
        <div><strong>只读比较</strong><p>不执行 fetch、checkout 或任何写入。</p></div>
      </section>
    </aside>
  )
}

export function GitComparison({ root, sidebarWidth, onSidebarResizeStart }: GitComparisonProps) {
  const [client] = useState(() => new GitWorkerClient())
  const baseButtonRef = useRef<HTMLButtonElement>(null)
  const targetButtonRef = useRef<HTMLButtonElement>(null)
  const requestSeq = useRef(0)
  const slowHookConsumed = useRef(false)
  const [refs, setRefs] = useState<GitRefsSnapshot | null>(null)
  const [base, setBase] = useState<ImmutableEndpoint | null>(null)
  const [target, setTarget] = useState<TargetEndpoint | null>(null)
  const [compareMode, setCompareMode] = useState<CompareMode>('review')
  const [state, setState] = useState<GitCompareState>({ kind: 'idle' })
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [pair, setPair] = useState<LoadedFilePair | null>(null)
  const [pairLoading, setPairLoading] = useState(false)
  const [pairError, setPairError] = useState<string>()
  const [picker, setPicker] = useState<PickerSide | null>(null)
  const [refreshSeq, setRefreshSeq] = useState(0)

  useEffect(() => () => client.dispose(), [client])

  useEffect(() => {
    if (!refs || !base || !target || document.activeElement !== document.body) return
    document.querySelector<HTMLButtonElement>('[data-project-view="changes"][aria-current="page"]')?.focus()
  }, [refs, base, target])

  useEffect(() => {
    let alive = true
    setState({ kind: 'loading' })
    void client.probe(root).then((payload) => {
      if (!alive || payload.type !== 'probe-result') return
      if (payload.state.kind === 'unavailable') {
        setState(payload.state)
        return
      }
      const snapshot = payload.state.refs
      setRefs(snapshot)
      const fallback = snapshot.defaultBase ?? snapshot.groups.local[0] ?? snapshot.refs[0]
      if (!fallback) {
        setState({ kind: 'error', error: { code: 'invalid-ref', message: '仓库中没有可比较的本地引用' } })
        return
      }
      setBase(immutableFor(fallback))
      setTarget({ kind: 'worktree', label: '当前工作区', headOid: snapshot.head.oid })
    }).catch((error) => {
      if (alive && !(error instanceof DOMException && error.name === 'AbortError')) {
        setState({ kind: 'error', error: { code: 'repository-unreadable', message: errorText(error) } })
      }
    })
    return () => { alive = false }
  }, [client, root])

  useEffect(() => {
    if (!base || !target) return
    const seq = ++requestSeq.current
    const shouldDelay = __CV_TEST_HOOK__
      && !slowHookConsumed.current
      && new URLSearchParams(location.search).get('git-slow-initial') === '1'
    if (shouldDelay) slowHookConsumed.current = true
    setState({ kind: 'loading' })
    setSelectedPath(null)
    setPair(null)
    if (__CV_TEST_HOOK__) {
      document.documentElement.dataset.gitCompareStartedAt = performance.now().toFixed(1)
      document.documentElement.dataset.gitCompareRequestedTarget = target.label
    }
    void client.compare(root, {
      mode: compareMode,
      base,
      target,
      debugDelayMs: shouldDelay ? 2_000 : undefined,
    }).then((payload) => {
      if (seq !== requestSeq.current || payload.type !== 'compare-result') return
      setState(payload.state)
      if (__CV_TEST_HOOK__) {
        document.documentElement.dataset.gitCompareAppliedAt = performance.now().toFixed(1)
        document.documentElement.dataset.gitCompareAppliedTarget = target.label
      }
      if (payload.state.kind === 'ready') setSelectedPath(payload.state.files[0]?.path ?? null)
    }).catch((error) => {
      if (seq === requestSeq.current && !(error instanceof DOMException && error.name === 'AbortError')) {
        setState({ kind: 'error', error: { code: 'repository-unreadable', message: errorText(error) } })
      }
    })
  }, [client, root, base, target, compareMode, refreshSeq])

  const selectedFile = state.kind === 'ready'
    ? state.files.find((file) => file.path === selectedPath) ?? null
    : null

  useEffect(() => {
    let alive = true
    setPair(null)
    setPairError(undefined)
    if (!selectedFile) {
      setPairLoading(false)
      return
    }
    setPairLoading(true)
    void client.loadFilePair(selectedFile.path).then((payload) => {
      if (!alive || payload.type !== 'file-pair-result') return
      setPair(payload.pair)
      setPairLoading(false)
    }).catch((error) => {
      if (!alive || (error instanceof DOMException && error.name === 'AbortError')) return
      setPairError(errorText(error))
      setPairLoading(false)
    })
    return () => { alive = false }
  }, [client, selectedFile])

  const grouped = useMemo(() => {
    const files = state.kind === 'ready' ? [...state.files].sort((left, right) => left.path.localeCompare(right.path)) : []
    return Object.fromEntries(STATUS_ORDER.map((status) => [status, files.filter((file) => file.status === status)])) as Record<typeof STATUS_ORDER[number], ChangedFile[]>
  }, [state])

  const closePicker = () => {
    const side = picker
    setPicker(null)
    requestAnimationFrame(() => (side === 'base' ? baseButtonRef : targetButtonRef).current?.focus())
  }

  if (!refs || !base || !target) {
    return (
      <section class="git-comparison git-comparison-state" style={`--git-sidebar-width: ${sidebarWidth}px`}>
        <header class="git-commandbar"><FileViewTabs /></header>
        {state.kind === 'unavailable' ? (
          <div class="git-page-state" role="alert"><span aria-hidden="true">◇</span><h2>Git 对比不可用</h2><p>{unavailableText(state.reason)}</p></div>
        ) : state.kind === 'error' ? (
          <div class="git-page-state" role="alert"><span aria-hidden="true">!</span><h2>无法建立 Git 对比</h2><p>{state.error.message}</p></div>
        ) : (
          <div class="git-page-state" role="status"><span class="git-loading-mark" aria-hidden="true">◌</span><h2>正在读取本地 Git 数据</h2><p>只读取已授权目录，不发起网络请求。</p></div>
        )}
      </section>
    )
  }

  const swapDisabled = target.kind === 'worktree'
  const swap = () => {
    if (target.kind === 'worktree') return
    const previousBase = base
    setBase(target)
    setTarget(previousBase)
  }

  return (
    <section class="git-comparison" style={`--git-sidebar-width: ${sidebarWidth}px`}>
      <header class="git-commandbar">
        <FileViewTabs />
        <div class="git-endpoint-controls">
          <span class="git-control-label">基准</span>
          <div class="git-ref-anchor">
            <button
              type="button"
              ref={baseButtonRef}
              class="git-ref-trigger"
              aria-haspopup="dialog"
              aria-expanded={picker === 'base'}
              onClick={() => setPicker(picker === 'base' ? null : 'base')}
            >
              <span>{endpointButtonLabel(base)}</span><span aria-hidden="true">⌄</span>
            </button>
            {picker === 'base' && <RefPicker side="base" refs={refs} client={client} selected={base} onSelect={(value) => setBase(value as ImmutableEndpoint)} onClose={closePicker} />}
          </div>
          <button
            type="button"
            class="git-swap"
            aria-label="交换基准与目标"
            disabled={swapDisabled}
            title={swapDisabled ? '当前工作区只能作为目标，不能交换' : '交换基准与目标'}
            onClick={swap}
          >⇄</button>
          <span class="git-control-label">目标</span>
          <div class="git-ref-anchor">
            <button
              type="button"
              ref={targetButtonRef}
              class="git-ref-trigger"
              aria-haspopup="dialog"
              aria-expanded={picker === 'target'}
              onClick={() => setPicker(picker === 'target' ? null : 'target')}
            >
              <span>{endpointButtonLabel(target)}</span><span aria-hidden="true">⌄</span>
            </button>
            {picker === 'target' && <RefPicker side="target" refs={refs} client={client} selected={target} onSelect={(value) => setTarget(value as TargetEndpoint)} onClose={closePicker} />}
          </div>
        </div>
        <label class="git-mode-select">
          <span>比较模式</span>
          <select value={compareMode} onChange={(event) => setCompareMode((event.currentTarget as HTMLSelectElement).value as CompareMode)}>
            <option value="review">审查改动</option>
            <option value="direct">直接比较</option>
          </select>
        </label>
        <button
          type="button"
          class="git-refresh"
          title="使用当前端点重新读取本地状态"
          disabled={state.kind === 'loading'}
          onClick={() => setRefreshSeq((value) => value + 1)}
        ><span aria-hidden="true">↻</span> 重新比较</button>
      </header>
      <div class="git-live-status" aria-live="polite">
        {state.kind === 'loading' ? '正在计算差异…' : state.kind === 'ready' ? `共 ${state.files.length} 个变更文件` : state.kind === 'error' ? state.error.message : ''}
      </div>
      <div class="git-workspace">
        <aside class="git-change-nav" aria-label="变更文件">
          <header><span>变更</span><strong>{state.kind === 'ready' ? state.files.length : '—'}</strong></header>
          {state.kind === 'loading' && <div class="git-nav-state" role="status">正在比较本地快照…</div>}
          {state.kind === 'error' && <div class="git-nav-state git-nav-error" role="alert">{state.error.message}</div>}
          {state.kind === 'unavailable' && <div class="git-nav-state git-nav-error" role="alert">{unavailableText(state.reason)}</div>}
          {state.kind === 'ready' && state.files.length === 0 && <div class="git-nav-state"><span aria-hidden="true">✓</span><strong>没有变化</strong><p>所选快照内容一致。</p></div>}
          {state.kind === 'ready' && STATUS_ORDER.map((status) => {
            const files = grouped[status]
            if (!files.length) return null
            return (
              <section class="git-change-group" aria-label={STATUS_LABEL[status]} key={status}>
                <div class="git-change-group-title"><span>{STATUS_LABEL[status]}</span><span>{files.length}</span></div>
                {files.map((file) => {
                  const segments = file.path.split('/')
                  const name = segments.pop()
                  return (
                    <button
                      type="button"
                      class={`git-change-row ${selectedPath === file.path ? 'selected' : ''}`}
                      aria-current={selectedPath === file.path ? 'true' : undefined}
                      onClick={() => setSelectedPath(file.path)}
                      key={file.path}
                    >
                      <span class={`git-status-letter git-status-${file.status}`}>{file.status}</span>
                      <span class="git-change-name">{name}</span>
                      <span class="git-change-path">{segments.join('/')}</span>
                    </button>
                  )
                })}
              </section>
            )
          })}
        </aside>
        <div
          class="resizer git-change-resizer"
          role="separator"
          aria-label="调整变更文件列表宽度"
          aria-orientation="vertical"
          onMouseDown={(event) => onSidebarResizeStart(event as unknown as MouseEvent)}
        />
        <main class="git-diff-pane">
          <header class="git-file-header">
            <div>
              <span class={`git-status-letter git-status-${selectedFile?.status ?? 'M'}`}>{selectedFile?.status ?? '—'}</span>
              <strong>{selectedFile?.path ?? '未选择文件'}</strong>
            </div>
            <span class="git-compare-caption">{base.label} → {target.label}</span>
          </header>
          {selectedFile ? <UnifiedDiff file={selectedFile} pair={pair} loading={pairLoading} error={pairError} /> : (
            <div class="git-diff-state">{state.kind === 'ready' && state.files.length === 0 ? '所选快照没有内容变化' : '从左侧选择一个变更文件'}</div>
          )}
        </main>
        <FileFacts file={selectedFile} pair={pair} base={base} target={target} compareState={state} />
      </div>
    </section>
  )
}

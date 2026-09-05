import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { t } from '../i18n'
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
import { startGitWorker, type GitWorkerClient } from './workerClient'

interface GitComparisonProps {
  root: FileSystemDirectoryHandle
}

type PickerSide = 'base' | 'target'

const STATUS_ORDER = ['M', 'A', 'D'] as const
const statusLabel = (status: typeof STATUS_ORDER[number]): string => t(`git.status${status}`)

function immutableFor(ref: GitRefsSnapshot['refs'][number]): ImmutableEndpoint {
  return {
    kind: ref.group === 'local' ? 'branch' : ref.group,
    label: ref.shortName,
    oid: ref.oid,
  }
}

function unavailableText(reason: RepoUnavailableReason): string {
  const keys: Record<RepoUnavailableReason, string> = {
    'not-a-git-repository': 'git.unavail.notRepo',
    'malformed-gitdir': 'git.unavail.malformed',
    'gitdir-outside-authorized-root': 'git.unavail.outside',
    'repository-unreadable': 'git.unavail.unreadable',
    'unsupported-object-format': 'git.unavail.format',
    'external-alternates': 'git.unavail.alternates',
    'bare-repository': 'git.unavail.bare',
  }
  return t(keys[reason])
}

function errorText(error: PublicGitError | unknown): string {
  if (typeof error === 'object' && error != null && 'message' in error && typeof error.message === 'string') {
    return error.message
  }
  return t('git.errGeneric')
}

// worker 产生的 PublicGitError 带 code(+ 可选 reason),在**主线程显示处**按其翻译 ——
// worker 拿不到 lang 信号,故不能就地翻译(见 i18n/index.ts 的 worker 边界说明)。
function gitErrorText(error: PublicGitError): string {
  return error.reason ? t(`git.err.reason.${error.reason}`) : t(`git.err.${error.code}`)
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
    <nav class="project-view-tabs" aria-label={t('app.projectViewLabel')}>
      <button type="button" data-project-view="files" onClick={() => switchProjectView('files')}>{t('app.tabFiles')}</button>
      <button type="button" class="active" aria-current="page" data-project-view="changes" autoFocus>{t('app.tabChanges')}</button>
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
  if (!file) return <aside class="git-facts"><div class="git-facts-empty">{t('git.factsEmpty')}</div></aside>
  const oldMode = file.old?.source === 'git' ? file.old.mode : '—'
  const newMode = file.new?.source === 'git' ? file.new.mode : file.new?.source === 'worktree' ? t('git.modeUnobservable') : '—'
  const confidence = compareState.kind === 'ready' ? compareState.confidence : null
  return (
    <aside class="git-facts" aria-label={t('git.factsLabel')}>
      <header><span>{t('git.factsLabel')}</span><span class={`git-status-badge git-status-${file.status}`}>{file.status}</span></header>
      <div class="git-fact-path">{file.path}</div>
      <dl>
        <div><dt>{t('git.factStatus')}</dt><dd>{statusLabel(file.status)}</dd></div>
        <div><dt>{t('git.factBase')}</dt><dd>{base.label}<small>{endpointSha(base)}</small></dd></div>
        <div><dt>{t('git.factTarget')}</dt><dd>{target.label}<small>{endpointSha(target)}</small></dd></div>
      </dl>
      <section>
        <h3>{t('git.factObjects')}</h3>
        <dl>
          <div><dt>{t('git.factOldOid')}</dt><dd class="mono">{file.old?.oid.slice(0, 12) ?? '—'}</dd></div>
          <div><dt>{t('git.factNewOid')}</dt><dd class="mono">{file.new?.oid.slice(0, 12) ?? '—'}</dd></div>
          <div><dt>{t('git.factOldMode')}</dt><dd class="mono">{oldMode}</dd></div>
          <div><dt>{t('git.factNewMode')}</dt><dd class="mono">{newMode}</dd></div>
          {pair && <div><dt>{t('git.factSize')}</dt><dd>{pair.old.size ?? 0} → {pair.new.size ?? 0} B</dd></div>}
        </dl>
      </section>
      <section>
        <h3>{t('git.factConfidence')}</h3>
        {confidence?.kind === 'exact' ? (
          <p class="git-fact-ok"><span aria-hidden="true">●</span> {t('git.confExact')}</p>
        ) : (
          <>
            <p class="git-fact-limited"><span aria-hidden="true">◐</span> {t('git.confLimited')}</p>
            <p class="git-fact-note">{t('git.confNote')}</p>
          </>
        )}
      </section>
      <section class="git-readonly-note">
        <span aria-hidden="true">⌁</span>
        <div><strong>{t('git.readonlyTitle')}</strong><p>{t('git.readonlyNote')}</p></div>
      </section>
    </aside>
  )
}

export function GitComparison({ root }: GitComparisonProps) {
  const clientRef = useRef<GitWorkerClient>(startGitWorker())
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

  useEffect(() => {
    if (!refs || !base || !target || document.activeElement !== document.body) return
    document.querySelector<HTMLButtonElement>('[data-project-view="changes"][aria-current="page"]')?.focus()
  }, [refs, base, target])

  useEffect(() => {
    let alive = true
    setState({ kind: 'loading' })
    void clientRef.current.probe(root).then((payload) => {
      if (!alive || payload.type !== 'probe-result') return
      if (payload.state.kind === 'unavailable') {
        setState(payload.state)
        return
      }
      const snapshot = payload.state.refs
      setRefs(snapshot)
      const fallback = snapshot.defaultBase ?? snapshot.groups.local[0] ?? snapshot.refs[0]
      if (!fallback) {
        setState({ kind: 'error', error: { code: 'invalid-ref', message: t('git.err.invalid-ref') } })
        return
      }
      setBase(immutableFor(fallback))
      setTarget({ kind: 'worktree', label: t('git.worktree'), headOid: snapshot.head.oid })
    }).catch((error) => {
      if (alive && !(error instanceof DOMException && error.name === 'AbortError')) {
        setState({ kind: 'error', error: { code: 'repository-unreadable', message: errorText(error) } })
      }
    })
    return () => { alive = false }
  }, [root])

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
    void clientRef.current.compare(root, {
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
  }, [root, base, target, compareMode])

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
    void clientRef.current.loadFilePair(selectedFile.path).then((payload) => {
      if (!alive || payload.type !== 'file-pair-result') return
      setPair(payload.pair)
      setPairLoading(false)
    }).catch((error) => {
      if (!alive || (error instanceof DOMException && error.name === 'AbortError')) return
      setPairError(errorText(error))
      setPairLoading(false)
    })
    return () => { alive = false }
  }, [selectedFile])

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
      <section class="git-comparison git-comparison-state">
        <FileViewTabs />
        {state.kind === 'unavailable' ? (
          <div class="git-page-state" role="alert"><span aria-hidden="true">◇</span><h2>{t('git.pageUnavailTitle')}</h2><p>{unavailableText(state.reason)}</p></div>
        ) : state.kind === 'error' ? (
          <div class="git-page-state" role="alert"><span aria-hidden="true">!</span><h2>{t('git.pageErrorTitle')}</h2><p>{gitErrorText(state.error)}</p></div>
        ) : (
          <div class="git-page-state" role="status"><span class="git-loading-mark" aria-hidden="true">◌</span><h2>{t('git.pageLoadingTitle')}</h2><p>{t('git.pageLoadingNote')}</p></div>
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
    <section class="git-comparison">
      <header class="git-commandbar">
        <FileViewTabs />
        <div class="git-endpoint-controls">
          <span class="git-control-label">{t('git.factBase')}</span>
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
            {picker === 'base' && <RefPicker side="base" refs={refs} client={clientRef.current} selected={base} onSelect={(value) => setBase(value as ImmutableEndpoint)} onClose={closePicker} />}
          </div>
          <button
            type="button"
            class="git-swap"
            aria-label={t('git.swapLabel')}
            disabled={swapDisabled}
            title={swapDisabled ? t('git.swapDisabled') : t('git.swapLabel')}
            onClick={swap}
          >⇄</button>
          <span class="git-control-label">{t('git.factTarget')}</span>
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
            {picker === 'target' && <RefPicker side="target" refs={refs} client={clientRef.current} selected={target} onSelect={(value) => setTarget(value as TargetEndpoint)} onClose={closePicker} />}
          </div>
        </div>
        <label class="git-mode-select">
          <span>{t('git.mode')}</span>
          <select value={compareMode} onChange={(event) => setCompareMode((event.currentTarget as HTMLSelectElement).value as CompareMode)}>
            <option value="review">{t('git.modeReview')}</option>
            <option value="direct">{t('git.modeDirect')}</option>
          </select>
        </label>
      </header>
      <div class="git-live-status" aria-live="polite">
        {state.kind === 'loading' ? t('git.computing') : state.kind === 'ready' ? t('git.changedCount', { n: state.files.length }) : state.kind === 'error' ? gitErrorText(state.error) : ''}
      </div>
      <div class="git-workspace">
        <aside class="git-change-nav" aria-label={t('git.changedFilesLabel')}>
          <header><span>{t('app.tabChanges')}</span><strong>{state.kind === 'ready' ? state.files.length : '—'}</strong></header>
          {state.kind === 'loading' && <div class="git-nav-state" role="status">{t('git.comparing')}</div>}
          {state.kind === 'error' && <div class="git-nav-state git-nav-error" role="alert">{gitErrorText(state.error)}</div>}
          {state.kind === 'unavailable' && <div class="git-nav-state git-nav-error" role="alert">{unavailableText(state.reason)}</div>}
          {state.kind === 'ready' && state.files.length === 0 && <div class="git-nav-state"><span aria-hidden="true">✓</span><strong>{t('git.noChangesTitle')}</strong><p>{t('git.noChangesNote')}</p></div>}
          {state.kind === 'ready' && STATUS_ORDER.map((status) => {
            const files = grouped[status]
            if (!files.length) return null
            return (
              <section class="git-change-group" aria-label={statusLabel(status)} key={status}>
                <div class="git-change-group-title"><span>{statusLabel(status)}</span><span>{files.length}</span></div>
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
        <main class="git-diff-pane">
          <header class="git-file-header">
            <div>
              <span class={`git-status-letter git-status-${selectedFile?.status ?? 'M'}`}>{selectedFile?.status ?? '—'}</span>
              <strong>{selectedFile?.path ?? t('git.noFileSelected')}</strong>
            </div>
            <span class="git-compare-caption">{base.label} → {target.label}</span>
          </header>
          {selectedFile ? <UnifiedDiff file={selectedFile} pair={pair} loading={pairLoading} error={pairError} /> : (
            <div class="git-diff-state">{state.kind === 'ready' && state.files.length === 0 ? t('git.noContentChange') : t('git.pickFile')}</div>
          )}
        </main>
        <FileFacts file={selectedFile} pair={pair} base={base} target={target} compareState={state} />
      </div>
    </section>
  )
}

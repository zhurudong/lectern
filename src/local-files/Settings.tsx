import { signal } from '@preact/signals'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import {
  DEFAULT_CONFIG,
  FILE_EXTENSION_OPTIONS,
  getTakeoverSettings,
  saveTakeoverSettings,
  type TakeoverConfig,
} from './config'
import './settings.css'

const settingsOpen = signal(false)

export function openLocalFileSettings(): void {
  settingsOpen.value = true
}

function copyConfig(config: TakeoverConfig): TakeoverConfig {
  return { enabled: config.enabled, extensions: [...config.extensions] }
}

function sameConfig(a: TakeoverConfig, b: TakeoverConfig): boolean {
  return a.enabled === b.enabled
    && [...a.extensions].sort().join(',') === [...b.extensions].sort().join(',')
}

const groupOrder = ['Markdown', '代码', '纯文本', '图片']
const groups = [...new Set(FILE_EXTENSION_OPTIONS.map((option) => option.group))]
  .sort((a, b) => groupOrder.indexOf(a) - groupOrder.indexOf(b))

export function LocalFileSettings() {
  return settingsOpen.value ? <SettingsDialog /> : null
}

function SettingsDialog() {
  const dialog = useRef<HTMLDialogElement>(null)
  const mounted = useRef(true)
  const [draft, setDraft] = useState(() => copyConfig(DEFAULT_CONFIG))
  const [savedConfig, setSavedConfig] = useState<TakeoverConfig | null>(null)
  const [fileAccess, setFileAccess] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [accessError, setAccessError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [reload, setReload] = useState(0)

  const close = () => { settingsOpen.value = false }

  useLayoutEffect(() => {
    const element = dialog.current!
    element.showModal()
    return () => {
      mounted.current = false
      if (element.open) element.close()
    }
  }, [])

  useEffect(() => {
    let active = true
    let loaded = false
    let request = 0
    const read = async () => {
      const currentRequest = ++request
      if (!loaded) {
        setLoading(true)
        setLoadError('')
      }
      try {
        const result = await getTakeoverSettings()
        if (!active || currentRequest !== request) return
        setFileAccess(result.fileAccess)
        setAccessError('')
        if (!loaded) {
          setDraft(copyConfig(result.config))
          setSavedConfig(copyConfig(result.config))
          loaded = true
          setLoading(false)
        }
      } catch {
        if (!active || currentRequest !== request) return
        if (!loaded) {
          setLoadError('无法读取设置，请重试。')
          setLoading(false)
        } else {
          setFileAccess(null)
          setAccessError('无法确认文件访问权限，请重新打开此设置页。')
        }
      }
    }
    void read()
    // Returning from Chrome's extension page must refresh permission without
    // replacing the user's unsaved choices with the stored configuration.
    window.addEventListener('focus', read)
    return () => {
      active = false
      window.removeEventListener('focus', read)
    }
  }, [reload])

  const change = (next: TakeoverConfig) => {
    setDraft(next)
    setSaved(false)
    setSaveError('')
  }

  const toggleExtension = (extension: string, checked: boolean) => {
    const selected = new Set(draft.extensions)
    if (checked) selected.add(extension)
    else selected.delete(extension)
    change({ ...draft, extensions: [...selected] })
  }

  const save = async () => {
    if (!savedConfig || saving) return
    setSaving(true)
    setSaved(false)
    setSaveError('')
    try {
      const result = await saveTakeoverSettings(copyConfig(draft))
      if (!mounted.current) return
      setDraft(copyConfig(result.config))
      setSavedConfig(copyConfig(result.config))
      setFileAccess(result.fileAccess)
      setAccessError('')
      setSaved(true)
    } catch {
      if (mounted.current) setSaveError('保存失败，请重试。')
    } finally {
      if (mounted.current) setSaving(false)
    }
  }

  const openExtensionDetails = async () => {
    try {
      await chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` })
    } catch {
      if (mounted.current) {
        setAccessError('无法打开扩展设置。请在浏览器的扩展管理中打开 Lectern 详情，开启“允许访问文件网址”。')
      }
    }
  }

  const dirty = savedConfig !== null && !sameConfig(draft, savedConfig)
  const disabled = loading || savedConfig === null || saving
  const selected = new Set(draft.extensions)

  return (
    <dialog
      class="local-file-settings"
      ref={dialog}
      aria-labelledby="local-file-settings-title"
      aria-describedby="local-file-settings-description"
      onCancel={close}
      onClose={close}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <form onSubmit={(event) => { event.preventDefault(); void save() }}>
        <header class="local-file-settings-header">
          <div>
            <h2 id="local-file-settings-title">本地文件自动打开</h2>
            <p id="local-file-settings-description">在浏览器中打开选中的本地文件时，自动在当前标签页使用 Lectern 阅读。</p>
          </div>
          <button type="button" class="local-file-settings-close" aria-label="关闭本地文件设置" onClick={close} autoFocus>✕</button>
        </header>

        <div class="local-file-settings-body" aria-busy={loading || saving}>
          <section class="local-file-settings-access" aria-labelledby="local-file-access-title">
            <div>
              <h3 id="local-file-access-title">文件访问权限</h3>
              <p class={fileAccess === false ? 'local-file-settings-warning' : ''}>
                {fileAccess === null ? loading ? '正在确认授权状态…' : '暂时无法确认授权状态' : fileAccess ? '已允许访问文件网址' : '尚未允许访问文件网址，自动打开暂未生效。'}
              </p>
              {fileAccess !== true && <p>在 Lectern 的扩展详情中手动开启“允许访问文件网址”，返回后会自动更新状态。也可以继续手动选择文件阅读。</p>}
            </div>
            <button type="button" onClick={() => { void openExtensionDetails() }}>打开扩展设置</button>
            {accessError && <p class="local-file-settings-error" role="alert">{accessError}</p>}
          </section>

          {loading && <p class="local-file-settings-loading" role="status">正在读取设置…</p>}
          {loadError && <div class="local-file-settings-load-error" role="alert">
            <p>{loadError}</p>
            <button type="button" onClick={() => setReload((value) => value + 1)}>重试</button>
          </div>}

          {savedConfig !== null && <>
            <fieldset class="local-file-settings-controls" disabled={disabled}>
              <label class="local-file-settings-enabled">
                <input type="checkbox" checked={draft.enabled} onChange={(event) => change({ ...draft, enabled: event.currentTarget.checked })} />
                <span>
                  <strong>自动使用 Lectern 打开</strong>
                  <small>仅适用于本地文件网址；保存后对之后打开的文件生效。</small>
                </span>
              </label>

              <div class="local-file-settings-selection-header">
                <div>
                  <h3>选择文件后缀</h3>
                  <p>已选择 {selected.size} / {FILE_EXTENSION_OPTIONS.length} 个</p>
                </div>
                <div class="local-file-settings-bulk-actions">
                  <button type="button" onClick={() => change({ ...draft, extensions: FILE_EXTENSION_OPTIONS.map((option) => option.extension) })}>全选</button>
                  <button type="button" onClick={() => change({ ...draft, extensions: [] })}>清空</button>
                  <button type="button" onClick={() => change(copyConfig(DEFAULT_CONFIG))}>恢复默认</button>
                </div>
              </div>

              <p class="local-file-settings-note">默认选择代码、Markdown 和纯文本后缀；HTML 和图片默认不选。Dockerfile 等无后缀文件不在接管范围内。</p>

              <div class="local-file-settings-groups">
                {groups.map((group) => <fieldset class="local-file-settings-group" key={group}>
                  <legend>{group}</legend>
                  <div class="local-file-settings-extensions">
                    {FILE_EXTENSION_OPTIONS.filter((option) => option.group === group).map((option) => <label class="local-file-settings-extension" key={option.extension}>
                      <input
                        type="checkbox"
                        checked={selected.has(option.extension)}
                        onChange={(event) => toggleExtension(option.extension, event.currentTarget.checked)}
                      />
                      <span>
                        <code>.{option.extension}</code>
                        <small>{option.label}</small>
                      </span>
                    </label>)}
                  </div>
                </fieldset>)}
              </div>
            </fieldset>
          </>}
        </div>

        <footer class="local-file-settings-footer">
          <div class="local-file-settings-save-status">
            {saveError ? <p class="local-file-settings-error" role="alert">{saveError}</p> : <p role="status" aria-live="polite">
              {saving ? '正在保存…' : saved ? '已保存' : dirty ? '有未保存的更改' : ''}
            </p>}
          </div>
          <button type="button" onClick={close}>{saved && !dirty ? '关闭' : '取消'}</button>
          <button type="submit" class="local-file-settings-save" disabled={disabled || !dirty}>保存设置</button>
        </footer>
      </form>
    </dialog>
  )
}

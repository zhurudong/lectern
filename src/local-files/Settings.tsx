import { t } from '../i18n'
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
          setLoadError(t('release.cannot_load_settings_please_retry'))
          setLoading(false)
        } else {
          setFileAccess(null)
          setAccessError(t('release.cannot_check_file_access_reopen_these'))
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
      if (mounted.current) setSaveError(t('release.could_not_save_please_retry'))
    } finally {
      if (mounted.current) setSaving(false)
    }
  }

  const openExtensionDetails = async () => {
    try {
      await chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` })
    } catch {
      if (mounted.current) {
        setAccessError(t('release.cannot_open_extension_settings_open_lectern'))
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
            <h2 id="local-file-settings-title">{t('release.automatic_local_file_opening')}</h2>
            <p id="local-file-settings-description">{t('release.read_selected_local_file_types_in')}</p>
          </div>
          <button type="button" class="local-file-settings-close" aria-label={t('release.close_local_file_settings')} onClick={close} autoFocus>✕</button>
        </header>

        <div class="local-file-settings-body" aria-busy={loading || saving}>
          <section class="local-file-settings-access" aria-labelledby="local-file-access-title">
            <div>
              <h3 id="local-file-access-title">{t('release.file_access')}</h3>
              <p class={fileAccess === false ? 'local-file-settings-warning' : ''}>
                {fileAccess === null ? loading ? t('release.checking_access') : t('release.access_status_is_currently_unavailable') : fileAccess ? t('release.file_url_access_is_allowed') : t('release.file_url_access_is_not_allowed')}
              </p>
              {fileAccess !== true && <p>{t('release.enable_allow_access_to_file_urls')}</p>}
            </div>
            <button type="button" onClick={() => { void openExtensionDetails() }}>{t('release.open_extension_settings')}</button>
            {accessError && <p class="local-file-settings-error" role="alert">{accessError}</p>}
          </section>

          {loading && <p class="local-file-settings-loading" role="status">{t('release.loading_settings')}</p>}
          {loadError && <div class="local-file-settings-load-error" role="alert">
            <p>{loadError}</p>
            <button type="button" onClick={() => setReload((value) => value + 1)}>{t('release.retry')}</button>
          </div>}

          {savedConfig !== null && <>
            <fieldset class="local-file-settings-controls" disabled={disabled}>
              <label class="local-file-settings-enabled">
                <input type="checkbox" checked={draft.enabled} onChange={(event) => change({ ...draft, enabled: event.currentTarget.checked })} />
                <span>
                  <strong>{t('release.open_automatically_in_lectern')}</strong>
                  <small>{t('release.applies_only_to_local_file_urls')}</small>
                </span>
              </label>

              <div class="local-file-settings-selection-header">
                <div>
                  <h3>{t('release.choose_file_extensions')}</h3>
                  <p>{t('release.selected')} {selected.size} / {FILE_EXTENSION_OPTIONS.length} {t('release.items')}</p>
                </div>
                <div class="local-file-settings-bulk-actions">
                  <button type="button" onClick={() => change({ ...draft, extensions: FILE_EXTENSION_OPTIONS.map((option) => option.extension) })}>{t('release.select_all')}</button>
                  <button type="button" onClick={() => change({ ...draft, extensions: [] })}>{t('release.clear')}</button>
                  <button type="button" onClick={() => change(copyConfig(DEFAULT_CONFIG))}>{t('release.restore_defaults')}</button>
                </div>
              </div>

              <p class="local-file-settings-note">{t('release.code_markdown_and_text_extensions_are')}</p>

              <div class="local-file-settings-groups">
                {groups.map((group) => <fieldset class="local-file-settings-group" key={group}>
                  <legend>{t(`local.group.${group}`)}</legend>
                  <div class="local-file-settings-extensions">
                    {FILE_EXTENSION_OPTIONS.filter((option) => option.group === group).map((option) => <label class="local-file-settings-extension" key={option.extension}>
                      <input
                        type="checkbox"
                        checked={selected.has(option.extension)}
                        onChange={(event) => toggleExtension(option.extension, event.currentTarget.checked)}
                      />
                      <span>
                        <code>.{option.extension}</code>
                        <small>{['纯文本', '图片'].includes(option.label) ? t(`local.group.${option.label}`) : option.label}</small>
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
              {saving ? t('release.saving') : saved ? t('release.saved') : dirty ? t('release.unsaved_changes') : ''}
            </p>}
          </div>
          <button type="button" onClick={close}>{saved && !dirty ? t('release.close') : t('release.cancel')}</button>
          <button type="submit" class="local-file-settings-save" disabled={disabled || !dirty}>{t('release.save_settings')}</button>
        </footer>
      </form>
    </dialog>
  )
}

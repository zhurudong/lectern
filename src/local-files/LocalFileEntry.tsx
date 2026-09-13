import { t } from '../i18n'
import { signal } from '@preact/signals'
import { beginWorkspaceOpen, enterSingleFile, type AppMode, type SelectedFile } from '../state'
import { openSingleFile } from '../lib/access'
import { openLocalFileSettings } from './Settings'

export const localFileEntry = signal<{ url: string; error?: string } | null>(null)
let controller: AbortController | null = null
let openedFile: File | null = null

function clearAddress() {
  if (location.hash.startsWith('#file=')) history.replaceState(null, '', location.pathname + location.search)
}

export function cancelLocalFileOpen() {
  controller?.abort()
  controller = null
  localFileEntry.value = null
  openedFile = null
  clearAddress()
  document.title = 'Lectern'
}

/** Called after a committed UI change: picker/home actions supersede an in-flight read. */
export function syncLocalFileSelection(mode: AppMode, selected: SelectedFile | null) {
  if (localFileEntry.value && mode !== 'welcome') cancelLocalFileOpen()
  else if (openedFile && selected?.handle !== openedFile) cancelLocalFileOpen()
}

export function initializeLocalFile() {
  if (location.hash.startsWith('#file=')) void load(location.hash.slice('#file='.length))
}

async function load(url: string) {
  controller?.abort()
  const isCurrent = beginWorkspaceOpen()
  const request = new AbortController()
  controller = request
  localFileEntry.value = { url }
  try {
    if (!await chrome.extension.isAllowedFileSchemeAccess()) {
      throw new Error(t('release.enable_allow_access_to_file_urls_61'))
    }
    // Keep the audited transport as an unchanged, separately verified module.
    const moduleUrl = chrome.runtime.getURL('local-file-reader.js')
    const reader = await import(/* @vite-ignore */ moduleUrl) as {
      readLocalFile: (url: string, signal: AbortSignal) => Promise<File | { directoryUrl: string }>
    }
    if (request.signal.aborted) return
    if (!isCurrent()) { cancelLocalFileOpen(); return }
    const file = await reader.readLocalFile(url, request.signal)
    if (request.signal.aborted) return
    if (!isCurrent()) { cancelLocalFileOpen(); return }
    if (!(file instanceof File)) {
      location.replace(file.directoryUrl)
      return
    }
    controller = null
    openedFile = file
    localFileEntry.value = null
    enterSingleFile(file)
    document.title = `${file.name} — Lectern`
  } catch (error) {
    if (request.signal.aborted) return
    if (!isCurrent()) { cancelLocalFileOpen(); return }
    controller = null
    localFileEntry.value = {
      url,
      error: error instanceof TypeError
        ? t('release.cannot_read_the_file_check_that')
        : error instanceof Error ? error.message : String(error),
    }
  }
}

export function LocalFileEntry() {
  const state = localFileEntry.value
  if (!state) return null
  return (
    <div class="preview-placeholder local-file-entry" role={state.error ? 'alert' : 'status'}>
      <div>{state.error ? t('release.could_not_open_local_file') : t('release.opening_local_file')}</div>
      {state.error && <p>{state.error}</p>}
      <div class="local-file-actions">
        {state.error && <button onClick={() => void load(state.url)}>{t('release.retry')}</button>}
        <button onClick={() => void openSingleFile().catch((error: unknown) => {
          if (localFileEntry.value === state) {
            localFileEntry.value = { url: state.url, error: error instanceof Error ? error.message : String(error) }
          }
        })}>{t('release.open_file')}</button>
        {state.error && <button onClick={openLocalFileSettings}>{t('release.check_automatic_opening_settings')}</button>}
        <button onClick={() => { beginWorkspaceOpen(); cancelLocalFileOpen() }}>{t('release.back_to_home')}</button>
      </div>
    </div>
  )
}

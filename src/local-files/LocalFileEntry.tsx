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
      throw new Error('请在 Chrome 扩展详情中开启“允许访问文件网址”，或使用“打开文件”手动选择。')
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
        ? '无法读取文件，请检查文件是否仍存在，以及“允许访问文件网址”是否已开启。'
        : error instanceof Error ? error.message : String(error),
    }
  }
}

export function LocalFileEntry() {
  const state = localFileEntry.value
  if (!state) return null
  return (
    <div class="preview-placeholder local-file-entry" role={state.error ? 'alert' : 'status'}>
      <div>{state.error ? '本地文件打开失败' : '正在打开本地文件…'}</div>
      {state.error && <p>{state.error}</p>}
      <div class="local-file-actions">
        {state.error && <button onClick={() => void load(state.url)}>重试</button>}
        <button onClick={() => void openSingleFile().catch((error: unknown) => {
          if (localFileEntry.value === state) {
            localFileEntry.value = { url: state.url, error: error instanceof Error ? error.message : String(error) }
          }
        })}>打开文件</button>
        {state.error && <button onClick={openLocalFileSettings}>检查自动打开设置</button>}
        <button onClick={() => { beginWorkspaceOpen(); cancelLocalFileOpen() }}>返回首页</button>
      </div>
    </div>
  )
}

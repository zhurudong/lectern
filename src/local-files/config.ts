import { identifyByName, languageLabel, previewExtensions } from '../lib/filetypes'

export interface TakeoverConfig {
  enabled: boolean
  extensions: string[]
}

export const CONFIG_KEY = 'local-file-takeover'
export const FILE_EXTENSION_OPTIONS = previewExtensions().map((extension) => {
  const type = identifyByName(`file.${extension}`)!
  return {
    extension,
    label: type.channel === 'image' ? '图片' : languageLabel(type.language),
    group: type.channel === 'image' ? '图片' : type.channel === 'markdown' ? 'Markdown'
      : type.channel === 'text' ? '纯文本' : '代码',
    defaultEnabled: type.channel !== 'image' && type.language !== 'html',
  }
})
export const DEFAULT_CONFIG: TakeoverConfig = {
  enabled: true,
  extensions: FILE_EXTENSION_OPTIONS.filter((option) => option.defaultEnabled).map((option) => option.extension),
}
const supported = new Set(FILE_EXTENSION_OPTIONS.map((option) => option.extension))

export function normalizeConfig(value: unknown): TakeoverConfig {
  const input = value && typeof value === 'object' ? value as Partial<TakeoverConfig> : {}
  return {
    enabled: typeof input.enabled === 'boolean' ? input.enabled : DEFAULT_CONFIG.enabled,
    extensions: Array.isArray(input.extensions)
      ? [...new Set(input.extensions.filter((ext): ext is string => typeof ext === 'string')
        .map((ext) => ext.toLowerCase().replace(/^\./, '')).filter((ext) => supported.has(ext)))].sort()
      : [...DEFAULT_CONFIG.extensions],
  }
}

export interface TakeoverSettings { config: TakeoverConfig; fileAccess: boolean }

async function requestSettings(message: object): Promise<TakeoverSettings> {
  const result = await chrome.runtime.sendMessage(message)
  if (!result?.ok) throw new Error(result?.error || '自动打开设置暂时不可用，请重新加载扩展后重试。')
  return { config: normalizeConfig(result.config), fileAccess: result.fileAccess === true }
}

export function getTakeoverSettings(): Promise<TakeoverSettings> {
  return requestSettings({ type: 'local-files:get-settings' })
}

export function saveTakeoverSettings(config: TakeoverConfig): Promise<TakeoverSettings> {
  return requestSettings({ type: 'local-files:save-settings', config: normalizeConfig(config) })
}

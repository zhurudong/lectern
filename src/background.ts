import { CONFIG_KEY, normalizeConfig, type TakeoverConfig } from './local-files/config'
import { isTakeoverRule, takeoverRules } from './local-files/rules'

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('viewer.html') })
})

let operations: Promise<unknown> = Promise.resolve()
function serial<T>(operation: () => Promise<T>): Promise<T> {
  const next = operations.then(operation, operation)
  operations = next.catch(() => {})
  return next
}

async function storedConfig(): Promise<TakeoverConfig> {
  return normalizeConfig((await chrome.storage.local.get(CONFIG_KEY))[CONFIG_KEY])
}

async function applyRules(config: TakeoverConfig): Promise<void> {
  const addRules = await takeoverRules(config, chrome.runtime.getURL('viewer.html'))
  const rules = await chrome.declarativeNetRequest.getDynamicRules()
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: rules.filter((rule) => isTakeoverRule(rule.id)).map((rule) => rule.id),
    addRules,
  })
}

async function reconcile() {
  const config = await storedConfig()
  await applyRules(config)
  return { config, fileAccess: await chrome.extension.isAllowedFileSchemeAccess() }
}

async function save(value: unknown) {
  const previous = await storedConfig()
  const config = normalizeConfig(value)
  await applyRules(config)
  try {
    await chrome.storage.local.set({ [CONFIG_KEY]: config })
  } catch (error) {
    await applyRules(previous)
    throw error
  }
  return { config, fileAccess: await chrome.extension.isAllowedFileSchemeAccess() }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !sender.url) return
  const url = new URL(sender.url)
  if (url.protocol !== 'chrome-extension:' || url.hostname !== chrome.runtime.id || url.pathname !== '/viewer.html') return
  if (message?.type !== 'local-files:get-settings' && message?.type !== 'local-files:save-settings') return
  void serial(() => message.type === 'local-files:save-settings' ? save(message.config) : reconcile())
    .then((settings) => respond({ ok: true, ...settings }))
    .catch((error: unknown) => respond({ ok: false, error: error instanceof Error ? error.message : String(error) }))
  return true
})

// 动态规则会跨 Worker 休眠/浏览器重启保留；每次启动也从持久配置修复未完成的保存。
void serial(reconcile).catch((error: unknown) => console.error('本地文件自动打开初始化失败', error))

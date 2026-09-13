import { normalizeConfig, type TakeoverConfig } from './config'

const FIRST_RULE = 1000
const LAST_RULE = 9999
export function isTakeoverRule(id: number): boolean { return id >= FIRST_RULE && id <= LAST_RULE }

const compiled = new Map<string, Promise<string[]>>()

/** Chrome 限制每条 RE2 编译内存为 2 KiB；仅对超限后缀拆分等价分支。 */
function patternsFor(extension: string): Promise<string[]> {
  const cached = compiled.get(extension)
  if (cached) return cached
  const pending = (async () => {
    const tokens = [...extension].map((char) => {
      const upper = char.toUpperCase()
      const hex = char.charCodeAt(0).toString(16)
      const upperHex = upper.charCodeAt(0).toString(16)
      const low = /[a-f]/.test(hex[1]) ? `[${hex[1]}${hex[1].toUpperCase()}]` : hex[1]
      return [`[${char}${upper}]`, `%[${upperHex[0]}${hex[0]}]${low}`]
    })
    let checks = 0
    const compile = async (prefix: string, at: number): Promise<string[]> => {
      if (++checks > 256) throw new Error(`后缀 .${extension} 的匹配规则超出浏览器限制。`)
      const suffix = tokens.slice(at).map((alternatives) => `(?:${alternatives.join('|')})`).join('')
      const regex = '^file:///(?:[^/?#]+/)*[^/?#]+(?:\\.|%2[eE])' + prefix + suffix + '(?:[?#].*)?$'
      const result = await chrome.declarativeNetRequest.isRegexSupported({
        regex, isCaseSensitive: true, requireCapturing: true,
      })
      if (result.isSupported) return [regex]
      if (result.reason !== 'memoryLimitExceeded' || at >= tokens.length) {
        throw new Error(`浏览器不支持后缀 .${extension} 的匹配规则。`)
      }
      // 两个分支覆盖同一组地址，缩小每条规则，不放宽路径或后缀边界。
      return (await Promise.all(tokens[at].map((part) => compile(prefix + part, at + 1)))).flat()
    }
    return compile('', 0)
  })()
  compiled.set(extension, pending)
  void pending.catch(() => compiled.delete(extension))
  return pending
}

export async function takeoverRules(config: TakeoverConfig, viewerUrl: string): Promise<chrome.declarativeNetRequest.Rule[]> {
  const normalized = normalizeConfig(config)
  if (!normalized.enabled || normalized.extensions.length === 0) return []
  const patterns = (await Promise.all(normalized.extensions.map(patternsFor))).flat()
  if (patterns.length > 1000) throw new Error('已选后缀的匹配规则超出浏览器限制，请减少后缀。')
  return patterns.map((regexFilter, index) => ({
    id: FIRST_RULE + index,
    priority: 1,
    action: {
      type: chrome.declarativeNetRequest.RuleActionType.REDIRECT,
      redirect: { regexSubstitution: `${viewerUrl}#file=\\0` },
    },
    condition: {
      regexFilter,
      isUrlFilterCaseSensitive: true,
      resourceTypes: [chrome.declarativeNetRequest.ResourceType.MAIN_FRAME],
    },
  }))
}

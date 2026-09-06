import { signal } from '@preact/signals'
import { messages } from './messages'

// 轻量 i18n(与 theme.ts 同风格:一个 signal + localStorage 持久化,无第三方库)。
//
// 设计取舍(见 openspec/changes/add-english-ui-i18n/design.md):
// - **key → 翻译表**,不做运行时反射抽取;翻译表按语言分文件(见 i18n/messages.ts)。
// - `t()` 在渲染期读 `lang.value`,因此任何在组件渲染中调用 `t()` 的地方都会**自动订阅**
//   语言信号 —— 切换语言即时重渲染,无需额外接线(与 theme 切换同机制)。
// - **缺键回退到中文再回退到 key 本身**:迁移期只翻译了一部分串,缺失的英文键不会变成
//   空白或崩溃,而是显示中文原文 —— 让"逐面板迁移"成为安全的增量过程。
// - CJK 字体栈不动:语言切换只改文案,不改 `styles.css` 的字体声明。

export type Lang = 'zh' | 'en'

const LANG_KEY = 'cv-lang'

/**
 * 默认语言的裁定点(**唯一一处**)。
 * 0.3.4 起置 true:全量英文覆盖已达标(308 键中英对齐、E2E 英文冒烟 + 缺键回退把守),
 * 于是让非 `zh-*` 浏览器默认英文,触达更大的用户群体;`zh-*` 浏览器仍默认中文。
 * 用户显式选过的语言(localStorage['cv-lang'])永远优先于此探测。
 * 回退链(当前语言 → 中文 → key)保证即便某处漏翻也不会空白。
 */
const DETECT_BROWSER_LANG = true

function initialLang(): Lang {
  const stored = localStorage.getItem(LANG_KEY)
  if (stored === 'zh' || stored === 'en') return stored
  if (DETECT_BROWSER_LANG) {
    const nav = navigator.language ?? ''
    return nav.toLowerCase().startsWith('zh') ? 'zh' : 'en'
  }
  return 'zh'
}

export const lang = signal<Lang>(initialLang())

function apply(l: Lang): void {
  // 供 CSS / 无障碍 / 截图诊断使用;不影响字体栈
  document.documentElement.lang = l === 'zh' ? 'zh-CN' : 'en'
}

apply(lang.value)

export function setLang(l: Lang): void {
  lang.value = l
  localStorage.setItem(LANG_KEY, l)
  apply(l)
}

export function toggleLang(): void {
  setLang(lang.value === 'zh' ? 'en' : 'zh')
}

/**
 * 取一条已翻译文案。
 * @param key 命名空间化的键(如 `welcome.openFolder`)
 * @param params 可选占位符替换,模板里写 `{name}`
 *
 * 回退链:当前语言 → 中文 → key 本身。缺键不静默变空,便于发现漏翻。
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const l = lang.value
  const raw = messages[l]?.[key] ?? messages.zh[key] ?? key
  if (!params) return raw
  return raw.replace(/\{(\w+)\}/g, (m, name) =>
    name in params ? String(params[name]) : m,
  )
}

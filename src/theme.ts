import { signal } from '@preact/signals'

// 主题状态(file-preview spec"主题切换"):默认浅色,选择持久化 localStorage,
// 与侧栏宽度同一存储策略;CSS 侧通过 html[data-theme] 切换变量组。

export type Theme = 'light' | 'dark'

const THEME_KEY = 'cv-theme'

function initialTheme(): Theme {
  const stored = localStorage.getItem(THEME_KEY)
  return stored === 'dark' ? 'dark' : 'light' // 首装默认浅色
}

export const theme = signal<Theme>(initialTheme())

function apply(t: Theme): void {
  document.documentElement.dataset.theme = t
}

apply(theme.value)

export function setTheme(t: Theme): void {
  theme.value = t
  localStorage.setItem(THEME_KEY, t)
  apply(t)
}

export function toggleTheme(): void {
  setTheme(theme.value === 'light' ? 'dark' : 'light')
}

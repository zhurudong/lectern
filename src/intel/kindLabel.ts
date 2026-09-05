import { t } from '../i18n'
import { languageLabel } from '../lib/filetypes'
import { KIND, type KindId } from './symbols'

// 符号种类的**本地化标签**(主线程专用)。symbols.ts 与 Worker 共享、不引 i18n/Preact,
// 所以把"种类 → 翻译键"的映射放在这一层:大纲与符号搜索的徽标 tooltip 都从这里取。
const KIND_KEY: Record<KindId, string> = {
  [KIND.class]: 'kind.class',
  [KIND.interface]: 'kind.interface',
  [KIND.enum]: 'kind.enum',
  [KIND.struct]: 'kind.struct',
  [KIND.func]: 'kind.func',
  [KIND.method]: 'kind.method',
  [KIND.field]: 'kind.field',
  [KIND.constant]: 'kind.constant',
  [KIND.variable]: 'kind.variable',
  [KIND.type]: 'kind.type',
  [KIND.namespace]: 'kind.namespace',
  [KIND.macro]: 'kind.macro',
  [KIND.ctor]: 'kind.ctor',
  [KIND.heading]: 'kind.heading',
  [KIND.declaration]: 'kind.declaration',
}

export function kindLabel(kind: KindId): string {
  return t(KIND_KEY[kind])
}

// 语言展示名(主线程):filetypes.ts 与 Worker 共享、不引 i18n,所以"纯文本"这一档的
// 本地化放在这一层 —— 具名语言(Rust/PHP/…)本就是专名,两种语言下相同,直接透传。
export function langLabel(language?: string): string {
  return language ? languageLabel(language) : t('lang.plaintext')
}

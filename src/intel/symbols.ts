// 符号种类与共享数据形状(主线程与 Worker 共用,不引入 DOM/Preact 依赖)。

export const KIND = {
  class: 1,
  interface: 2,
  enum: 3,
  struct: 4,
  func: 5,
  method: 6,
  field: 7,
  constant: 8,
  variable: 9,
  type: 10,
  namespace: 11,
  macro: 12,
  ctor: 13,
  heading: 14,
  /** C/C++ 的函数原型:与"有函数体的定义"区分种类(头文件常常只有原型) */
  declaration: 15,
  /** SQL 对象与语句:只用于文件内大纲,不作为定义候选 */
  sql: 16,
} as const

export type KindId = (typeof KIND)[keyof typeof KIND]

export function isOutlineOnlyKind(kind: KindId): boolean {
  return kind === KIND.heading || kind === KIND.sql
}

/** 大纲/搜索结果里的种类标识(短徽标) */
export const KIND_BADGE: Record<KindId, string> = {
  [KIND.class]: 'C',
  [KIND.interface]: 'I',
  [KIND.enum]: 'E',
  [KIND.struct]: 'S',
  [KIND.func]: 'ƒ',
  [KIND.method]: 'm',
  [KIND.field]: '□',
  [KIND.constant]: 'K',
  [KIND.variable]: 'v',
  [KIND.type]: 'T',
  [KIND.namespace]: 'N',
  [KIND.macro]: '#',
  [KIND.ctor]: '⊕',
  [KIND.heading]: 'H',
  [KIND.declaration]: 'd',
  [KIND.sql]: 'Q',
}

export const KIND_LABEL: Record<KindId, string> = {
  [KIND.class]: '类',
  [KIND.interface]: '接口',
  [KIND.enum]: '枚举',
  [KIND.struct]: '结构体',
  [KIND.func]: '函数',
  [KIND.method]: '方法',
  [KIND.field]: '字段',
  [KIND.constant]: '常量',
  [KIND.variable]: '变量',
  [KIND.type]: '类型',
  [KIND.namespace]: '命名空间',
  [KIND.macro]: '宏',
  [KIND.ctor]: '构造函数',
  [KIND.heading]: '标题',
  [KIND.declaration]: '声明',
  [KIND.sql]: 'SQL 语句',
}

/** 抽取结果的单条符号(Worker 回传形状) */
export interface RawSymbol {
  name: string
  kind: KindId
  /** 1-based 行号 */
  line: number
  /** 所属容器名(类/结构体/命名空间/外层函数),无则 null */
  container: string | null
  /** Markdown 标题层级(1–6);仅 heading 使用 */
  level?: number
}

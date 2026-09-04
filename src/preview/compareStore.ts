import { signal } from '@preact/signals'
import { rootHandle, selectedFile } from '../state'
import { resolveFile } from '../lib/resolve'
import { identifyByName } from '../lib/filetypes'

// 文件对比(C1)的临时视图态(design.md D7 / spec「文件对比视图」)。
//
// **这是预览区的临时视图态,不是应用模式**:它不进 `navStack`、不改大纲归属、
// 不动目录树 / 搜索 / 跳转(D7 / task 3.4)。因此它自成一套极小信号,
// **不塞进 state.ts 的导航状态**,以免与刚稳定下来的导航栈纠缠。
//
// 对比目标**只从当前项目内选取**(D1 / task 2.1-2.3),复用既有的文件名检索
// (searchStore.searchFiles)+ 项目内路径解析(resolveFile);
// **MUST NOT 调 showOpenFilePicker 另开系统对话框** —— 全流程只碰项目内路径。

export interface CompareTarget {
  handle: FileSystemFileHandle
  path: string[]
  name: string
  /** 单调递增:同一路径再次选取(如 E2E 切换注入点后重进)也要触发对比视图重建 */
  nonce: number
}

/** 当前对比目标;非 null 时预览区渲染并排对比视图 */
export const compareTarget = signal<CompareTarget | null>(null)

let compareNonce = 0

/**
 * 对比结果的可靠性/规模统计,供 E2E 精确断言(它读不到 MergeView 的私有块结构)。
 * `imprecise`(task 8.2)与 `truncatedA/B`(task 6.2)是"结论不可靠"的两个来源,
 * 但在 UI 上归一为**同一条**提示(task 6.2b)。
 */
export interface CompareStats {
  chunkCount: number
  /** 有任一块 precise===false → 本次是近似比对 */
  imprecise: boolean
  truncatedA: boolean
  truncatedB: boolean
  aLines: number
  bLines: number
  /** 单块且覆盖两侧整份 = "整份都变了"这个看起来完整、实际错误的结论 */
  spansWhole: boolean
}

export const compareStats = signal<CompareStats | null>(null)

/**
 * 仅 dev 构建(__CV_TEST_HOOK__)暴露给 E2E 的注入点。
 *
 * 它们让 4.4 / 7.4 / 8.4 的"红过一次"证据能在**同一次 E2E 运行内**就地取得,
 * 而不必在源码里把控件临时改坏再改回 —— 那种临时改动不进版本控制,
 * 下一个人看不到"这条负向断言确实咬得住"的证据。
 */
export const compareTestOverrides = {
  /** 4.4:强制渲染接受/回退控件,证明"界面查不到控件"这条负向断言抓得到 */
  forceRevertControls: false,
  /** 7.4:退出时不归还焦点,证明"焦点不落 body / 落在触发按钮"这条断言抓得到 */
  skipFocusReturn: false,
  /** 8.4:退回 MergeView 默认 scanLimit:500,证明"小改动被放大成整份都变了"能被抓到(此路径 precise 仍为 true —— 这正是它"悄悄"退化、必须禁用的原因) */
  useDefaultScanLimit: false,
  /** 8.2:把 timeout 压到 1ms,让精算必定超预算 → 库自报 precise:false,证明"近似必须说出来"这条断言会亮起 */
  tinyTimeout: false,
}
export type CompareOverrideKey = keyof typeof compareTestOverrides
export function __setCompareOverride(key: CompareOverrideKey, value: boolean): void {
  compareTestOverrides[key] = value
}

/** 目标选择器是否打开 */
export const comparePickerOpen = signal(false)

/**
 * 选择器内的"可解释缺席"提示(D5 / task 5.1-5.3):
 * 单文件模式 / 同一文件 / 图片或二进制 / 读不出来 —— 逐条给出**说得出原因**的缺席,
 * MUST NOT 让入口无解释地消失,也 MUST NOT 给一个点了没反应的入口。
 */
export const comparePickerNotice = signal<string | null>(null)

/**
 * 触发本次对比的元素(通常是预览区头部的「对比」按钮)。
 * 退出对比时焦点交还到这里(D6 / spec「退出临时视图态时焦点交还到触发它的位置」/ task 7.2)。
 * **归还目标由入口动线单独确定** —— 这里就是那个入口,不统一规定为代码编辑区。
 */
let compareTrigger: HTMLElement | null = null

/** 打开对比目标选择器;记录触发元素以便退出时归还焦点 */
export function openComparePicker(trigger?: HTMLElement | null): void {
  compareTrigger = trigger ?? (document.activeElement as HTMLElement | null)
  comparePickerNotice.value = null
  comparePickerOpen.value = true
}

/** 关闭选择器(未选定目标);把焦点交还给触发按钮 */
export function closeComparePicker(): void {
  comparePickerOpen.value = false
  comparePickerNotice.value = null
  restoreTriggerFocus()
}

/**
 * 选定一个项目内路径作为对比目标。
 * 逐条做"可解释的缺席"判定;通过则进入对比态,否则在选择器内给出原因(保持打开,可另选)。
 */
export async function chooseCompareTarget(path: string): Promise<void> {
  const root = rootHandle.value
  const cur = selectedFile.value
  if (!root || !cur) {
    comparePickerNotice.value = '文件对比需要先打开一个项目'
    return
  }

  // 两侧解析为同一个文件:与自身对比没有意义(D5 / task 5.1)
  if (cur.path.join('/') === path) {
    comparePickerNotice.value = '这是当前正在预览的文件 —— 请选择另一个文件来对比'
    return
  }

  // 目标是图片或二进制:无法按文本对比(D5 / task 5.1)
  const name = path.slice(path.lastIndexOf('/') + 1)
  const info = identifyByName(name)
  if (info?.channel === 'image' || info?.channel === 'binary') {
    comparePickerNotice.value =
      `“${name}” 是${info.channel === 'image' ? '图片' : '二进制'}文件,不能按文本对比`
    return
  }

  // 目标读不出来(已删除 / 移动 / 授权失效):给出原因,不报错、不白屏(D5 / task 5.1)
  const resolved = await resolveFile(root, [], path)
  if (!resolved) {
    comparePickerNotice.value = `读不到 “${name}”:它可能已被删除、移动,或授权已失效`
    return
  }

  comparePickerOpen.value = false
  comparePickerNotice.value = null
  compareTarget.value = {
    handle: resolved.handle,
    path: resolved.path,
    name: resolved.path[resolved.path.length - 1] ?? name,
    nonce: ++compareNonce,
  }
}

/**
 * 退出对比态,回到当前文件的普通预览。
 * **把焦点交还到触发它的位置**(D6 / task 7.2):否则退出后焦点掉到 body,
 * 用户得回去摸鼠标 —— 那正是"到达之后不可继续"这类缺陷(task 7.3/7.4 盯的就是这条)。
 */
export function exitCompare(): void {
  compareTarget.value = null
  comparePickerOpen.value = false
  comparePickerNotice.value = null
  compareStats.value = null
  if (!compareTestOverrides.skipFocusReturn) restoreTriggerFocus()
  else compareTrigger = null
}

function restoreTriggerFocus(): void {
  const el = compareTrigger
  compareTrigger = null
  // 元素可能已随重渲染离开 DOM;仍在则交还焦点。
  if (el && el.isConnected && typeof el.focus === 'function') {
    el.focus()
  }
}

/** 切换文件 / 关闭项目时,对比态一并退出(它是当前文件的临时态,换了文件就不成立) */
export function resetCompare(): void {
  compareTarget.value = null
  comparePickerOpen.value = false
  comparePickerNotice.value = null
  compareStats.value = null
  compareTrigger = null
}

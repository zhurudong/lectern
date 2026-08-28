import { signal } from '@preact/signals'
import { useOverlayKeyboard } from '../lib/useOverlayKeyboard'
import { KEYS, display, isActive, type KeyId } from '../lib/keys'

// 键盘操作帮助(add-keyboard-first-navigation 3b.3 / 3b.4)。
//
// **做了快捷键而用户不知道它存在,等于没做。** 右键菜单的旁注负责"用鼠标时顺手看见",
// 这里负责"想系统地查一次时有地方查"。
//
// 内容**全部由 lib/keys.ts 生成**,一条也不手写 —— 改键位时这里自动跟着变;
// 手写一份的话,改键位那天它就开始说谎,而且不报错。
//
// 入口是**界面上可点的按钮**(基线),不依赖任何自定义键位:
// 一个"只能用快捷键打开的快捷键说明"对不知道快捷键的人是关不上的循环。

export const helpOpen = signal(false)

export function openHelp(): void {
  helpOpen.value = true
}
export function closeHelp(): void {
  helpOpen.value = false
}

const GROUP_ORDER = ['面板', '目录树', '代码区', '大纲', '搜索'] as const

/** 面板内可被 Tab 落上的元素;顺序即 DOM 顺序,与浏览器的 Tab 顺序一致 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

// **`aria-modal="true"` 现在成立了,所以加了回来。**
//
// 它不是"标注得更详细",而是一个**行为承诺**:辅助技术会据此告诉用户
// "对话框之外的内容此刻是惰性的",于是用户不会去尝试 Tab 出去。
// 上一版**故意没有它** —— 那时面板不做任何焦点约束,Tab 会走到面板背后,
// 声明与实现不符,而用户无从得知原因,因为他信的正是我们给的那个声明。
//
// 本版把焦点移入 / 归还 / 循环三件都做了(fix-help-panel-a11y 1.2 / 1.3),
// **约束真的成立之后**才把声明加回来 —— 顺序不能反过来。
export function KeyboardHelp() {
  const open = helpOpen.value

  // 焦点的**移入与归还**复用 `useOverlayKeyboard`(候选 / 引用 / 全文三处同一份)。
  // 那段逻辑被两个真实缺陷咬过(卸载时 `contains` 恒假导致一次都不归还;
  // 放宽判据后又在别人接管焦点之后抢回来),在这里重写一遍等于把同样的坑再挖一次。
  //
  // 但**它的列表键盘映射这里不用**:那份 `onKeyDown` 对 ↑↓/Home/End 一律
  // `preventDefault()`,而本面板是一块**可滚动的长文**,吞掉方向键就等于让它滚不动 ——
  // 于是 `count: 0` 只是"没有列表项",按键由下面这份自己处理。
  const k = useOverlayKeyboard({
    open,
    count: 0,
    idPrefix: 'help',
    onActivate: () => {},
    onClose: closeHelp,
  })

  // Esc 关闭(1.1)+ Tab 焦点循环(1.3)。**其余按键一律放行** —— 方向键要留给滚动。
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      k.close()
      return
    }
    if (e.key !== 'Tab') return
    // 焦点陷阱。**它必须与 Esc 同时存在**:没有出口的陷阱是真的把人困住,
    // 比不做陷阱糟得多(见 change 说明里的依赖链)。
    const panel = k.containerRef.current
    if (!panel) return
    const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)]
    e.preventDefault()
    if (items.length === 0) {
      // 面板里一个可聚焦元素都没有时,焦点留在容器上 —— 容器自己 tabIndex=-1,
      // 不 preventDefault 的话浏览器会把焦点送到面板**背后**去。
      panel.focus()
      return
    }
    const at = items.indexOf(document.activeElement as HTMLElement)
    // 焦点还在容器上(刚打开、尚未 Tab 过)时 `at` 为 -1:
    // 正向从第一个起、反向从最后一个起,与浏览器从容器 Tab 出去的直觉一致。
    const next = e.shiftKey
      ? (at <= 0 ? items.length - 1 : at - 1)
      : (at === -1 || at === items.length - 1 ? 0 : at + 1)
    items[next].focus()
  }

  if (!open) return null
  const ids = Object.keys(KEYS) as KeyId[]
  return (
    <div class="help-backdrop" onClick={() => k.close()}>
      <div
        class="help-panel"
        role="dialog"
        aria-modal="true"
        aria-label="键盘操作"
        ref={k.containerRef}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onClick={(e) => e.stopPropagation()}
      >
        <div class="help-header">
          <span class="help-title">键盘操作</span>
          <button class="help-close" title="关闭" onClick={() => k.close()}>
            ✕
          </button>
        </div>
        {GROUP_ORDER.map((group) => {
          // 未在本平台启用的补充键位直接不列 —— 提示一个按了没反应的键位比不提示更糟
          const rows = ids.filter((id) => KEYS[id].group === group && isActive(id))
          if (rows.length === 0) return null
          return (
            <div class="help-group" key={group}>
              <div class="help-group-title">{group}</div>
              {rows.map((id) => (
                <div class="help-row" key={id}>
                  <span class="help-row-label">{KEYS[id].label}</span>
                  <span class="help-row-key">{display(id)}</span>
                </div>
              ))}
            </div>
          )
        })}
        <div class="help-note">
          未列出的键位表示在当前平台尚未经真机核验,因此既不绑定也不提示;这些能力都另有界面入口。
        </div>
      </div>
    </div>
  )
}

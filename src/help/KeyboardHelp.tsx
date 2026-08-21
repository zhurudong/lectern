import { signal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
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

// **这里故意没有 `aria-modal="true"`。**
//
// 那个属性不是"标注得更详细",而是一个**行为承诺**:辅助技术会据此告诉用户
// "对话框之外的内容此刻是惰性的",于是用户不会去尝试 Tab 出去。
// 而本面板目前**没有做焦点约束** —— 打开后焦点仍在触发按钮上,Tab 会走到面板背后。
// 声明了却不兑现,用户得到的是与承诺不符的体验,**而且他无从得知原因,
// 因为他信的正是我们给出的那个声明**。
//
// 所以先撤掉这句不成立的声明(不减任何能力),等 `fix-help-panel-a11y` 把
// Escape 关闭 + 焦点移入 / 归还 / 循环做完、**焦点约束真的成立之后,再把它加回来**。
export function KeyboardHelp() {
  const open = helpOpen.value

  // Esc 关闭(fix-help-panel-a11y 1.1)。沿用 IntelOverlay 里同一种写法:
  // 打开期间才挂 keydown,关掉即卸载 —— **不是一个常驻的全局分发器**,
  // 它的作用域由面板的开合决定,而不是由"我现在在哪个面板"的条件判断决定。
  //
  // 本次**只做关闭**,不做焦点移入 / 归还 / 循环(那三件是一整包,见 change 说明:
  // 只移入不归还会把用户扔在面板残骸的位置上;没有出口的焦点陷阱比现状更糟)。
  // 因为焦点自始至终没被移走(仍在触发按钮上),关闭后它**本来就还在那儿** ——
  // 2.1 断言的正是这一点,而不是"面板消失了"。
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      closeHelp()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null
  const ids = Object.keys(KEYS) as KeyId[]
  return (
    <div class="help-backdrop" onClick={closeHelp}>
      <div
        class="help-panel"
        role="dialog"
        aria-label="键盘操作"
        onClick={(e) => e.stopPropagation()}
      >
        <div class="help-header">
          <span class="help-title">键盘操作</span>
          <button class="help-close" title="关闭" onClick={closeHelp}>
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

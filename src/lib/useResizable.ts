import { useState } from 'preact/hooks'

// 面板分隔条的拖拽 + 持久化(file-tree spec「侧栏宽度调整」)。
//
// **只有这一份实现。** 左侧目录树向右增宽、右侧大纲向左增宽 —— 方向是参数(`grow`),
// 不是再写一份的理由。分叉允许发生在参数层,不允许上浮成两份实现:
// 本项目已经在"单文件跳转决策"和"Markdown 行定位"上各吃过一次亏,形状都是同一个。

export interface ResizableOptions {
  /** localStorage 键 */
  storageKey: string
  min: number
  max: number
  defaultWidth: number
  /**
   * 拖拽方向与宽度的关系:
   * - `right`:分隔条在面板右侧,向右拖变宽(左侧目录树)
   * - `left` :分隔条在面板左侧,向左拖变宽(右侧大纲面板)
   */
  grow: 'right' | 'left'
}

export interface Resizable {
  width: number
  onResizeStart: (e: MouseEvent) => void
}

export function useResizable({ storageKey, min, max, defaultWidth, grow }: ResizableOptions): Resizable {
  const clamp = (w: number) => Math.min(max, Math.max(min, w))

  const [width, setWidth] = useState(() =>
    clamp(parseInt(localStorage.getItem(storageKey) ?? String(defaultWidth), 10) || defaultWidth),
  )

  const onResizeStart = (e: MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = width
    const dir = grow === 'right' ? 1 : -1
    const widthAt = (ev: MouseEvent) => clamp(startW + dir * (ev.clientX - startX))
    const onMove = (ev: MouseEvent) => setWidth(widthAt(ev))
    const onUp = (ev: MouseEvent) => {
      // 松开才落盘:拖拽过程中不写 localStorage
      localStorage.setItem(storageKey, String(widthAt(ev)))
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return { width, onResizeStart }
}

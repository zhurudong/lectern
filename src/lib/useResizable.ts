import { useEffect, useRef, useState } from 'preact/hooks'

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
   * - `up` / `down`:沿垂直方向调整高度; width/defaultWidth 沿用现有接口命名。
   */
  grow: 'right' | 'left' | 'up' | 'down'
}

export interface Resizable {
  width: number
  onResizeStart: (e: MouseEvent) => void
  onResizeKeyDown: (e: KeyboardEvent) => void
}

export function useResizable({ storageKey, min, max, defaultWidth, grow }: ResizableOptions): Resizable {
  const clamp = (w: number) => Math.min(max, Math.max(min, w))
  const vertical = grow === 'up' || grow === 'down'
  const dir = grow === 'right' || grow === 'down' ? 1 : -1
  const stopDrag = useRef(() => {})
  useEffect(() => () => stopDrag.current(), [])

  const [width, setWidth] = useState(() => {
    try { return clamp(parseInt(localStorage.getItem(storageKey) ?? '', 10) || defaultWidth) }
    catch { return clamp(defaultWidth) }
  })
  const commit = (value: number) => {
    setWidth(value)
    try { localStorage.setItem(storageKey, String(value)) } catch { /* resizing still works without persistence */ }
  }

  const onResizeStart = (e: MouseEvent) => {
    e.preventDefault()
    stopDrag.current()
    const startX = vertical ? e.clientY : e.clientX
    const startW = clamp(width)
    const widthAt = (ev: MouseEvent) => clamp(startW + dir * ((vertical ? ev.clientY : ev.clientX) - startX))
    const onMove = (ev: MouseEvent) => setWidth(widthAt(ev))
    const onUp = (ev: MouseEvent) => {
      // 松开才落盘:拖拽过程中不写 localStorage
      commit(widthAt(ev))
      stopDrag.current()
    }
    stopDrag.current = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const onResizeKeyDown = (e: KeyboardEvent) => {
    const increase = vertical ? 'ArrowDown' : 'ArrowRight'
    const decrease = vertical ? 'ArrowUp' : 'ArrowLeft'
    if (![increase, decrease, 'Home', 'End'].includes(e.key)) return
    e.preventDefault()
    e.stopPropagation()
    commit(e.key === 'Home' ? min : e.key === 'End' ? max
      : clamp(clamp(width) + (e.key === increase ? 1 : -1) * dir * (e.shiftKey ? 50 : 10)))
  }

  return { width: clamp(width), onResizeStart, onResizeKeyDown }
}

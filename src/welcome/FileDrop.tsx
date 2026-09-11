import { useLayoutEffect, useState } from 'preact/hooks'
import { openDroppedItems } from '../lib/access'

function hasFiles(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes('Files') ?? false
}

/** 全页面入口,包含目录树、代码编辑器和 Git 视图。 */
export function FileDrop() {
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useLayoutEffect(() => {
    let depth = 0
    let mounted = true
    const reset = () => {
      depth = 0
      setDragging(false)
    }
    const accept = (event: DragEvent) => {
      event.preventDefault()
      event.stopPropagation()
    }
    const onEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return
      accept(event)
      depth += 1
      setDragging(true)
    }
    const onOver = (event: DragEvent) => {
      if (!hasFiles(event)) return
      accept(event)
      event.dataTransfer!.dropEffect = 'copy'
      setDragging(true)
    }
    const onLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return
      accept(event)
      depth = Math.max(0, depth - 1)
      if (depth === 0) reset()
    }
    const onDrop = (event: DragEvent) => {
      reset()
      if (!hasFiles(event)) return
      accept(event)
      setError(null)
      // 直接调用,保证 getAsFileSystemHandle 仍处于 drop 事件的同步阶段。
      void openDroppedItems(event.dataTransfer!).catch((err: unknown) => {
        if (mounted) setError(err instanceof Error ? err.message : '拖放打开失败,请重试。')
      })
    }

    // capture 先于 CodeMirror 等组件消费文件拖放;文本与链接拖放保持原行为。
    window.addEventListener('dragenter', onEnter, true)
    window.addEventListener('dragover', onOver, true)
    window.addEventListener('dragleave', onLeave, true)
    window.addEventListener('drop', onDrop, true)
    window.addEventListener('dragend', reset, true)
    window.addEventListener('blur', reset)
    return () => {
      mounted = false
      window.removeEventListener('dragenter', onEnter, true)
      window.removeEventListener('dragover', onOver, true)
      window.removeEventListener('dragleave', onLeave, true)
      window.removeEventListener('drop', onDrop, true)
      window.removeEventListener('dragend', reset, true)
      window.removeEventListener('blur', reset)
    }
  }, [])

  return (
    <>
      {dragging && (
        <div class="file-drop-overlay" role="status">
          <div>松开以打开文件或文件夹</div>
        </div>
      )}
      {error && (
        <div class="file-drop-error" role="alert">
          <span>{error}</span>
          <button type="button" aria-label="关闭拖放提示" onClick={() => setError(null)}>✕</button>
        </div>
      )}
    </>
  )
}

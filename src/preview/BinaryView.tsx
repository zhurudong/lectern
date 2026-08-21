import { formatSize } from '../lib/fs'

// 二进制降级通道:不渲染内容,仅提示与基本信息。

export function BinaryView({ name, size }: { name: string; size: number }) {
  return (
    <div class="binary-view">
      <div class="big-icon">📦</div>
      <div>暂不支持预览此类型的文件</div>
      <div class="meta">
        {name} · {formatSize(size)}
      </div>
    </div>
  )
}

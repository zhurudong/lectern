import { useEffect, useState } from 'preact/hooks'
import { formatSize } from '../lib/fs'

// 图片预览通道:<img> + objectURL(SVG 经 <img> 加载不执行脚本),自适应缩放。

export function ImageView({ file, name, size }: { file: File; name: string; size: number }) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [file])

  return (
    <>
      <div class="image-view">{url && <img src={url} alt={name} />}</div>
      <div class="image-meta">
        {name} · {formatSize(size)}
      </div>
    </>
  )
}

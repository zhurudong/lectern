import { useEffect, useState } from 'preact/hooks'
import { openFolder, openSingleFile, reconnectRecent } from '../lib/access'
import { listRecent, removeRecent, type RecentProject } from '../lib/recent'

function formatTime(ts: number): string {
  const diff = Date.now() - ts
  const day = 24 * 60 * 60 * 1000
  if (diff < 60 * 1000) return '刚刚'
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)} 分钟前`
  if (diff < day) return `${Math.floor(diff / 3600000)} 小时前`
  if (diff < 30 * day) return `${Math.floor(diff / day)} 天前`
  return new Date(ts).toLocaleDateString()
}

export function Welcome() {
  const [recent, setRecent] = useState<RecentProject[] | null>(null)
  const [itemError, setItemError] = useState<{ id: string; message: string } | null>(null)

  const refresh = () => listRecent().then(setRecent)
  useEffect(() => {
    refresh()
  }, [])

  const onReconnect = async (rec: RecentProject) => {
    setItemError(null)
    const result = await reconnectRecent(rec)
    if (result === 'denied') {
      setItemError({ id: rec.id, message: '未获得访问授权,可重试或从列表移除' })
    } else if (result === 'gone') {
      setItemError({ id: rec.id, message: '目录不可用(可能已删除或移动),可从列表移除' })
    }
  }

  const onRemove = async (e: Event, rec: RecentProject) => {
    e.stopPropagation()
    await removeRecent(rec.id)
    setItemError(null)
    refresh()
  }

  return (
    <div class="welcome">
      <h1>Lectern</h1>
      <div class="subtitle">零网络、只读的本地代码阅读器 · 全部在本地完成</div>
      <div class="actions">
        <button onClick={() => void openFolder()}>打开文件夹</button>
        <button class="secondary" onClick={() => void openSingleFile()}>
          打开文件
        </button>
      </div>
      <div class="drop-hint">也可将一个文件或文件夹拖到页面任意位置打开</div>
      <div class="recent">
        <h2>最近项目</h2>
        {recent === null ? (
          <div class="recent-empty">加载中…</div>
        ) : recent.length === 0 ? (
          <div class="recent-empty">暂无最近项目,先打开一个文件夹吧</div>
        ) : (
          recent.map((rec) => (
            <div key={rec.id}>
              <div class="recent-item" onClick={() => void onReconnect(rec)}>
                <span class="icon">📁</span>
                <span class="name">{rec.name}</span>
                <span class="time">{formatTime(rec.lastOpened)}</span>
                <button class="remove" title="从列表移除" onClick={(e) => void onRemove(e, rec)}>
                  ✕
                </button>
              </div>
              {itemError?.id === rec.id && (
                <div class="recent-empty" style="color: var(--error)">
                  {itemError.message}
                </div>
              )}
            </div>
          ))
        )}
      </div>
      <div class="hint">
        首次打开目录后,重启浏览器可从最近项目一键重连;浏览器可能会请求一次访问确认。
        部分受保护目录(如系统目录、下载根目录)无法选择,请改选其子目录。
      </div>
    </div>
  )
}

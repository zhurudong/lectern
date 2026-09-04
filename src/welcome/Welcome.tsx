import { useEffect, useState } from 'preact/hooks'
import { openFolder, openSingleFile, reconnectRecent } from '../lib/access'
import { listRecent, removeRecent, type RecentProject } from '../lib/recent'
import { t } from '../i18n'

// i18n 样板面板(见 openspec/changes/add-english-ui-i18n):入口页所有可见文案改走 `t()`,
// 含相对时间这类**带占位符**的动态串,证明机制覆盖静态与插值两类文案。切换语言即时重渲染
// —— `t()` 在渲染期读 `lang` 信号,组件因此自动订阅。

function formatTime(ts: number): string {
  const diff = Date.now() - ts
  const day = 24 * 60 * 60 * 1000
  if (diff < 60 * 1000) return t('welcome.justNow')
  if (diff < 60 * 60 * 1000) return t('welcome.minutesAgo', { n: Math.floor(diff / 60000) })
  if (diff < day) return t('welcome.hoursAgo', { n: Math.floor(diff / 3600000) })
  if (diff < 30 * day) return t('welcome.daysAgo', { n: Math.floor(diff / day) })
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
      setItemError({ id: rec.id, message: t('welcome.errDenied') })
    } else if (result === 'gone') {
      setItemError({ id: rec.id, message: t('welcome.errGone') })
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
      <div class="subtitle">{t('welcome.subtitle')}</div>
      <div class="actions">
        <button onClick={() => void openFolder()}>{t('welcome.openFolder')}</button>
        <button class="secondary" onClick={() => void openSingleFile()}>
          {t('welcome.openFile')}
        </button>
      </div>
      <div class="recent">
        <h2>{t('welcome.recentTitle')}</h2>
        {recent === null ? (
          <div class="recent-empty">{t('welcome.loading')}</div>
        ) : recent.length === 0 ? (
          <div class="recent-empty">{t('welcome.recentEmpty')}</div>
        ) : (
          recent.map((rec) => (
            <div key={rec.id}>
              <div class="recent-item" onClick={() => void onReconnect(rec)}>
                <span class="icon">📁</span>
                <span class="name">{rec.name}</span>
                <span class="time">{formatTime(rec.lastOpened)}</span>
                <button class="remove" title={t('welcome.removeFromList')} onClick={(e) => void onRemove(e, rec)}>
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
      <div class="hint">{t('welcome.hint')}</div>
    </div>
  )
}

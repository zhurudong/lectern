import { useEffect } from 'preact/hooks'
import { mode } from '../state'
import { KEYS, hint } from '../lib/keys'
import { useOverlayKeyboard } from '../lib/useOverlayKeyboard'
import { focusEditorWhenReady } from '../lib/focusEditor'
import { verifiedShortcuts } from '../lib/platform'
import { KIND_BADGE, KIND_LABEL } from './symbols'
import {
  candidateList, closeCandidates, closeContextMenu, contextMenu,
  dismissNotice, jumpNotice, jumpToDefinition, pickCandidate,
} from './jump'
import { canGoBack, canGoForward, goBack, goForward, lastNavKey } from './navStack'
import { findReferences } from './references'

// 代码理解层的浮层:一次性提示、多候选列表、预览区右键菜单。
// 三者都不依赖快捷键,是 spec「入口可达性不依赖浏览器保留键」要求的界面入口。

export function IntelOverlay() {
  const notice = jumpNotice.value
  const candidates = candidateList.value
  const menu = contextMenu.value

  // 多候选面板的键盘与焦点(2.1–2.4):与引用/全文面板共用同一份实现
  const kb = useOverlayKeyboard({
    open: !!candidates,
    count: candidates?.hits.length ?? 0,
    idPrefix: 'cv-cand',
    onActivate: (i) => {
      const hit = candidateList.value?.hits[i]
      if (!hit) return
      // 2.4:落点**显式指定为代码区**,不再依赖"归还到触发处、而触发处恰好是编辑器"。
      // 选中一个定义的意图就是"去那段代码",所以焦点该落在代码上 ——
      // 这与触发来源是谁无关,换个入口也不会再断。
      void pickCandidate(hit).then(() => focusEditorWhenReady())
    },
    onClose: closeCandidates,
    // 候选面板:选中一项即跳转并关闭,落点由 onActivate 显式指定为代码区
    closesOnActivate: true,
  })

  // Esc 关闭浮层;点击别处关闭右键菜单;⌥←/⌥→ 作为导航栈的补充键位(仅 macOS)
  useEffect(() => {
    const macKeys = verifiedShortcuts()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (candidateList.value) closeCandidates()
        if (contextMenu.value) closeContextMenu()
        dismissNotice()
        return
      }
      // Windows/Linux 的 Alt+←/→ 是浏览器前进后退的默认绑定,按保守假定不绑定也不提示;
      // 界面上的后退/前进按钮才是主入口,键位只是 macOS 上的便捷层。
      if (!macKeys || !e.altKey || e.metaKey || e.ctrlKey) return
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        lastNavKey.key = 'ArrowLeft'
        lastNavKey.defaultPrevented = e.defaultPrevented
        void goBack()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        lastNavKey.key = 'ArrowRight'
        lastNavKey.defaultPrevented = e.defaultPrevented
        void goForward()
      }
    }
    const onDown = () => closeContextMenu()
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown)
    }
  }, [])

  return (
    <>
      {notice && (
        <div class="intel-toast" onClick={dismissNotice}>
          {notice}
        </div>
      )}

      {candidates && (
        <>
          <div class="intel-backdrop" onClick={kb.close} />
          <div
            class="candidate-panel"
            tabIndex={-1}
            ref={kb.containerRef}
            role="listbox"
            aria-label="同名定义候选"
            aria-activedescendant={kb.activeId}
            onKeyDown={(e) => kb.onKeyDown(e as unknown as KeyboardEvent)}
          >
            <div class="candidate-header">
              <span>
                “{candidates.name}” 有 {candidates.hits.length} 处同名定义,请选择
              </span>
              <button class="candidate-close" title="关闭" onClick={kb.close}>
                ✕
              </button>
            </div>
            <div class="candidate-hint">
              结果基于名称与语法树的启发式匹配,不做类型推断,可能包含同名但无关的定义。
            </div>
            <div class="candidate-list">
              {candidates.hits.map((h, i) => (
                <div
                  key={`${h.path}:${h.line}`}
                  id={`cv-cand-${i}`}
                  role="option"
                  aria-selected={kb.selected === i}
                  class={`candidate-row${kb.selected === i ? ' selected' : ''}`}
                  onClick={() => kb.activate(i)}
                >
                  <span class={`outline-kind kind-${h.kind}`} title={KIND_LABEL[h.kind]}>
                    {KIND_BADGE[h.kind]}
                  </span>
                  <span class="candidate-name">{h.name}</span>
                  {h.container && <span class="candidate-container">{h.container}</span>}
                  <span class="candidate-path">
                    {h.path}:{h.line}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {menu && (
        <div
          class="intel-menu"
          style={{ left: `${menu.x}px`, top: `${menu.y}px` }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div class="intel-menu-title">{menu.word}</div>
          <button
            class="intel-menu-item"
            onClick={() => {
              closeContextMenu()
              void jumpToDefinition(menu.word, menu.line)
            }}
          >
            <span class="intel-menu-label">{KEYS.jumpToDefinition.label}</span>
            {/* 3b.2:鼠标用户在**用鼠标的那一刻**看到键盘的存在 —— 最不打扰的教学时机。
                键位文本来自 lib/keys.ts 的单一映射,**这里不写任何键位字面量**;
                未核验平台上 hint() 返回 null,于是什么也不显示。 */}
            {hint('jumpToDefinition') && (
              <span class="intel-menu-key">{hint('jumpToDefinition')}</span>
            )}
          </button>
          <button
            class="intel-menu-item"
            disabled={mode.value !== 'project'}
            title={mode.value !== 'project' ? '需要打开文件夹才能在项目内查找引用' : undefined}
            onClick={() => {
              closeContextMenu()
              void findReferences(menu.word)
            }}
          >
            <span class="intel-menu-label">{KEYS.findReferences.label}</span>
            {hint('findReferences') && <span class="intel-menu-key">{hint('findReferences')}</span>}
            {mode.value !== 'project' && <span class="intel-menu-note">(需打开文件夹)</span>}
          </button>
        </div>
      )}
    </>
  )
}

/** 导航栈的后退/前进按钮 —— **主入口**,端点处置灰 */
export function NavButtons() {
  const back = canGoBack.value
  const forward = canGoForward.value
  // 键位提示只在经真机核验的平台展示(Win/Linux 的 Alt+←→ 是浏览器前进后退)
  const keys = verifiedShortcuts()
  return (
    <span class="nav-buttons">
      <button
        class="nav-btn"
        disabled={!back}
        title={keys ? '后退(⌥←)' : '后退'}
        onClick={() => void goBack()}
      >
        ←
      </button>
      <button
        class="nav-btn"
        disabled={!forward}
        title={keys ? '前进(⌥→)' : '前进'}
        onClick={() => void goForward()}
      >
        →
      </button>
    </span>
  )
}

import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { t } from '../i18n'
import { rootHandle, selectedFile, selectFile } from '../state'
import { startIndex } from '../search/searchStore'
import { closeContentSearch } from '../search/contentStore'
import { closeReferences } from '../intel/references'
import { FileIcon } from './FileIcon'
import {
  initTree,
  toggleDir,
  visibleRows,
  treeVersion,
  treeRoot,
  treeRefreshing,
  refreshTree,
  clearTree,
  toggleHidden,
  type TreeNode,
  type TreeRow,
} from './treeStore'

// 目录树 UI(file-tree spec):固定行高 + 自研虚拟滚动,只渲染视口内的行。

const ROW_HEIGHT = 28 // 密度令牌(A 方案):目录行 28px
const OVERSCAN = 10

/** 行的稳定 id:由路径派生(不含空白字符,可直接用作 HTML id) */
export function rowId(path: string[]): string {
  return `cv-row-${encodeURIComponent(path.join('/'))}`
}

function Row({
  row, onClick, isActive,
}: {
  row: TreeRow
  onClick: (node: TreeNode) => void
  isActive: boolean
}) {
  // "已隐藏 N 项":排除必须**可见且可逆** —— 它不是一个目录,是该层被排除项的入口,
  // 所以样式上与普通目录行明确区分(斜体 + 虚线框 + 专用配色)。
  if (row.type === 'hidden') {
    return (
      <div
        class={`tree-row tree-hidden${row.expanded ? ' expanded' : ''}`}
        style={{ paddingLeft: `${row.depth * 12 + 8}px` }}
        title={
          row.expanded
            ? t('tree.collapseExcluded')
            : t('tree.hiddenTitle', { count: row.count })
        }
        onClick={() => toggleHidden(row.parent)}
      >
        <span class="twisty">{row.expanded ? '▾' : '▸'}</span>
        <span class="label">{t('tree.hiddenLabel', { count: row.count })}</span>
      </div>
    )
  }
  if (row.type === 'loading') {
    return (
      <div class="tree-row" style={{ paddingLeft: `${row.depth * 12 + 8}px` }}>
        <span class="twisty" />
        <span class="label loading">{t('welcome.loading')}</span>
      </div>
    )
  }
  const node = row.node
  const sel = selectedFile.value
  const isSelected =
    node.kind === 'file' && sel != null && sel.path.join('/') === node.path.join('/')
  return (
    <div
      // 活动行(键盘光标)与选中文件(当前预览)是两件事,可以不在同一行,
      // 所以是两个独立的 class,视觉手段也不同:焦点环 vs 背景填充
      class={`tree-row${isSelected ? ' selected' : ''}${isActive ? ' active' : ''}`}
      id={rowId(node.path)}
      role="treeitem"
      aria-level={node.depth + 1}
      aria-selected={isSelected}
      {...(node.kind === 'dir' ? { 'aria-expanded': node.expanded } : {})}
      style={{ paddingLeft: `${node.depth * 12 + 8}px` }}
      title={node.error ? t('tree.readFailed', { error: node.error }) : node.path.join('/')}
      onClick={() => onClick(node)}
    >
      <span class="twisty">{node.kind === 'dir' ? (node.expanded ? '▾' : '▸') : ''}</span>
      {/* 目录图标不随展开态变化:展开与否已由左侧三角表达,两处表达同一状态是冗余 */}
      <FileIcon name={node.name} isDir={node.kind === 'dir'} />
      <span class="label" style={node.error ? 'color: var(--error)' : undefined}>
        {node.name}
      </span>
    </div>
  )
}

export function Tree() {
  const version = treeVersion.value // 订阅树结构变更
  const root = rootHandle.value
  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewport, setViewport] = useState(600)
  /** 滚动中标记:虚拟滚动复用 DOM 节点,行背景的过渡会在快速滚动时拖影 */
  const [scrolling, setScrolling] = useState(false)
  const scrollIdle = useRef<ReturnType<typeof setTimeout> | null>(null)
  /**
   * 活动行(键盘光标)用**路径**标识,不用行索引也不用 DOM 引用:
   * 展开/折叠/刷新都会重排行序,索引会指向另一行;路径在结构变化后仍指向同一节点。
   * DOM 引用更不行 —— 虚拟滚动会把滚出视口的行卸载掉。
   */
  const [activePath, setActivePath] = useState<string[] | null>(null)
  /** 焦点到达的计数:只用来把"补设活动行"的 effect 重新触发一次(见 onTreeFocus) */
  const [focusTick, setFocusTick] = useState(0)

  // 临时诊断:同一瞬间取齐"属性 / activePath / 严格焦点判定",
  // 因为"属性缺失"与"↓ 落到第二行"这两个观察不可能同真 —— 要找的是它们之间变了什么。
  if (__CV_TEST_HOOK__) {
    ;(window as unknown as { __cvTreeState?: () => unknown }).__cvTreeState = () => ({
      activePath,
      rowsLen: rows.length,
      nodeRows: rows.filter((r) => r.type === 'node').length,
      strictFocus: document.activeElement === containerRef.current,
      attr: containerRef.current?.getAttribute('aria-activedescendant') ?? null,
      activeElCls: document.activeElement?.className ?? null,
    })
  }

  useEffect(() => {
    if (root) {
      void initTree(root)
      setScrollTop(0)
      containerRef.current?.scrollTo({ top: 0 })
    } else {
      clearTree()
    }
  }, [root])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setViewport(el.clientHeight))
    ro.observe(el)
    setViewport(el.clientHeight)
    return () => ro.disconnect()
  }, [])

  // 版本号变化时重算扁平列表
  const rows = useMemo(() => visibleRows(), [version])

  const total = rows.length
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const end = Math.min(total, Math.ceil((scrollTop + viewport) / ROW_HEIGHT) + OVERSCAN)

  // —— 键盘导航(WAI-ARIA tree 模式)——
  // 焦点始终留在容器上,活动行只是被 aria-activedescendant 引用的元素:
  // 行被虚拟化卸载时,DOM 焦点不会丢(roving tabindex 在这里必然坏)。

  const nodeRowAt = (i: number) => (rows[i]?.type === 'node' ? rows[i] : null)

  /** 活动路径在当前行序中的下标;节点已消失时回退到最近的可定位祖先,再退到首行 */
  const resolveActiveIndex = (): number => {
    if (!activePath) return -1
    for (let p = activePath; p.length > 0; p = p.slice(0, -1)) {
      const key = p.join('/')
      const i = rows.findIndex((r) => r.type === 'node' && r.node.path.join('/') === key)
      if (i >= 0) return i
    }
    return rows.findIndex((r) => r.type === 'node')
  }

  /** 仅在越界时滚动,且只滚"刚好进入视口"的量 —— 居中会让长按方向键连续移动时抖动 */
  const ensureVisible = (index: number) => {
    const el = containerRef.current
    if (!el) return
    const top = index * ROW_HEIGHT
    const bottom = top + ROW_HEIGHT
    if (top < el.scrollTop) el.scrollTop = top
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight
  }

  const moveTo = (index: number) => {
    let i = Math.max(0, Math.min(rows.length - 1, index))
    // 跳过"加载中…"占位行
    while (i >= 0 && i < rows.length && rows[i].type !== 'node') i++
    const row = nodeRowAt(i)
    if (!row || row.type !== 'node') return
    setActivePath(row.node.path)
    ensureVisible(i)
  }

  const onTreeKeyDown = (e: KeyboardEvent) => {
    if (rows.length === 0) return
    const cur = resolveActiveIndex()
    const row = cur >= 0 ? nodeRowAt(cur) : null
    const node = row && row.type === 'node' ? row.node : null

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        moveTo(cur < 0 ? 0 : cur + 1)
        return
      case 'ArrowUp': {
        e.preventDefault()
        if (cur <= 0) return
        // 向上同样要跳过占位行
        let i = cur - 1
        while (i >= 0 && rows[i].type !== 'node') i--
        if (i >= 0) moveTo(i)
        return
      }
      case 'Home':
        e.preventDefault()
        moveTo(0)
        return
      case 'End':
        e.preventDefault()
        moveTo(rows.length - 1)
        return
      case 'ArrowRight':
        e.preventDefault()
        if (!node || node.kind !== 'dir') return
        // 未展开 → 展开;已展开 → 进第一个子项(扁平化后子项必然紧随父项)
        if (!node.expanded) toggleDir(node)
        else moveTo(cur + 1)
        return
      case 'ArrowLeft': {
        e.preventDefault()
        if (!node) return
        if (node.kind === 'dir' && node.expanded) {
          toggleDir(node)
          return
        }
        // 回父级:路径去掉最后一段即可,不需要父指针
        const parent = node.path.slice(0, -1)
        if (parent.length === 0) return
        const key = parent.join('/')
        const i = rows.findIndex((r) => r.type === 'node' && r.node.path.join('/') === key)
        if (i >= 0) moveTo(i)
        return
      }
      case 'Enter':
        e.preventDefault()
        // **走与鼠标点击同一条通道** —— 键盘与鼠标只是入口不同,行为契约只有一份
        if (node) onRowClick(node)
        return
    }
  }

  // rows 就绪后补设活动行。
  //
  // **病根是"只尝试一次、失败不重试",不是 moveTo 的跳过逻辑。**
  // `onFocus` 只在获得焦点那一刻触发一次;若那一刻整棵树还是"加载中…"占位,
  // `moveTo(0)` 向后扫也找不到可落点,直接返回 —— 而焦点事件不会自己重来,
  // 活动行就永久为空。跳过非 node 行本身是对的,**这里补的是重试,不是放宽门槛**。
  useEffect(() => {
    if (activePath) return
    if (document.activeElement !== containerRef.current) return
    if (!rows.some((r) => r.type === 'node')) return
    moveTo(0)
  }, [rows, activePath, focusTick])

  /** 容器获得焦点时若还没有活动行:优先落在当前预览的文件上,否则首行 */
  const onTreeFocus = () => {
    // 每次获得焦点都推一下 tick,让上面那个补设 effect **在本次渲染之后**再跑一遍。
    //
    // 为什么不能只靠这个处理器自己设:`onFocus` 拿到的是**它那一次渲染的闭包**,
    // 若焦点事件在"rows 已更新、但持有新 rows 的那次渲染尚未把处理器换上去"之间到达,
    // 这里读到的就是旧的空 rows,`moveTo(0)` 找不到落点直接返回。
    // 而补设 effect 原本只在 rows / activePath 变化时重跑 —— 那两者此刻都已经稳定了,
    // 于是永远等不到重试。**焦点到达本身必须也是一个触发点。**
    // (实测表现:目录树有 14 行、容器确实持有焦点,却始终没有活动行,偶发。)
    setFocusTick((t) => t + 1)
    if (activePath) return
    const sel = selectedFile.value
    if (sel) {
      const key = sel.path.join('/')
      const i = rows.findIndex((r) => r.type === 'node' && r.node.path.join('/') === key)
      if (i >= 0) {
        setActivePath(sel.path)
        ensureVisible(i)
        return
      }
    }
    moveTo(0)
  }

  const onRowClick = (node: TreeNode) => {
    // 鼠标点击也要把键盘光标移到该行:容器带 tabIndex,点击行会先让容器获得焦点,
    // 而 focus 早于 click —— 若不在这里同步,onTreeFocus 会因为"此刻还没有选中文件"
    // 把活动行落到第 0 行,用户点完文件再按 ↓ 就会跳回顶部。
    setActivePath(node.path)
    if (node.kind === 'dir') {
      toggleDir(node)
    } else {
      // 点击即重读:selectFile 每次生成新 nonce,预览层据此重新读取磁盘内容
      selectFile(node.handle as FileSystemFileHandle, node.path)
    }
  }

  const rootNode = treeRoot.value
  const rootLoading = rootNode != null && rootNode.loading && !rootNode.children
  const rootError = rootNode?.error

  return (
    <>
      <div class="sidebar-header">
        <span>{t('tree.explorer')}</span>
        <span class="spacer" />
        <button
          title={t('tree.refresh')}
          disabled={treeRefreshing.value}
          onClick={() => {
            // 刷新即推进代次:在途的引用扫描与全文搜索必须立即取消,
            // 否则旧目录结构下的结果会和重建后的索引混在一起(spec 要求不混排)
            closeReferences()
            closeContentSearch()
            void refreshTree()
            // 刷新后搜索索引同步重建,保证搜索结果与最新目录结构一致
            const root = rootHandle.value
            if (root) startIndex(root)
          }}
        >
          {treeRefreshing.value ? '⟳' : '↻'}
        </button>
      </div>
      {rootError && <div class="tree-status" style="color: var(--error)">{t('tree.readDirFailed', { error: rootError })}</div>}
      {rootLoading && <div class="tree-status">{t('welcome.loading')}</div>}
      <div
        class={`tree${scrolling ? ' scrolling' : ''}`}
        ref={containerRef}
        role="tree"
        tabIndex={0}
        aria-label={t('tree.explorerTreeLabel')}
        aria-activedescendant={activePath ? rowId(activePath) : undefined}
        // 处理器挂在容器上:搜索框聚焦时按键根本不进树,
        // 用焦点归属天然分流,不写"判断焦点在不在别处"的防御逻辑
        onKeyDown={(e) => onTreeKeyDown(e as unknown as KeyboardEvent)}
        onFocus={onTreeFocus}
        onScroll={(e) => {
          setScrollTop((e.currentTarget as HTMLDivElement).scrollTop)
          // 滚动期间关掉行过渡:同一个 .tree-row 元素会被赋予不同内容,
          // 背景过渡会把上一行的颜色往这一行补间,快速滚动时表现为拖影
          setScrolling(true)
          if (scrollIdle.current) clearTimeout(scrollIdle.current)
          scrollIdle.current = setTimeout(() => setScrolling(false), 120)
        }}
      >
        <div class="tree-inner" style={{ height: `${total * ROW_HEIGHT}px` }}>
          {rows.slice(start, end).map((row, i) => (
            <div
              key={row.key}
              style={{ position: 'absolute', top: `${(start + i) * ROW_HEIGHT}px`, left: 0, right: 0, height: `${ROW_HEIGHT}px` }}
            >
              <Row
                row={row}
                onClick={onRowClick}
                isActive={row.type === 'node' && activePath != null && row.node.path.join('/') === activePath.join('/')}
              />
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

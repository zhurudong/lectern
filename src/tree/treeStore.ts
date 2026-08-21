import { signal } from '@preact/signals'
import { isExcludedDirName } from '../lib/excluded'

// 目录树数据层(file-tree spec):
// - 惰性加载:仅在目录首次展开时读取其直接子条目,绝不预扫全树(design.md D4)。
// - 分批入列:千级条目目录的 entries() 异步迭代耗时可感知,每 BATCH 条先上屏。
// - 数据结构为可变树 + 版本号信号,UI 侧按版本号重算"已展开节点的扁平化列表"。

const BATCH = 300

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export interface TreeNode {
  name: string
  kind: 'dir' | 'file'
  /** 相对项目根的路径段 */
  path: string[]
  handle: FileSystemDirectoryHandle | FileSystemFileHandle
  depth: number
  expanded: boolean
  /** 目录:子条目是否已完整读取 */
  loaded: boolean
  loading: boolean
  children: TreeNode[] | null
  /**
   * 被默认排除的子目录(`node_modules` / `.git` 等)。
   * 它们**被读到了、只是默认不显示** —— 排除必须可见且可逆,不能静默吞掉。
   */
  hiddenChildren: TreeNode[] | null
  /** 用户是否已展开该层的被排除项(会话内保持;刷新目录树后回到默认排除态) */
  hiddenExpanded: boolean
  error: string | null
}

/** 树结构变更版本号:UI 订阅它来重算扁平列表 */
export const treeVersion = signal(0)
export const treeRoot = signal<TreeNode | null>(null)
export const treeRefreshing = signal(false)

function bump() {
  treeVersion.value++
}

function sortNodes(nodes: TreeNode[]): TreeNode[] {
  // 目录优先,同类按名称自然排序
  return nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
    return collator.compare(a.name, b.name)
  })
}

function makeNode(
  name: string,
  handle: FileSystemDirectoryHandle | FileSystemFileHandle,
  parent: TreeNode,
): TreeNode {
  return {
    name,
    kind: handle.kind === 'directory' ? 'dir' : 'file',
    path: [...parent.path, name],
    handle,
    depth: parent.depth + 1,
    expanded: false,
    loaded: false,
    loading: false,
    children: null,
    hiddenChildren: null,
    hiddenExpanded: false,
    error: null,
  }
}

async function loadChildren(node: TreeNode): Promise<void> {
  if (node.loading || node.kind !== 'dir') return
  node.loading = true
  node.error = null
  bump()
  try {
    const collected: TreeNode[] = []
    const hidden: TreeNode[] = []
    let sinceFlush = 0
    for await (const [name, handle] of (node.handle as FileSystemDirectoryHandle).entries()) {
      // 排除判定与索引侧共用 lib/excluded 的同一个函数,不在这里另抄一份名单
      if (handle.kind === 'directory' && isExcludedDirName(name)) {
        hidden.push(makeNode(name, handle, node))
        continue
      }
      collected.push(makeNode(name, handle, node))
      // 分批入列:先按当前已收集内容排序上屏,不等迭代结束
      if (++sinceFlush >= BATCH) {
        node.children = sortNodes([...collected])
        sinceFlush = 0
        bump()
      }
    }
    node.children = sortNodes(collected)
    node.hiddenChildren = hidden.length > 0 ? sortNodes(hidden) : null
    // 重新加载这一层 = 回到默认排除态。
    //
    // 刷新时 children 会被重建,但**节点对象本身是复用的**,而 hiddenExpanded 挂在
    // 父节点上 —— 不在这里显式复位,展开过的被排除目录会跨刷新残留。
    // (展开/折叠目录不会重复调 loadChildren,所以这里不会误伤会话内的展开状态。)
    node.hiddenExpanded = false
    node.loaded = true
  } catch (err) {
    node.children = node.children ?? []
    node.error = err instanceof Error ? err.message : String(err)
  } finally {
    node.loading = false
    bump()
  }
}

/** 打开项目:建根节点并读取第一层 */
export async function initTree(root: FileSystemDirectoryHandle): Promise<void> {
  const rootNode: TreeNode = {
    name: root.name,
    kind: 'dir',
    path: [],
    handle: root,
    depth: -1,
    expanded: true,
    loaded: false,
    loading: false,
    children: null,
    hiddenChildren: null,
    hiddenExpanded: false,
    error: null,
  }
  treeRoot.value = rootNode
  bump()
  await loadChildren(rootNode)
}

/** 展开/折叠该层的"被排除项" */
export function toggleHidden(node: TreeNode): void {
  node.hiddenExpanded = !node.hiddenExpanded
  bump()
}

/** 展开/折叠目录;首次展开触发惰性加载 */
export function toggleDir(node: TreeNode): void {
  if (node.kind !== 'dir') return
  node.expanded = !node.expanded
  if (node.expanded && !node.loaded && !node.loading) {
    void loadChildren(node)
  }
  bump()
}

/** 虚拟滚动的行模型:普通节点行,或目录展开中的"加载中"占位行 */
export type TreeRow =
  | { type: 'node'; node: TreeNode; key: string }
  | { type: 'loading'; depth: number; key: string }
  /** "已隐藏 N 项"提示行:它不是一个目录,是该层被排除项的入口 */
  | { type: 'hidden'; parent: TreeNode; count: number; expanded: boolean; depth: number; key: string }

/** 扁平化当前可见行(已展开路径下的所有条目 + 加载占位) */
export function visibleRows(): TreeRow[] {
  const out: TreeRow[] = []
  const walk = (n: TreeNode) => {
    if (n.expanded && !n.children && n.loading) {
      out.push({ type: 'loading', depth: n.depth + 1, key: n.path.join('/') + '/…' })
      return
    }
    if (!n.children) return
    for (const c of n.children) {
      out.push({ type: 'node', node: c, key: c.path.join('/') })
      if (c.kind === 'dir' && c.expanded) walk(c)
    }
    // 该层若有被排除项,在末尾产出一行提示;展开后把它们按普通行接着列出。
    // 复用既有行模型 —— 虚拟滚动、行高、滚动定位全部照旧,不新建渲染通道。
    if (n.hiddenChildren && n.hiddenChildren.length > 0) {
      out.push({
        type: 'hidden',
        parent: n,
        count: n.hiddenChildren.length,
        expanded: n.hiddenExpanded,
        depth: n.depth + 1,
        key: n.path.join('/') + '/…hidden',
      })
      if (n.hiddenExpanded) {
        for (const c of n.hiddenChildren) {
          out.push({ type: 'node', node: c, key: c.path.join('/') })
          if (c.kind === 'dir' && c.expanded) walk(c)
        }
      }
    }
  }
  const root = treeRoot.value
  if (root) walk(root)
  return out
}

function collectExpandedPaths(node: TreeNode, out: string[][]): void {
  if (!node.children) return
  for (const c of node.children) {
    if (c.kind === 'dir' && c.expanded) {
      out.push(c.path)
      collectExpandedPaths(c, out)
    }
  }
}

function findByPath(path: string[]): TreeNode | null {
  let cur = treeRoot.value
  for (const seg of path) {
    if (!cur?.children) return null
    const next = cur.children.find((c) => c.name === seg)
    if (!next) return null
    cur = next
  }
  return cur
}

/**
 * 手动刷新:重读整棵已展开的层级,按路径恢复展开态(已消失的节点自然丢弃)。
 * 选中态基于路径比较,路径仍存在则高亮自动保持。
 */
export async function refreshTree(): Promise<void> {
  const root = treeRoot.value
  if (!root || treeRefreshing.value) return
  treeRefreshing.value = true
  try {
    const expanded: string[][] = []
    collectExpandedPaths(root, expanded)
    // 浅层在前,保证父目录先加载完成
    expanded.sort((a, b) => a.length - b.length)

    root.children = null
    root.loaded = false
    bump()
    await loadChildren(root)

    for (const path of expanded) {
      const node = findByPath(path)
      if (node && node.kind === 'dir') {
        node.expanded = true
        if (!node.loaded && !node.loading) {
          await loadChildren(node)
        }
      }
    }
    bump()
  } finally {
    treeRefreshing.value = false
  }
}

/**
 * 展开到指定文件路径的所有祖先目录(Markdown 项目内链接导航时同步树选中态用),
 * 逐层惰性加载,任何一层缺失即停止(best-effort)。
 */
export async function revealPath(path: string[]): Promise<void> {
  const root = treeRoot.value
  if (!root) return
  let cur: TreeNode = root
  for (const seg of path.slice(0, -1)) {
    if (!cur.loaded && !cur.loading) await loadChildren(cur)
    const next = cur.children?.find((c) => c.name === seg && c.kind === 'dir')
    if (!next) return
    next.expanded = true
    if (!next.loaded && !next.loading) await loadChildren(next)
    cur = next
  }
  bump()
}

/** 关闭项目时清空树 */
export function clearTree(): void {
  treeRoot.value = null
  bump()
}

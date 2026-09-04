import type { Lang } from './index'

// 翻译表:key → 文案,按语言分组。key 命名空间化(`面板.用途`)。
//
// **样板阶段范围**:本文件目前只承载「入口页(welcome.*)」与「顶栏语言开关(topbar.lang*)」——
// 用来证明机制端到端可行(切换即时重渲染 + 占位符插值 + 缺键回退)。其余面板的 key 待 PM
// 审过方案后按 tasks.md 分批迁入,MUST NOT 在方案通过前整片翻译(见 proposal.md)。
//
// 约定:
// - 占位符用 `{name}`,由 `t(key, { name })` 替换。
// - 英文缺某个 key 时,`t()` 回退到中文原文 —— 所以迁移期这里可以只补一部分英文。

type Dict = Record<string, string>

const zh: Dict = {
  // —— 顶栏语言开关 ——
  'topbar.langToggleTitle': '切换界面语言(当前:中文)',

  // —— 入口页 ——
  'welcome.subtitle': '零网络、只读的本地代码阅读器 · 全部在本地完成',
  'welcome.openFolder': '打开文件夹',
  'welcome.openFile': '打开文件',
  'welcome.recentTitle': '最近项目',
  'welcome.loading': '加载中…',
  'welcome.recentEmpty': '暂无最近项目,先打开一个文件夹吧',
  'welcome.removeFromList': '从列表移除',
  'welcome.errDenied': '未获得访问授权,可重试或从列表移除',
  'welcome.errGone': '目录不可用(可能已删除或移动),可从列表移除',
  'welcome.hint':
    '首次打开目录后,重启浏览器可从最近项目一键重连;浏览器可能会请求一次访问确认。' +
    '部分受保护目录(如系统目录、下载根目录)无法选择,请改选其子目录。',
  'welcome.justNow': '刚刚',
  'welcome.minutesAgo': '{n} 分钟前',
  'welcome.hoursAgo': '{n} 小时前',
  'welcome.daysAgo': '{n} 天前',
}

const en: Dict = {
  // —— Top bar language switch ——
  'topbar.langToggleTitle': 'Switch language (current: English)',

  // —— Welcome screen ——
  'welcome.subtitle': 'A zero-network, read-only local code reader · everything runs locally',
  'welcome.openFolder': 'Open Folder',
  'welcome.openFile': 'Open File',
  'welcome.recentTitle': 'Recent Projects',
  'welcome.loading': 'Loading…',
  'welcome.recentEmpty': 'No recent projects yet — open a folder to get started',
  'welcome.removeFromList': 'Remove from list',
  'welcome.errDenied': 'Access was not granted. Retry, or remove it from the list.',
  'welcome.errGone': 'Folder unavailable (it may have been deleted or moved). You can remove it from the list.',
  'welcome.hint':
    'After opening a folder once, you can reconnect it in one click from Recent Projects after restarting the browser; ' +
    'the browser may ask you to confirm access again. Some protected folders (system folders, the Downloads root) ' +
    'cannot be selected — choose a subfolder instead.',
  'welcome.justNow': 'just now',
  'welcome.minutesAgo': '{n} min ago',
  'welcome.hoursAgo': '{n} h ago',
  'welcome.daysAgo': '{n} d ago',
}

export const messages: Record<Lang, Dict> = { zh, en }

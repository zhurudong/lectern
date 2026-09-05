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

  // —— 顶栏 ——
  'topbar.home': '首页',
  'topbar.homeTitle': '回到入口页',
  'topbar.helpTitle': '键盘操作',
  'topbar.themeTitle': '切换浅色/暗色主题',
  'topbar.themeDark': '🌙 暗色',
  'topbar.themeLight': '☀️ 浅色',

  // —— 符号索引状态 ——
  'index.statusTitle': '符号索引状态',
  'index.building': '索引构建中…已索引 {n} 个文件',
  'index.done': '索引已完成({files} 个文件 / {symbols} 个符号)',
  'index.partial': '项目过大,符号索引仅部分完成(已索引 {n} 个文件)',
  'index.unavailable': '符号索引不可用',

  // —— 应用外壳 / 项目视图 ——
  'app.projectViewLabel': '项目视图',
  'app.tabFiles': '文件',
  'app.tabChanges': '变更',
  'app.loadingGit': '正在载入 Git 对比…',

  // —— 目录树 ——
  'tree.explorer': '资源管理器',
  'tree.explorerTreeLabel': '资源管理器目录树',
  'tree.refresh': '刷新目录树',
  'tree.collapseExcluded': '收起被排除的目录',
  'tree.hiddenTitle':
    '已隐藏 {count} 项(node_modules / .git 等重目录),点击展开;展开后可浏览,但它们不参与项目级搜索与跳转',
  'tree.hiddenLabel': '已隐藏 {count} 项',
  'tree.readFailed': '读取失败:{error}',
  'tree.readDirFailed': '读取目录失败:{error}',

  // —— 顶部搜索 ——
  'search.phFile': '搜索文件名(⌘K / Ctrl+K)',
  'search.phSymbolMac': '搜索符号(⌘⇧O)',
  'search.phSymbol': '搜索符号',
  'search.phContentMac': '搜索文件内容(⌘⇧F)',
  'search.phContent': '搜索文件内容',
  'search.modeFile': '文件名',
  'search.modeFileTitle': '按文件名搜索(不含文件内容)',
  'search.modeSymbol': '符号',
  'search.modeSymbolTitle': '按符号名搜索项目内的类型、函数、方法与常量',
  'search.modeContent': '全文',
  'search.modeContentTitle': '在项目内所有文本文件的正文中搜索',
  'search.noMatchIndexing': '暂无匹配(索引仍在构建)',
  'search.noMatchFile': '无匹配文件',
  'search.indexNotReady': '索引未就绪',
  'search.partialResults': '索引构建中…已索引 {n} 个文件,以下为部分结果',
  'search.noMatchSymbolBuilding': '索引构建中…已索引 {n} 个文件,暂无匹配符号',
  'search.noMatchSymbol': '无匹配符号',

  // —— 全文搜索面板 ——
  'content.tooShort': '关键词过短,至少输入 {n} 个字符',
  'content.scanning': '扫描中… {scanned}/{total} 个文件',
  'content.done': '扫描完成(共扫描 {n} 个文件)',
  'content.cancelled': '已取消',
  'content.truncated': '已达上限 {limit} 条,结果已截断',
  'content.title': '全文搜索 “{q}” · {hits} 处 / {files} 个文件',
  'content.caseSensitive': '区分大小写',
  'content.stop': '停止扫描',
  'content.stopBtn': '停止',
  'content.close': '关闭全文搜索',
  'content.resultsLabel': '全文搜索结果',
  'content.tooShortEmpty': '关键词过短,未启动全项目扫描。',
  'content.scanningShort': '扫描中…',
  'content.noMatch': '未找到匹配内容',
  'content.filePartial': '文件过大,仅搜索了开头部分',

  // —— 文件大纲 ——
  'outline.expand': '展开大纲',
  'outline.collapsedLabel': '‹ 大纲',
  'outline.title': '大纲',
  'outline.collapse': '折叠大纲',
  'outline.singleNotePre': '单文件模式:跳转仅限本文件内;',
  'outline.singleNoteStrong': '查找引用与全局符号搜索需要打开所在文件夹。',
  'outline.notOpen': '未打开文件',
  'outline.parsing': '解析中…',
  'outline.unsupported': '{language} 暂不支持大纲',
  'outline.unsupportedSub': '该语言不参与代码理解,语法高亮与预览不受影响。',
  'outline.tooLarge': '文件过大,符号未被索引',
  'outline.tooLargeSub': '超过 5 MB 的文件不参与符号抽取,大纲与跳转不覆盖该文件。',
  'outline.parseError': '该文件解析失败,无法生成大纲',
  'outline.noDefs': '该文件未发现可列出的定义',
  'outline.lineN': '第 {line} 行',

  // —— 符号种类(徽标 tooltip)——
  'kind.class': '类',
  'kind.interface': '接口',
  'kind.enum': '枚举',
  'kind.struct': '结构体',
  'kind.func': '函数',
  'kind.method': '方法',
  'kind.field': '字段',
  'kind.constant': '常量',
  'kind.variable': '变量',
  'kind.type': '类型',
  'kind.namespace': '命名空间',
  'kind.macro': '宏',
  'kind.ctor': '构造函数',
  'kind.heading': '标题',
  'kind.declaration': '声明',

  // —— 查找引用面板 ——
  'ref.done': '扫描完成',
  'ref.title': '“{name}” 的引用 · {hits} 处 / {files} 个文件',
  'ref.close': '关闭引用面板',
  'ref.hint': '结果基于名称匹配,可能包含同名但无关的位置;注释与字符串字面量中的同名文本已排除。',
  'ref.resultsLabel': '引用结果',
  'ref.noRefs': '未找到引用',

  // —— 预览区能力标识 ——
  'intel.idxBuilding': '索引构建中 {n}',
  'intel.idxDone': '索引已完成',
  'intel.idxPartial': '索引仅部分完成',
  'intel.capFull': '可跳转',
  'intel.capFullTitle': '该语言支持大纲、跳转到定义与查找引用(基于名称与语法树的启发式匹配,不做类型推断)',
  'intel.capOutline': '仅大纲',
  'intel.capOutlineTitle': 'Markdown 仅提供标题大纲,不支持跳转与查找引用',
  'intel.capApprox': '近似高亮',
  'intel.capApproxTitle': '单文件组件按 HTML 超集近似高亮:<script> / <style> 块正确,模板指令(v-if / {#if} 等)不保证准确;不参与代码理解',
  'intel.capNone': '仅高亮',
  'intel.capNoneTitle': '该语言不参与代码理解,仅提供语法高亮与预览',

  // —— 通用 ——
  'common.close': '关闭',

  // —— 代码理解浮层 / 候选 / 导航 ——
  'intel.candLabel': '同名定义候选',
  'intel.candHeader': '“{name}” 有 {n} 处同名定义,请选择',
  'intel.candHint': '结果基于名称与语法树的启发式匹配,不做类型推断,可能包含同名但无关的定义。',
  'intel.refNeedsProject': '需要打开文件夹才能在项目内查找引用',
  'intel.needProject': '(需打开文件夹)',
  'nav.back': '后退',
  'nav.backKey': '后退(⌥←)',
  'nav.forward': '前进',
  'nav.forwardKey': '前进(⌥→)',

  // —— 键盘帮助面板 ——
  'help.note': '未列出的键位表示在当前平台尚未经真机核验,因此既不绑定也不提示;这些能力都另有界面入口。',
  'group.面板': '面板',
  'group.目录树': '目录树',
  'group.代码区': '代码区',
  'group.对比': '对比',
  'group.大纲': '大纲',
  'group.搜索': '搜索',
  'keys.switchPanel': '在目录树 / 代码区 / 大纲之间切换焦点',
  'keys.closeHelp': '关闭本面板',
  'keys.moveCursor': '移动光标(上下左右 / 翻页 / 行首行尾)',
  'keys.jumpToDefinition': '跳转到定义',
  'keys.findReferences': '查找引用',
  'keys.treeNav': '移动 / 展开 / 折叠 / 打开',
  'keys.outlineNav': '选择条目 / 定位到该行',
  'keys.fileSearch': '文件名搜索',
  'keys.symbolSearch': '符号搜索',
  'keys.contentSearch': '全文搜索',
  'keys.previousHunk': '上一处差异',
  'keys.nextHunk': '下一处差异',
  'keys.exitCompare': '退出对比',

  // —— 预览区外壳 ——
  'preview.placeholder': '在左侧选择一个文件开始预览',
  'preview.compareActive': '正在对比 —— 点此改选对比目标',
  'preview.compareEntry': '与项目内的另一个文件并排对比',
  'preview.compareBtn': '对比文件',
  'preview.bodyLabel': '预览区',
  'preview.excludedNotice':
    '此目录默认不参与项目级搜索与跳转(依赖包 / 版本库等重目录)—— 文件可以正常预览与查看大纲,但**不会**出现在文件名搜索、符号搜索与全文搜索结果中。',
  'preview.readFailed': '读取 {name} 失败:{message}',
  'preview.readFailedHint': '文件可能已被外部删除或移动,可刷新目录树后重试。',
  'preview.truncated': '文件过大({size}),已截断展示前 {limit}',
  'preview.truncatedIntel': ';该文件超过 5 MB,符号索引受限,大纲与跳转不覆盖此文件',

  // —— 文件对比视图 ——
  'compare.badge': '文件对比',
  'compare.navPrev': '‹ 上一处',
  'compare.navNext': '下一处 ›',
  'compare.navPrevTitleKey': '上一处差异({key})',
  'compare.navNextTitleKey': '下一处差异({key})',
  'compare.exitTitle': '退出对比(Esc)',
  'compare.narrow': '窗口较窄,并排对比会比较拥挤。可折叠左侧目录树或右侧大纲以腾出空间;两栏仍可各自横向滚动查看完整内容。',
  'compare.reliabilityPrefix': '本次对比结论可能不可靠:',
  'compare.truncWhichBoth': '两侧文件都',
  'compare.truncWhichCur': '当前文件',
  'compare.truncWhichTarget': '对比目标',
  'compare.truncated': '{which}过大已被截断,本次只对比了已加载部分;未加载部分的差异未知(不要把"后面没有差异"当作结论)。',
  'compare.approx': '差异计算超出工作量预算,已改用近似比对,结果可能与实际不符(典型是把小改动放大成"整份都变了")。',
  'compare.errUnreadable': '读不到对比目标 “{name}”:{message}。它可能已被删除、移动,或授权已失效 —— 退出对比即可继续查看当前文件。',
  'compare.errNotText': '“{name}” 不是文本文件,无法按文本对比 —— 退出对比即可继续查看当前文件。',

  // —— 对比目标选择器 ——
  'cmpPick.dialogLabel': '选择对比目标',
  'cmpPick.title': '选择要与当前文件对比的另一个文件',
  'cmpPick.needProjectPre': '文件对比需要先打开一个',
  'cmpPick.needProjectBold': '项目(文件夹)',
  'cmpPick.needProjectPost': '才能选取对比目标。 当前是单文件模式,没有项目树,因而没有可选的另一个文件。',
  'cmpPick.searchPh': '按文件名搜索项目内的文件',
  'cmpPick.startTyping': '输入文件名开始搜索',
  'cmpPick.noticeNeedProject': '文件对比需要先打开一个项目',
  'cmpPick.noticeSameFile': '这是当前正在预览的文件 —— 请选择另一个文件来对比',
  'cmpPick.kindImage': '图片',
  'cmpPick.kindBinary': '二进制',
  'cmpPick.noticeNotText': '“{name}” 是{kind}文件,不能按文本对比',
  'cmpPick.noticeUnreadable': '读不到 “{name}”:它可能已被删除、移动,或授权已失效',

  // —— Markdown 预览 / 二进制 / 代码区 / Markdown 占位 ——
  'mdview.tabRendered': '渲染',
  'mdview.tabSource': '源码',
  'mdview.rendering': '渲染中…',
  'binary.unsupported': '暂不支持预览此类型的文件',
  'code.outOfRange': '目标行 {line} 超出当前可定位范围(共 {total} 行,大文件已截断展示),已定位到最近位置',
  'md.imageAlt': '图片',
  'md.linkUnresolved': '链接目标无法解析',
  'md.imgNoSrc': '缺少图片地址',
  'md.imgRemote': '远程图片不自动加载(零网络边界)',
  'md.imgNoContext': '单文件模式无目录上下文,无法解析相对路径',
  'md.imgRelUnresolved': '相对路径无法解析(文件不存在或越出项目)',
  'md.imgReadFailed': '图片读取失败',
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

  // —— Top bar ——
  'topbar.home': 'Home',
  'topbar.homeTitle': 'Back to start screen',
  'topbar.helpTitle': 'Keyboard shortcuts',
  'topbar.themeTitle': 'Toggle light / dark theme',
  'topbar.themeDark': '🌙 Dark',
  'topbar.themeLight': '☀️ Light',

  // —— Symbol index status ——
  'index.statusTitle': 'Symbol index status',
  'index.building': 'Indexing… {n} files so far',
  'index.done': 'Index complete ({files} files / {symbols} symbols)',
  'index.partial': 'Project too large; symbol index only partially built ({n} files indexed)',
  'index.unavailable': 'Symbol index unavailable',

  // —— App shell / project views ——
  'app.projectViewLabel': 'Project view',
  'app.tabFiles': 'Files',
  'app.tabChanges': 'Changes',
  'app.loadingGit': 'Loading Git comparison…',

  // —— File tree ——
  'tree.explorer': 'Explorer',
  'tree.explorerTreeLabel': 'Explorer file tree',
  'tree.refresh': 'Refresh file tree',
  'tree.collapseExcluded': 'Collapse excluded folders',
  'tree.hiddenTitle':
    'Hidden {count} items (heavy folders such as node_modules / .git). Click to expand; you can browse them, but they are excluded from project-wide search and jumps.',
  'tree.hiddenLabel': 'Hidden {count} items',
  'tree.readFailed': 'Read failed: {error}',
  'tree.readDirFailed': 'Failed to read folder: {error}',

  // —— Top search ——
  'search.phFile': 'Search file names (⌘K / Ctrl+K)',
  'search.phSymbolMac': 'Search symbols (⌘⇧O)',
  'search.phSymbol': 'Search symbols',
  'search.phContentMac': 'Search file contents (⌘⇧F)',
  'search.phContent': 'Search file contents',
  'search.modeFile': 'Names',
  'search.modeFileTitle': 'Search by file name (not contents)',
  'search.modeSymbol': 'Symbols',
  'search.modeSymbolTitle': 'Search project types, functions, methods and constants by symbol name',
  'search.modeContent': 'Content',
  'search.modeContentTitle': 'Search within the text of every file in the project',
  'search.noMatchIndexing': 'No matches yet (index still building)',
  'search.noMatchFile': 'No matching files',
  'search.indexNotReady': 'Index not ready',
  'search.partialResults': 'Indexing… {n} files indexed; partial results below',
  'search.noMatchSymbolBuilding': 'Indexing… {n} files indexed; no matching symbols yet',
  'search.noMatchSymbol': 'No matching symbols',

  // —— Content search panel ——
  'content.tooShort': 'Query too short — type at least {n} characters',
  'content.scanning': 'Scanning… {scanned}/{total} files',
  'content.done': 'Scan complete ({n} files scanned)',
  'content.cancelled': 'Cancelled',
  'content.truncated': 'Reached the {limit}-match limit; results truncated',
  'content.title': 'Content search “{q}” · {hits} matches / {files} files',
  'content.caseSensitive': 'Match case',
  'content.stop': 'Stop scanning',
  'content.stopBtn': 'Stop',
  'content.close': 'Close content search',
  'content.resultsLabel': 'Content search results',
  'content.tooShortEmpty': 'Query too short — project-wide scan not started.',
  'content.scanningShort': 'Scanning…',
  'content.noMatch': 'No matching content found',
  'content.filePartial': 'File too large — only the beginning was searched',

  // —— File outline ——
  'outline.expand': 'Expand outline',
  'outline.collapsedLabel': '‹ Outline',
  'outline.title': 'Outline',
  'outline.collapse': 'Collapse outline',
  'outline.singleNotePre': 'Single-file mode: jumps are limited to this file; ',
  'outline.singleNoteStrong': 'Find references and project-wide symbol search require opening the containing folder.',
  'outline.notOpen': 'No file open',
  'outline.parsing': 'Parsing…',
  'outline.unsupported': 'Outline not supported for {language}',
  'outline.unsupportedSub': 'This language is not part of code intelligence; syntax highlighting and preview are unaffected.',
  'outline.tooLarge': 'File too large — symbols not indexed',
  'outline.tooLargeSub': 'Files over 5 MB are excluded from symbol extraction; outline and jumps do not cover this file.',
  'outline.parseError': 'Failed to parse this file; no outline available',
  'outline.noDefs': 'No listable definitions found in this file',
  'outline.lineN': 'line {line}',

  // —— Symbol kinds (badge tooltip) ——
  'kind.class': 'Class',
  'kind.interface': 'Interface',
  'kind.enum': 'Enum',
  'kind.struct': 'Struct',
  'kind.func': 'Function',
  'kind.method': 'Method',
  'kind.field': 'Field',
  'kind.constant': 'Constant',
  'kind.variable': 'Variable',
  'kind.type': 'Type',
  'kind.namespace': 'Namespace',
  'kind.macro': 'Macro',
  'kind.ctor': 'Constructor',
  'kind.heading': 'Heading',
  'kind.declaration': 'Declaration',

  // —— Find-references panel ——
  'ref.done': 'Scan complete',
  'ref.title': 'References to “{name}” · {hits} matches / {files} files',
  'ref.close': 'Close references panel',
  'ref.hint': 'Results are name-based and may include unrelated same-named locations; same-named text in comments and string literals is excluded.',
  'ref.resultsLabel': 'Reference results',
  'ref.noRefs': 'No references found',

  // —— Preview capability badge ——
  'intel.idxBuilding': 'Indexing {n}',
  'intel.idxDone': 'Index complete',
  'intel.idxPartial': 'Index partial',
  'intel.capFull': 'Navigable',
  'intel.capFullTitle': 'This language supports outline, jump-to-definition and find-references (heuristic matching on names and the syntax tree; no type inference)',
  'intel.capOutline': 'Outline only',
  'intel.capOutlineTitle': 'Markdown provides a heading outline only; no jump or find-references',
  'intel.capApprox': 'Approximate highlighting',
  'intel.capApproxTitle': 'Single-file components use approximate HTML-superset highlighting: <script> / <style> blocks are correct, but template directives (v-if, {#if}, etc.) may be inaccurate; not part of code intelligence',
  'intel.capNone': 'Highlight only',
  'intel.capNoneTitle': 'This language is not part of code intelligence; syntax highlighting and preview only',

  // —— Common ——
  'common.close': 'Close',

  // —— Code-intelligence overlay / candidates / navigation ——
  'intel.candLabel': 'Same-named definition candidates',
  'intel.candHeader': '“{name}” has {n} same-named definitions — pick one',
  'intel.candHint': 'Results use heuristic matching on names and the syntax tree without type inference, and may include unrelated same-named definitions.',
  'intel.refNeedsProject': 'Open a folder to find references across the project',
  'intel.needProject': '(open a folder)',
  'nav.back': 'Back',
  'nav.backKey': 'Back (⌥←)',
  'nav.forward': 'Forward',
  'nav.forwardKey': 'Forward (⌥→)',

  // —— Keyboard help panel ——
  'help.note': 'Shortcuts not listed here have not been verified on this platform, so they are neither bound nor shown; each of those capabilities has a UI entry point too.',
  'group.面板': 'Panels',
  'group.目录树': 'File tree',
  'group.代码区': 'Editor',
  'group.对比': 'Compare',
  'group.大纲': 'Outline',
  'group.搜索': 'Search',
  'keys.switchPanel': 'Move focus between file tree / editor / outline',
  'keys.closeHelp': 'Close this panel',
  'keys.moveCursor': 'Move the cursor (arrows / page / line start-end)',
  'keys.jumpToDefinition': 'Jump to definition',
  'keys.findReferences': 'Find references',
  'keys.treeNav': 'Move / expand / collapse / open',
  'keys.outlineNav': 'Select an entry / jump to its line',
  'keys.fileSearch': 'File name search',
  'keys.symbolSearch': 'Symbol search',
  'keys.contentSearch': 'Content search',
  'keys.previousHunk': 'Previous difference',
  'keys.nextHunk': 'Next difference',
  'keys.exitCompare': 'Exit compare',

  // —— Preview shell ——
  'preview.placeholder': 'Select a file on the left to preview',
  'preview.compareActive': 'Comparing — click to change the compare target',
  'preview.compareEntry': 'Compare side by side with another file in the project',
  'preview.compareBtn': 'Compare file',
  'preview.bodyLabel': 'Preview',
  'preview.excludedNotice':
    'This folder is excluded from project-wide search and jumps by default (dependency / version-control heavy folders) — files still preview and outline normally, but they do **not** appear in file-name, symbol, or content search results.',
  'preview.readFailed': 'Failed to read {name}: {message}',
  'preview.readFailedHint': 'The file may have been deleted or moved externally; refresh the file tree and try again.',
  'preview.truncated': 'File too large ({size}); showing the first {limit}',
  'preview.truncatedIntel': '; over 5 MB — symbol indexing is limited, and outline and jumps do not cover this file',

  // —— File compare view ——
  'compare.badge': 'File compare',
  'compare.navPrev': '‹ Previous',
  'compare.navNext': 'Next ›',
  'compare.navPrevTitleKey': 'Previous difference ({key})',
  'compare.navNextTitleKey': 'Next difference ({key})',
  'compare.exitTitle': 'Exit compare (Esc)',
  'compare.narrow': 'The window is narrow, so a side-by-side comparison is cramped. Collapse the file tree on the left or the outline on the right to free up space; both panes still scroll horizontally to show their full content.',
  'compare.reliabilityPrefix': 'This comparison may be unreliable: ',
  'compare.truncWhichBoth': 'Both files are',
  'compare.truncWhichCur': 'The current file is',
  'compare.truncWhichTarget': 'The compare target is',
  'compare.truncated': '{which} too large and truncated, so only the loaded portion was compared; differences in the unloaded portion are unknown (do not treat "no differences after this point" as a conclusion).',
  'compare.approx': 'Diff computation exceeded the work budget and fell back to an approximate comparison, so the result may not match reality (typically inflating a small change into "the whole file changed").',
  'compare.errUnreadable': 'Could not read the compare target "{name}": {message}. It may have been deleted or moved, or access may have expired — exit compare to keep viewing the current file.',
  'compare.errNotText': '"{name}" is not a text file and cannot be compared as text — exit compare to keep viewing the current file.',

  // —— Compare-target picker ——
  'cmpPick.dialogLabel': 'Choose a compare target',
  'cmpPick.title': 'Choose another file to compare with the current one',
  'cmpPick.needProjectPre': 'File compare requires opening a ',
  'cmpPick.needProjectBold': 'project (folder)',
  'cmpPick.needProjectPost': ' to pick a compare target. You are in single-file mode with no project tree, so there is no other file to choose.',
  'cmpPick.searchPh': 'Search files in the project by name',
  'cmpPick.startTyping': 'Type a file name to search',
  'cmpPick.noticeNeedProject': 'File compare requires opening a project first',
  'cmpPick.noticeSameFile': 'This is the file currently open — pick a different file to compare',
  'cmpPick.kindImage': 'an image',
  'cmpPick.kindBinary': 'a binary',
  'cmpPick.noticeNotText': '"{name}" is {kind} file and cannot be compared as text',
  'cmpPick.noticeUnreadable': 'Could not read "{name}": it may have been deleted or moved, or access may have expired',

  // —— Markdown preview / binary / editor / Markdown placeholders ——
  'mdview.tabRendered': 'Rendered',
  'mdview.tabSource': 'Source',
  'mdview.rendering': 'Rendering…',
  'binary.unsupported': 'Preview is not supported for this file type',
  'code.outOfRange': 'Target line {line} is beyond the locatable range ({total} lines; large file shown truncated); jumped to the nearest position',
  'md.imageAlt': 'image',
  'md.linkUnresolved': 'Link target could not be resolved',
  'md.imgNoSrc': 'Missing image source',
  'md.imgRemote': 'Remote images are not loaded automatically (zero-network boundary)',
  'md.imgNoContext': 'Single-file mode has no folder context; relative paths cannot be resolved',
  'md.imgRelUnresolved': 'Relative path could not be resolved (file missing or outside the project)',
  'md.imgReadFailed': 'Failed to load image',
}

export const messages: Record<Lang, Dict> = { zh, en }

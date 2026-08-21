# Design: add-code-viewer-extension

## Context

全新代码库,无历史约束。动机见 proposal.md - Why。关键外部约束:

- Chrome MV3:CSP 禁止远程代码,所有依赖必须本地打包;后台为 service worker(本项目几乎用不到后台逻辑)。
- 用户明确不接受 "允许访问文件网址" 设置门槛 → 排除 `file://` 内容脚本接管路线,采用 File System Access API(FSA)。
- 交互入口因此为:点击扩展图标 → 打开整页查看器(chrome-extension:// 页面)→ 选目录/文件或从最近项目重连。
- 规模目标:约 10,000 文件的项目流畅浏览;当前只读,未来可能加编辑。

## Goals / Non-Goals

**Goals:**

- 一套可长期演进的整页 SPA 架构:入口层 / 文件访问层 / 目录树 / 识别分发 / 渲染通道。
- 浅色/暗色双主题的阅读体验:右上角切换,默认白底浅色(高亮配色参照 VS Code Light/Dark;默认浅色为用户实测反馈选定)。
- 所有处理本地完成,零网络依赖。

**Non-Goals:**

- 编辑与保存(仅保留升级路径,不实现)。
- 全局**内容**搜索、跨文件跳转、Git 集成(后续 change;文件名搜索已纳入本期,见 D4)。
- Firefox/Safari 兼容(FSA API 支持度不同,后续再议)。
- 真正的代码重排(gofmt/black 类格式化)。
- 文本编码检测:仅按 UTF-8 解码,GBK/Latin-1 等其他编码文件会整篇乱码——这是有意识的取舍(见 Risks),不做检测与转换。
- 文件变更自动监听:FSA 无变更通知,FileSystemObserver 尚不能作为基线依赖(见 Open Questions);本期以手动刷新 + 重新点击重读覆盖。

## Decisions

### D1: 文件访问 — File System Access API,而非 file:// 内容脚本

`showDirectoryPicker()` 在扩展页面中调用,返回的 `FileSystemDirectoryHandle` 存入 IndexedDB(句柄本身可结构化克隆)。复访时取出句柄,先 `queryPermission()`,需要时在用户手势内 `requestPermission()`(Chrome 122+ 提供"每次访问都允许"持久授权)。

- 备选:file:// 内容脚本接管——被"不要权限开关"的产品决策排除;解析 Chrome 原生目录页也属非官方行为。
- 推论:放弃"地址栏打开 file:// 自动美化"的体验,入口统一为扩展页。

### D2: 高亮引擎 — CodeMirror 6 只读模式

理由:视口虚拟化(大文件不卡)、目标语言绝大多数有官方 Lezer 包(`@codemirror/lang-python/java/cpp/go/markdown/javascript/json/html/css/sql/yaml/xml`);Shell 无一等 Lezer 包,用官方 `@codemirror/legacy-modes` 的 shell stream 解析器接入(高亮质量略低,阅读够用)。`EditorState.readOnly` 一开即只读、未来去掉只读即得编辑器。主题自建浅色/暗色两套配色(参照 VS Code Light / Dark+;初版仅 Dark+,按用户实测反馈改为浅色默认 + 右上角切换)。两套主题以 CSS 变量 + CM6 主题扩展成对实现,切换时同步换肤界面与编辑器。

- 备选 Shiki:高亮最精致,但一次性输出全量 HTML,大文件卡,无编辑升级路径。
- 备选 Monaco:能力最全但体积数 MB,对扩展过重。
- 备选 highlight.js:轻,但同样是全量染色,且高亮质量一般。

### D3: Markdown — markdown-it + DOMPurify,代码块复用 CM6 高亮

富文本视图用 markdown-it(GFM 风格),输出经 DOMPurify 净化;代码块用对应 Lezer 语法做静态高亮(@lezer/highlight 直接产出带 class 的 span,不为每个代码块起 CM 实例)。源码视图直接走 CM6 的 markdown 语言。

相对资源:渲染后遍历 `<img>`/`<a>`,相对路径基于当前文件所在目录句柄逐段解析(`..` 上溯、段名 `getDirectoryHandle`/`getFileHandle`)——图片解析成功转 objectURL(随文件切换释放),失败或单文件模式给占位符;相对链接指向项目内文件则拦截点击、在查看器内打开并同步树选中,解析失败置灰。远程图片一律替换为占位符(守住零网络边界),外部链接保留默认新标签页行为。

### D4: 目录树 — 惰性加载 + 自研虚拟滚动扁平列表

树在数据层表现为"已展开节点的扁平化列表",UI 只渲染视口内的行(固定行高,虚拟滚动实现简单)。展开目录时 `handle.entries()` 异步读取一层;千级条目目录的异步迭代耗时可感知,采用分批入列渲染(每批若干百条即先上屏),不等全部读完。刷新:手动触发,重读目录后按路径匹配恢复展开与选中态(已消失的节点自然丢弃);文件内容不做缓存,每次点击即重读,天然规避过期内容。树的按需渲染不预扫全树;文件名搜索则由独立的后台索引支撑:打开项目后 Web Worker 增量遍历目录建"路径 → 文件名"索引(与树的惰性加载互不阻塞),顶部搜索框(Cmd/Ctrl+K 聚焦)按子串匹配索引;索引未完成时返回已索引部分并提示进行中。手动刷新目录树时同时使索引失效并触发同一 Worker 重建,保证刷新后搜索结果与最新文件结构一致(不搜到已删文件、不漏新文件)。内容级搜索仍不做(见 Non-Goals)。

- 备选:预扫全树建内存索引——1 万文件下首开慢、内存浪费,且与"打开即用"目标冲突。

### D5: 技术栈 — TypeScript + Vite(CRXJS 或等效插件)+ 轻量 UI 层

Vite 打包满足 MV3 本地化要求。UI 层可用 Svelte/Preact/原生 TS 任一轻量方案,倾向 Preact(体积小、生态熟);状态简单(当前项目、树展开状态、当前文件),无需重状态库。后台并非完全为零:仍需最小 service worker 监听 `chrome.action.onClicked` → `chrome.tabs.create` 打开查看器页,除此之外无后台逻辑。

### D6: 文件读取与降级门限

读文件统一经 `handle.getFile()` → `File`。先读 `file.size`:>5 MB 文本走截断(slice 前 1 MB);二进制嗅探用前 8 KB 中 NUL 字节/不可打印字符比例判断。图片直接 `URL.createObjectURL(file)`。

文本解码统一用 `TextDecoder('utf-8')` 非 fatal 模式;截断读取按字节 slice 可能切断 UTF-8 多字节序列,解码前先丢弃末尾不完整的字节序列(回退至最后一个完整码点),避免截断边界出现乱码替换符。仅支持 UTF-8(见 Non-Goals)。

### D7: 布局与阅读排版(用户实测反馈驱动)

- 分栏:目录树与预览区之间为可拖拽分隔条,侧栏宽度限制在合理区间(约 180–600px),取值持久化到 `localStorage`,下次打开恢复。
- Markdown 排版:渲染视图正文基准字号 16px、行高 ≥1.6,标题/代码块按比例放大——对齐主流阅读器排版,解决初版字体偏小问题。
- 快捷键:Cmd/Ctrl+K 聚焦搜索框(Windows Chrome 上需 preventDefault 拦截地址栏聚焦)。
- 主题切换:右上角浅色/暗色切换控件,默认浅色,选择持久化到 `localStorage`,与侧栏宽度同一存储策略。

## Risks / Trade-offs

- [句柄持久授权体验不确定:扩展页中 `requestPermission` 的弹窗频率取决于 Chrome 版本与用户选择] → 第一周先做 spike 验证;最差情况是每次会话首次重连弹一次授权,产品上可接受,入口页文案做好预期管理。
- [Lezer 对 C/C++ 等语言的高亮精度不如 TextMate 语法] → 接受;阅读场景够用,后续可对个别语言单独优化主题映射。
- [Chrome 原生目录选择器不能选择某些受保护目录(如 ~/Downloads 根、系统目录)] → 无法绕过,错误提示引导用户选择子目录。
- [SVG 作为图片预览可能含脚本] → 用 `<img>` 标签加载(不执行脚本),不用内联注入。
- [虚拟滚动自研引入 UI 复杂度] → 固定行高简化实现;若后续复杂化,可换成熟虚拟列表库。
- [仅按 UTF-8 解码,GBK/Latin-1 等编码文件整篇乱码] → 有意取舍(见 Non-Goals):不做编码检测;README 的已知限制中写明,后续如有需求可引入 jschardet 类检测作为独立增强。
- [无文件变更通知,外部修改后界面内容过期] → 手动刷新 + 点击即重读兜底;FileSystemObserver 成熟后可升级为自动感知(见 Open Questions)。

## Migration Plan

全新项目,无迁移。发布路径:本地 `chrome://extensions` 开发者模式加载 → 后续打包上架 Chrome Web Store(上架事宜不在本 change 内)。

## Open Questions

- 最近项目列表是否需要展示项目路径全路径(FSA 只暴露目录名,不暴露绝对路径)——实现时按 API 实际能力决定展示形式。
- 大文件"加载更多"按钮是否需要,还是仅截断提示——可在实现后按体验微调,不影响规格。
- FileSystemObserver(文件变更自动通知)何时可作为基线依赖——成熟后可把"手动刷新"升级为自动感知,属增量增强,不影响本期规格。

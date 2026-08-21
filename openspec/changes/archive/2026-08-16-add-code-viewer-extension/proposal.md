# Proposal: add-code-viewer-extension

## Why

在浏览器里查看本地代码文件和项目目录时,Chrome 只能展示无高亮的纯文本和简陋的原生目录列表,阅读体验远逊于 IDE。本变更从零构建一个 Chrome 扩展(MV3),提供类似 IDE 的只读代码浏览体验:左侧目录树、右侧带语法高亮的文件预览,覆盖 Markdown/Python/Java/C/C++/Go 等常用语言。

## What Changes

- 新建 Chrome MV3 扩展项目,包含整页查看器应用(chrome-extension:// 页面)。
- 通过 File System Access API(`showDirectoryPicker` / `showOpenFilePicker`)获取目录和文件访问权,不依赖 "允许访问文件网址" 开关。
- 目录句柄持久化到 IndexedDB,提供"最近项目"列表,支持复访重连。
- 左侧目录树:惰性加载(展开哪层读哪层)+ 虚拟滚动,支撑约 10,000 文件规模的项目;侧栏宽度可拖拽调整并记忆。
- 文件名快速搜索:顶部搜索框 + 快捷键(Cmd/Ctrl+K),后台 Worker 建索引,不阻塞首屏(内容级搜索仍不在本期范围)。
- 右侧文件预览:按扩展名识别语言,CodeMirror 6 只读模式渲染(语法高亮 + 行号),Markdown 支持富文本渲染与源码切换(含相对路径图片解析与项目内链接导航),图片原生预览,二进制文件降级提示;浅色/暗色双主题,右上角切换,默认白底浅色。
- 目录树手动刷新与"点击即重读"策略,覆盖外部工具修改文件后的内容过期问题(FSA API 无变更通知)。
- 大文件降级策略(超阈值截断或纯文本模式);文本仅按 UTF-8 解码(显式取舍,不做编码检测)。
- 仅只读浏览;编辑能力不在本变更范围,但选型(CodeMirror 6、FSA API)为其保留升级路径。

## Capabilities

### New Capabilities

- `project-access`: 打开目录/单文件、目录句柄持久化、最近项目重连与权限续期。
- `file-tree`: 目录树的惰性加载、虚拟滚动、展开/折叠与文件选中交互。
- `file-preview`: 文件类型识别与分发渲染——代码高亮、Markdown 渲染/源码切换、图片预览、二进制与大文件降级。

### Modified Capabilities

（无——全新项目,无现有 spec。）

## Impact

- 全新代码库:扩展 manifest(MV3)、查看器整页应用、构建工具链(打包器 + CodeMirror 6 / markdown-it 依赖,全部本地打包以满足 MV3 CSP)。
- 无现有系统受影响;无后端、无远程服务。
- 浏览器要求:Chrome 122+(File System Access 持久授权体验最佳)。

# 本地文件接管验证（2026-09-11）

## 通过

- `npm run build`、`npm run check`：类型、发布门禁、语言覆盖、本地规则与读取负向验证、SQL 和 Git 检查通过。
- `node scripts/e2e-local-files.mjs`：Chrome 152.0.7977.83，29/29。使用独立临时 profile，真实本地文件与文件访问开关。
- 72 个后缀全选保存，Chrome 实际接受 86 条规则；超出单条正则编译限制的长后缀采用等价分支拆分。
- 覆盖 Markdown/SQL/Java、文件内大纲和跳转、大小写与编码、刷新、页内链接、手动选择优先、HTML/图片显式启用、总开关、持久化与扩展重载、撤权恢复、目录（含无尾斜杠的后缀目录）、子框架和 HTTP 边界、缺失文件、文本截断、无 HTTP 请求和无接管下载。
- 读取单元负向验证包含 HTTP、远程 file 主机、非法路径、无文件名、禁止自动跟随重定向，以及已知/未知大小的 64 MiB 上限；产物变异验证覆盖读取模块被改动/缺失、额外传输 API、额外权限、远程主机及放宽 CSP。
- 设置独立浏览器检查覆盖未授权保存、保存失败、取消、ESC/焦点归还、权限刷新保留草稿与 360px 布局；正式设置截图也已目视检查。
- `npm run build:ai`、AI 模式发布门禁及 `npm run check:ai-negative` 通过，既有 loopback 例外保留。
- `openspec validate add-local-file-takeover --strict` 与 `git diff --check` 通过。

## 全量阅读器套件未全绿

`node scripts/e2e.mjs`：284/286，随后中止，未执行后续场景。

1. `dist-dev/assets/devFixture-*.js` 中的 `createWritable` 触发只读门禁。该开发专用 Git 夹具及导入在本次改动前已存在；正式 `dist/` 无该夹具并通过门禁。没有放宽只读检查来消除失败。
2. `scripts/e2e.mjs` 的千级目录场景在折叠 `bigdir` 后等待 `entry-*` 行消失，5 秒超时。该次运行目录展开为 31ms、DOM 保持 47 行；超时根因尚未确认，未将其宣称为通过，也未修改目录树或放宽断言。

测试范围为当前机器上的 Chrome 152；未实测 Chrome 122 或其他操作系统。

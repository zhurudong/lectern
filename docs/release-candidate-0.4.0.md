# Lectern 0.4.0 发布候选交接

当前分支：`codex/web-store-release`。0.4.0 是候选版本，尚未提交或发布 Chrome Web Store。用户尚未提供正式商店条目和 Apple Developer ID / 公证配置。

## 已完成

- 合并本地 main 的国际化、Rust/PHP 和文件对比功能，保留 Native Messaging 终端、SQL 大纲、自动打开本地文件。
- 扩展名称、描述、按钮标题采用 Chrome `_locales`；终端、安装指南、设置、拖放错误覆盖中英文。
- 中英文隐私政策区分本地只读阅读器、伴随程序与有写入/联网能力的 AI CLI。
- 纯净档不增加 nativeMessaging；AI 档单独构建。两个包均附 LICENSE 和第三方许可。
- 候选版本统一为 0.4.0，伴随程序源版本 0.2.1。Vite 更新至 6.4.3。
- 发布 CI 生成 draft，AI 产物明确标记 candidate。正式检查拒绝缺失下载、身份及签名/公证信息。

## 本地验证

- `npm run build && npm run check`：纯净档通过。
- 完整阅读器浏览器回归：387/387；此前一次为 386/387，目录树加载时的首行焦点偶发失败，复跑未复现。已增加失败时状态快照与独立延迟加载验证，不能视为已证明根因修复。
- 中英文消息键与插值占位符自动检查：404 对通过。符号提取 31/31、快捷键单一来源 5/5 通过。
- `npm run check:ai`：11 项伴随程序测试及隔离浏览器端到端检查通过，含英文终端错误/安装指引。
- ARM64 0.2.1 未签名开发包构建与运行时、身份、握手、EOF、卸载脚本编译检查通过；没有安装到系统。
- AI 验证采用隔离 Chrome 配置和模拟 native host，验证 Chrome 身份限制、生命周期、终端布局和目录关联；不代表正式签名安装链路已验证。

## 正式发布仍缺

1. 确认目标条目：已有条目请提供链接；确无条目则在开发者后台创建草稿取得扩展 ID，不要用开发加载 ID 打包正式伴随程序。核验后台最高上传版本后确定版本号。
2. 准备 Apple Developer ID Application、Installer 证书和 notarytool 配置。按 `docs/native-terminal/README.md` 构建与正式 ID 绑定的签名、公证安装包；核验承诺支持的芯片架构。
3. 提供稳定 HTTPS 下载页，分别列出支持架构和系统要求；以 `LECTERN_RELEASE=1 LECTERN_DOWNLOAD_URL=... npm run build:ai` 构建。发布检查传入正式 `LECTERN_EXTENSION_ID`、`LECTERN_DOWNLOAD_URL`、`LECTERN_COMPANION_PKG`，执行 `npm run check:release -- --release`。这些检查验证本地前提，不能替代下载可达性及安装包身份绑定验收。
4. 公开托管本次中英文隐私政策；更新商店中英文说明、权限理由、数据披露和审核操作步骤。现有 `assets/chrome-web-store/` 阅读器素材已保留，AI 条目还需与正式候选一致的终端截图。勿复用旧“全功能零网络只读”承诺。
5. 在干净用户环境从公开下载完成安装→CLI 登录→首个项目→新项目→关闭/重连→升级/卸载测试。随后再正式提交审核。

Google 官方要求：[发布准备](https://developer.chrome.com/docs/webstore/prepare/)、[隐私字段](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)、[提交发布](https://developer.chrome.com/docs/webstore/publish/)。后台披露必须与产品实际行为及隐私政策一致。

## 商店说明草稿（AI 构建）

中文名称：Lectern — 代码阅读与 AI 终端

在 Chrome 中阅读本地代码、跳转定义、搜索符号和文本、查看文件与 Git 差异。中英文界面、亮暗主题和键盘导航帮助你理解项目。

可选 AI 终端在阅读区右侧打开，可拖动调整宽度。该功能目前需要 macOS 13.5 或更高版本、Google Chrome、单独安装 Lectern Companion，并准备已安装和登录的 Codex 或 Claude Code CLI。首次关联项目需在系统选择器中选择同一目录，以后自动复用。关闭终端会结束当前 CLI 会话，重开会启动新会话。

阅读器在本机只读处理代码。AI CLI 以你的用户权限运行，可能修改文件，并根据自身设置向模型服务发送上下文；模型账号、费用和数据政策由对应服务提供方决定。Lectern 维护者不运营代码采集或遥测服务。终端为可选功能，未安装伴随程序仍可使用阅读器。

English name: Lectern — Code Reader & AI Terminal

Read local code in Chrome, navigate definitions, search symbols and text, and review file and Git differences. English and Chinese interfaces, light/dark themes and keyboard navigation help you explore a project.

The optional AI terminal opens beside the reader with an adjustable width. It currently requires macOS 13.5 or later, Google Chrome, a separate Lectern Companion installation, and an installed and authenticated Codex or Claude Code CLI. Choose the matching local folder once for each project; later sessions reuse that association. Closing the terminal ends the current CLI session; reopening starts a new session.

The reader processes code locally and is read-only. Your CLI runs with your user permissions, may modify files, and may send context to its model provider according to its own settings. Provider accounts, charges and data policies apply separately. Lectern's maintainer operates no code collection or telemetry service. The reader works without the optional companion.

## 权限说明与审核步骤草稿

- `storage`：保存阅读偏好、自动打开设置和项目关联标识。
- `declarativeNetRequestWithHostAccess` 与 `file:///*`：在用户启用 Chrome 文件网址访问及所选类型自动打开后，把相应本地文件网址导向阅读器。无需访问任意互联网网站。
- `nativeMessaging`（仅 AI 构建）：与用户独立安装的本机伴随程序通过 Chrome 标准接口传递终端输入、输出、尺寸和项目关联信息。
- 单一用途：帮助用户在本地阅读、理解和审阅代码；可选终端在同一阅读上下文中运行用户自己的代码助手。

审核者先以任意测试目录验证阅读、搜索、文件对比及中英文切换；无需登录即可使用阅读器。终端使用公开下载页中的匹配安装包，并安装和登录支持的 CLI；返回扩展点击 AI 终端，首次选择测试目录。请只在可丢弃的测试项目中执行修改命令。提交前把实际下载/隐私 URL 填入后台，并按实际构建的数据处理逐项填写隐私字段；本草稿不是已完成的后台申报。

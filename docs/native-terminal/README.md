# macOS 终端：首次使用与发布

用户第一次：安装 **AI 版**扩展 → 点击 AI → 下载并安装配套伴随 pkg → 准备 Codex/Claude CLI（已有安装登录直接复用）→ 重新连接 → 选择当前项目对应目录 → 使用右侧终端。系统安装器可能要求管理员密码。普通纯净版不提供 AI 入口。

以后：打开已关联项目 → 点击 AI。新项目只额外选择一次本机目录。不需要启动服务、重新安装、端口或 token。CLI 未登录时按自身提示完成认证；程序只检测可执行文件，不声称能自动完成账户登录。

目录选择在系统文件选择器完成。终端位于阅读区右侧，可拖拽调宽；关闭结束 CLI，重新打开/断线重连是新会话。移动目录、清理浏览器数据或安装到不同扩展 ID 可能要求重新关联。

## 维护者构建

先 `npm ci`、`npm --prefix lectern-agent ci`。从 Node 官方 v24.13.0 目录下载匹配 macOS arm64/x64 的 tar.gz；构建器内置两种归档的 SHA-256，校验失败即停止。

```sh
npm run build
npm run build:ai
npm run package:companion -- --extension-id <当前扩展的32位ID> --node-archive <Node官方tar.gz绝对路径>
```

开发产物位于 `release-artifacts/`，文件名明确带 `UNSIGNED-DEV`。本机源码调试可运行 `npm run setup:ai` 注册已经构建的内置运行环境（用户级 Chrome host）；无需运行 launchd。重载扩展以启用新增 nativeMessaging 权限。安装包不包含 WebSocket 服务或源码仓库路径。

开发注册卸载：`node scripts/native/register-dev.mjs --uninstall`。必须先移除开发注册再测试正式 pkg，否则 Chrome 用户级注册会遮盖系统级注册。旧 WS 服务迁移前先关闭终端，再运行 `node lectern-agent/cli.mjs --uninstall`；它不是新版必需组件。

## 正式发布

确认 Web Store **AI 扩展** ID。为扩展构建配置真实 `LECTERN_DOWNLOAD_URL=https://...`（可为同时列出两种芯片安装包的发布页），再 `npm run build:ai`。没有配置时安装指引会明确说明下载尚未发布，不生成假下载链接。

为 pkg 构建配置以下环境变量（仅名称与 keychain profile，不将密钥写入仓库）：

- `LECTERN_APP_IDENTITY`：Developer ID Application 证书名称
- `LECTERN_INSTALLER_IDENTITY`：Developer ID Installer 证书名称
- `LECTERN_NOTARY_PROFILE`：已配置的 notarytool keychain profile
- `LECTERN_DOWNLOAD_URL`：对应的 HTTPS 发布入口

构建命令加 `--release`。它签名原生文件/应用和安装包，提交 Apple 公证、装订票据并验证；任何失败均非发布成功。构建器当前固定版本 0.2.0、协议 1；升级时显式同步版本、发布记录与协议兼容性。

发布前在无 Node/npm/源码的干净 Mac 上验证：安装、首次缺 CLI 指引、CLI 登录、目录选择、关闭/重开、同名项目、更新保留关联、卸载后出现安装指引。arm64 与 Intel 各验一次。自动化不能代替 Gatekeeper、系统授权和干净机器验收。尚未取得签名/商店配置时不得宣称正式发布完成。

## 更新与卸载

用户关闭终端后安装新版 pkg；路径固定，不迁移到构建目录，关联保留。卸载时在 Finder 前往 `/Applications/Lectern Companion.app/Contents/Resources`，运行 `Uninstall.command`，确认系统授权。只删除应用与 Chrome host，保留 CLI、登录和 `~/.lectern-agent/` 关联。扩展单独卸载。

## 约束与验收

新版无 localhost 监听、不写模型遥测、不注入 hook、不直连模型服务。浏览器与主机双重限定精确扩展 origin。仍保留旧 WS 实现及兼容测试，但不打进正式伴随程序。

`npm run check` 验证纯净档；`npm run check:ai` 包含原生 framing/PTY、旧兼容、安全负向及隔离 Chrome 验收；`node scripts/native/check-package.mjs` 验证本地生成的内置运行环境、身份拒绝与握手。正式签名和干净机器验收另列，不混为自动化已通过。

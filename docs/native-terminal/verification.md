# 本轮验证记录（2026-09-12）

分支：`spike/ai-terminal-layer-one`。macOS arm64，本机开发扩展 ID `nddmckjekfblhkkdjpdmdjihpgdgncob`。该 ID 不是已确认的 Web Store 发布身份。

## 已通过

- `npm run build` 与 `npm run check`：纯净产物、语言覆盖、本地文件、SQL、Git 与 UI 契约。
- `npm run check:ai`：AI 构建、精确 native 主机/权限/CSP、安全注入负向、11 个伴随测试、真实隔离 Chrome E2E。
- Native Messaging E2E：未安装指引、Chrome 拒绝非 allowlist 扩展且不启动进程、安装后重新连接、真实 stdio 双向传输、resize、右侧 dock 无遮挡、鼠标关闭归还焦点、异常退出自动重连不抢焦点、自然退出不重启、CLI 缺失与协议不兼容、同名 DirectoryHandle 区分和刷新持久化。
- 实际 `/bin/sh` PTY：目录、输入输出、终端尺寸、关闭杀进程；不调用模型。
- `node scripts/native/check-package.mjs`：内置官方 Node v24.13.0，在仅 `/usr/bin:/bin` 的 PATH 下启动；主机自身拒绝错误 origin；握手/版本错误/EOF 退出；只编译卸载 AppleScript，未执行卸载。
- `node scripts/check-extract.mjs`：23/23。
- `npx --no-install openspec validate --changes --strict`：7/7。
- `git diff --check`。

首次沙箱内执行旧 WS 兼容测试被 EPERM 阻止监听临时端口；沙箱外重新执行通过。没有删除旧测试或放宽门禁。

## 完整阅读器 E2E 未通过

`node scripts/e2e.mjs` 连续两轮 **284/286 PASS，exit 1**：

1. 开发产物 `dist-dev/assets/devFixture-*.js` 包含 `createWritable`，不符合该测试对 dist-dev 运行的只读门禁。`src/git/devFixture.ts` 与 `scripts/e2e.mjs` 均与分支 HEAD 字节一致；纯净正式 dist 检查通过。未为通过测试豁免写文件符号。
2. 千条目录虚拟滚动用例，在滚回顶部后点击 bigdir 折叠并等待 entry 行消失处超时（`scripts/e2e.mjs:4167`）。重复出现，根因尚未确认；后续用例未执行，不能视为全量阅读器回归通过。

完整日志：本机 `/tmp/lectern-reader-e2e.log`。AI 日志：`/tmp/lectern-check-ai.log`。这些不是发货资源。

## 本机安装状态与发布边界

- 已生成 `release-artifacts/Lectern-Companion-0.2.0-macOS-arm64-UNSIGNED-DEV.pkg` 及 SHA-256 文件，约 38 MB。
- 已将内置运行环境安装到用户开发目录并注册现有开发扩展。需在 Chrome 扩展管理中重新加载 dist-ai 一次以应用新增权限；未操作用户当前扩展页面。
- 旧 8137 服务无活动连接后已卸载登录项，保留关联。新版不常驻监听端口。
- 尚未取得正式扩展 ID、HTTPS 下载配置与 Apple 签名/公证配置。正式签名、公证、干净 Mac 安装/升级/卸载和 Intel 实机验证未执行。未发布 Web Store、GitHub Release 或 npm。
- 安装器构建成功与运行环境测试不等同于系统安装器/Gatekeeper 的干净机器验收。真实系统目录选择仍是用户操作；此次原生选择逻辑用注入选择器验证，未替用户选择真实项目。

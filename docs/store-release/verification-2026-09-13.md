# 2026-09-13 安装验证记录

环境：macOS 26.5.1（25F80），ARM64，Chrome 152.0.7977.83。扩展候选 0.4.0，正式 ID `ahmcjpgaejjfgiihipkjlhmepcnkbddm`，companion 0.2.1，捆绑 Node 24.13.0。

用户手动通过 Chrome 下载了 GitHub 的 `Lectern-Companion-0.2.1-macOS-arm64-UNSIGNED.pkg`。文件大小 39,479,623 字节，SHA-256 为 `fd7ebea7e260f0d35231cee8a2bd484689360d6a53f3b1408b6d1c7f581ebe6b`，与公开发布一致。检查时保留 Chrome 下载隔离属性；`pkgutil` 确认为未签名包。

已进入系统 Installer 标准安装界面。用户报告完成安装后，系统收据确认 0.2.1，安装文件与发布包逐文件核对一致。此次是在已有开发环境和旧 companion 上升级，不是干净 macOS 用户的首次安装。未观察到的 Gatekeeper 提示不作推断。

自动检查已通过：

- 公钥对应正式 ID；真实 Chrome 加载候选后的 ID 一致。
- 不使用测试主机覆盖，Chrome 直接发现 `/Library/Google/Chrome/NativeMessagingHosts/` 中的正式注册并完成握手。
- 系统安装的 Node/PTY/helper 能启动临时终端探针，完成输入输出、37 行 × 96 列调整及正常退出。
- 旧开发 ID 被拒绝；纯净档和待上传 AI 包的 manifest 没有被测试公钥改写。
- 自动测试产生的临时项目关联已清理；没有启动 AI CLI 或调用模型服务。

用户随后在独立 Chrome 验收窗口中完成真实操作，并回复“完成验证”：打开测试项目、首次在系统选择器关联同一目录、在右侧终端向 AI CLI 发出只读请求并得到回复。验收目录为 `release-artifacts/store-test-0.4.0/sample-project/`，所给请求是“请说明 hello.js 的作用，不修改文件”。该结果为用户确认，未采集会话内容或凭据；CLI 名称及版本未单独记录。

本次已经验证 ARM64 升级安装、正式扩展身份、实际系统原生主机、PTY 输入输出/尺寸调整，以及用户实际目录关联与 AI CLI 使用。扩展来自本地验收副本，不是 Chrome Web Store 安装。

详细机器报告位于 `release-artifacts/store-test-0.4.0/installed-connection-check.json`。仍需记录会话重开/新项目、干净用户环境、Intel 安装以及商店安装复验；这次确认不覆盖这些项目。`cleanInstallVerified` 保持 false。

商店草稿包复核：两个架构安装包的身份、版本、校验和及架构检查通过，公开下载/隐私链接和双语安装页通过。ZIP 的 23 个文件与用户刚验收的副本逐项一致，仅移除了本地验收 manifest 中的公钥；没有重新构建产品代码。新增 `--draft-upload` 只允许准备商店草稿，缺少版本/条目确认仍拒绝生成，`--final` 仍拒绝未完成的安装验收。纯净档沿用此前通过的 `npm run check` 结果，本次仅改发布脚本和文档。

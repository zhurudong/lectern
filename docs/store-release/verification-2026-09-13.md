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

详细机器报告位于 `release-artifacts/store-test-0.4.0/installed-connection-check.json`。后续仍需记录真实目录选择、AI CLI 使用、会话重开/新项目、干净用户环境、Intel 安装以及商店安装复验。`cleanInstallVerified` 保持 false。

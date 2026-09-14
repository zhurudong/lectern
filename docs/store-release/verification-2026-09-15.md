# 0.4.1 发布准备验证

扩展版本 0.4.1，目标条目 `ahmcjpgaejjfgiihipkjlhmepcnkbddm`，沿用 Companion 0.2.1 未签名预览包。产品逻辑来自已合并的 PR #4；本次发布准备只调整版本、商店元数据、说明和素材生成。

- `npm run build && npm run check` 通过，纯净档不含 Native Messaging，411 对中英文消息及插值检查通过。
- 使用公开 companion 下载 URL 构建的 `npm run check:ai` 通过：11 项 companion 测试，以及隔离浏览器中的停靠、尺寸持久化、主题／语言切换保留会话、错误引导与文件／Git 切换等场景。
- `npm run check:release` 通过，包版本、许可、权限隔离和安装页一致。
- `npm run shots:store` 生成英中文各四张 1280×800 当前界面截图和两张宣传图。终端截图是首次使用指引，未模拟 AI 回复。截图生成时对每种语言显式初始化右侧布局，避免上一种语言留下的停靠偏好影响下一组图片。
- `npm run prepare:store-test` 只在独立验收副本中加入正式条目公钥，不改变上传包。
- `npm run check:store-identity -- --installed` 通过：现有安装文件与公开 ARM64 包一致，独立 Chrome 以正式 ID 连接系统注册的 Companion 0.2.1，协议 1 握手、真实 PTY 输入输出、37×96 尺寸调整和正常退出通过。同一主机拒绝未授权的开发扩展 ID。临时探针及项目关联已清理，不调用 AI 模型，不更改 companion 安装。

机器连接报告：`release-artifacts/store-test-0.4.1/installed-connection-check.json`。上传包及具体源码提交由 `release-artifacts/web-store-0.4.1/status.json` 记录。原 0.4.0 上传包 SHA-256 保持 `44b4b7b6ad73786f032f6936c08dfcafff723336e39af54dba2fb6f0fb3f915b`。

完整阅读器 387/387 及目录树焦点 3/3 是本次产品实现的前序验收，发布准备没有改变阅读器源码。本次真实连接验证覆盖 ARM64 上已有 Companion 的兼容性，不是全新系统安装、Intel 运行或 Chrome Web Store 安装测试。历史真实 CLI 请求见 [0.4.0 的升级安装记录](verification-2026-09-13.md)；不把历史结果记为 0.4.1 的新模型请求，`cleanInstallVerified` 继续保留 false。

本记录证明本地构建与测试范围，不代表 0.4.1 已上传、提交审核或发布。当前仍需商店后台操作；工具此前拒绝访问该后台。

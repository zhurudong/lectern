# Lectern 0.4.1：上传这次终端布局更新

**当前阶段：本地准备，尚未上传或提交 0.4.1。** 本次已获用户授权发布。目标仍是现有条目 `ahmcjpgaejjfgiihipkjlhmepcnkbddm`，不要创建新条目。0.4.0 曾因中英文描述中的语言名称列表被拒，用户后来确认修订并重新进入审核；最新后台状态及最高上传版本尚未独立核实。

0.4.1 包含右侧／底部停靠、自动记忆尺寸、单行工具栏，以及随阅读器切换的终端主题。切换布局、语言或主题保持会话；关闭终端会结束会话，重新打开或重连会启动新会话。Companion 仍为 0.2.1，权限与数据处理方式和 0.4.0 相同。已安装伴随程序的用户无需为这次布局更新重新安装。

## 1. 选择正确的上传文件

交付目录：`release-artifacts/web-store-0.4.1/`。以 [status.json](status.json) 的 `package` 字段为准，包内 `manifest.json` 位于根目录。

- `ready-for-draft-upload`：`draft-upload/lectern-0.4.1-ai-DRAFT-ONLY.zip`，已完成上传技术检查，可上传并保存草稿，保留安装验收缺项。
- `ready-for-manual-review`：`final-upload/lectern-0.4.1-ai-web-store.zip`，包含完整安装验收后生成的正式包。
- `candidate-only`：不要上传，先解决 `missing` 中的技术缺项。

不要上传纯净阅读器包、macOS `.pkg`、整个交付目录或上一版 0.4.0 ZIP。发布脚本不操作商店后台。

## 2. 上传到原有条目

1. 在 Chrome Web Store 开发者后台打开现有 Lectern 条目，核对 ID。
2. 查看当前“状态”和“软件包”。若已有审核中的提交或版本号不接受 0.4.1，保留当前提交并记录提示，不撤回、不删除条目。
3. 在“软件包”选择“上传新软件包”，使用第 1 步 `status.json` 指定的 ZIP。
4. 解析后核对版本为 **0.4.1**，名称为 **Lectern — 代码阅读与 AI 终端**（英文 **Lectern — Code Reader & AI Terminal**）。权限继续为 `storage`、`declarativeNetRequestWithHostAccess`、`nativeMessaging` 和 `file:///*`。

## 3. 更新说明与截图

| 后台字段 | 对应材料 |
| --- | --- |
| 简体中文详细描述 | [listing.zh-CN.txt](listing.zh-CN.txt) 全文替换 |
| 英文详细描述 | [listing.en.txt](listing.en.txt) 全文替换 |
| 中文截图 | `images/zh_CN/` 中 01 到 04，按顺序上传 |
| 英文截图 | `images/en/` 中 01 到 04，按顺序上传 |
| 测试说明 | [reviewer-notes.en.txt](reviewer-notes.en.txt) 全文替换 |
| 权限及隐私 | [privacy-fields.html](privacy-fields.html)，已有正确内容保持 |

01 为浅色阅读器，02 为暗色阅读器，03 为右侧终端首次使用，04 为底部终端首次使用。均由当前构建实际渲染；首次使用截图未连接 AI 模型，不展示模拟模型回复。推广图和图标仍在 `images/promos/`、`images/icon-128.png`；现有图无误时无需重复上传。

描述保留语言覆盖数量和实际功能，不重新加入此前被拒的语言名称列表。名称与简短描述由包内 `_locales` 提供。

## 4. 保存并提交审核

保存两种语言的详情、测试说明和软件包。提交前核对预览与本次 ZIP，确认公开下载和隐私链接可访问，并查看 `status.json` 中保留的验收范围。

现有安装记录覆盖 ARM64 上 Companion 0.2.1 的升级安装与真实 CLI 请求；全新 macOS 环境、Intel 运行与从商店安装的验证仍未完成，不把自动化测试记为这些人工验收。本次本地构建与真实连接结果见 [0.4.1 验证记录](verification-2026-09-15.html)，完整模板见 [first-install-checklist.html](first-install-checklist.html)。

技术及安装验收齐备后点击“提交审核”。本次包含界面和代码更新，**不勾选“仅修改 declarativeNetRequest 安全静态规则，跳过审核”**。沿用用户已选择的“审核通过后自动发布”。最后检查状态确实变为“正在审核”；这表示已经提交，不表示已经上架。

提交流程参考 [Chrome 官方更新说明](https://developer.chrome.com/docs/webstore/update/)。

后台操作完成前，0.4.1 始终记为本地准备。不要因 GitHub 合并或测试通过就将商店状态记成已发布。

## 固定链接与安装入口

- [Companion 0.2.1 下载](https://github.com/zhurudong/lectern/releases/tag/companion-v0.2.1)：ARM64 / Intel 安装包均未签名、未公证，包含运行环境。
- [英文隐私政策](https://github.com/zhurudong/lectern/blob/companion-v0.2.1/PRIVACY.md) · [中文隐私政策](https://github.com/zhurudong/lectern/blob/companion-v0.2.1/PRIVACY.zh-CN.md)
- [支持](https://github.com/zhurudong/lectern/issues)

终端工具栏：圆形箭头为重连，停靠按钮切换右侧／底部，滑杆按钮打开设置。安装、更新、卸载说明和更换关联目录都在设置里；未安装伴随程序时另有直接入口。

开发构建及验收命令见 [engineering.html](engineering.html)。旧 0.4.0 的 ZIP 与本地发布材料独立保留，0.4.1 不覆盖它们。

# Lectern 0.4.0：按这份清单发布

**当前步骤：修订商品详情后重新提交。** 用户提供的后台截图显示 0.4.0 已上传并被拒绝，原因是中英文详细描述中的语言名称列表被判定为关键词过多（Yellow Argon）。两份本地描述已修订；按 [重新提交步骤](resubmission-2026-09-13.md) 全文替换两种语言、保存，再提交审核。本次不需要改版本号或重传 ZIP，也不用重复下面的初次发布流程。尚未收到重新提交成功的后台证据。

本次目标是发布带可选 AI 终端的 Lectern 版本。按用户选择，通过 GitHub Releases 分发未签名、未公证的安装包，不要求 Apple Developer 会员。macOS 可能阻止安装或启动，需用户核对来源后自行决定是否允许；安装验证范围见第 3 步。

## 先认清你会用到的东西

| 内容 | 位置 | 用在哪里 |
| --- | --- | --- |
| 操作总览 | 本文件 / START-HERE.html | 按顺序做 |
| 中英文详细说明 | listing.zh-CN.txt / listing.en.txt | 商店详情各自语言下粘贴 |
| 权限与数据填写 | privacy-fields.md / .html | 隐私权规范 |
| 审核者步骤 | reviewer-notes.en.txt | 测试说明 |
| 图片 | images/en、images/zh_CN、images/promos、images/icon-128.png | 商店图形资源 |
| 隐私政策 | 本文第 4 步的 GitHub 链接 | 填商店隐私政策网址；site/ 为可选网站版本 |
| 扩展候选 ZIP | packages/*-ai-CANDIDATE-NOT-FOR-SUBMISSION.zip | 前提齐备前只保留在本机 |
| 商店草稿 ZIP | draft-upload/*-ai-DRAFT-ONLY.zip | 技术检查通过后上传，仅保存草稿 |
| 正式扩展 ZIP | final-upload/*-ai-web-store.zip | 完成下面所有前置项后生成并上传 |
| 文件校验与状态 | SHA256SUMS.txt、status.json | 防止拿错包、了解缺项 |

`release-artifacts/web-store-0.4.0/` 是交付目录。候选 ZIP 内 manifest 位于根目录，不需要再次压缩。不要上传整个交付目录，也不要上传 macOS `.pkg` 到 Chrome Web Store。

## 1. 确认现有条目和版本（已完成）

打开 Chrome Web Store 开发者后台，进入**已有 Lectern 条目**。先不创建新条目，不上传包。

用户已确认正式 ID 为 `ahmcjpgaejjfgiihipkjlhmepcnkbddm`，并确认本次 `0.4.0` 可以上传，两项均已写入 release-config.json。最新后台截图已确认 0.4.0 的拒绝状态，记录于 `storeReview`；其他历史版本不作推测。本次修订适用于该 ID 和版本。

Chrome 商店 ID 与本机“加载已解压扩展”的开发 ID 不同。现有开发包绑定的 ID 不能用于正式安装包。

## 2. 发布 Lectern Agent 到 GitHub（已完成）

已发布与正式扩展 ID 绑定的 ARM64 / Intel 安装包、SHA-256 与发布说明，标记 `UNSIGNED`。它们与旧 `UNSIGNED-DEV` 包不同：绑定正式商店 ID，并附分发元数据，但同样没有 Apple Developer ID 签名或公证。

下载页：[Lectern Agent 0.2.1 未签名预览版](https://github.com/zhurudong/lectern/releases/tag/companion-v0.2.1)。两个架构的安装包、校验和及分发元数据均已上传，标记为预发布。Git 标签对应源码提交 `478d6ac19fb13fffd8e6cdc84533aafb8a66ab33`，后续修复应使用新版本，不能覆盖现有安装包。

GitHub CLI 已登录并完成发布。公开下载页、两个安装包以及双语隐私政策均已用未登录请求核验；下载文件的 SHA-256 与发布前完全一致。后续用户下载不需要维护者账号。

## 3. 安装验证（ARM64 升级与真实 CLI 已通过）

正式扩展公钥已收到并校验，对应 ID `ahmcjpgaejjfgiihipkjlhmepcnkbddm`。独立验收副本位于 `release-artifacts/store-test-0.4.0/extension/`；纯净版及待上传 AI 包的 manifest 均未加入测试公钥。

2026-09-13，用户已从 Chrome 下载公开 ARM64 包并通过系统 Installer 升级到 0.2.1。文件校验、系统收据及安装文件一致性检查通过。独立 Chrome 直接发现系统注册并以正式 ID 完成握手，真实 PTY 输入输出及调整尺寸通过，旧开发 ID 被拒绝。用户随后在独立验收窗口完成项目目录选择、关联和真实 AI CLI 请求/回复。详见 [验证记录](verification-2026-09-13.md)。

该机器已有开发环境及旧 companion，所以这次覆盖 ARM64 升级安装，不覆盖全新系统或 Intel。后续维护者可执行 `npm run test:store-manual` 打开独立验收窗口。正式商店用户无需公钥、开发者模式或加载目录；本地验收使用的是 [Chrome 官方保持开发扩展 ID 的方法](https://developer.chrome.com/docs/extensions/reference/manifest/key)。

首次用户的实际使用步骤如下：

1. 从公开 GitHub Release 下载与 Mac 芯片匹配的 `UNSIGNED.pkg` 和 `.sha256`。核对仓库所有者、版本、扩展 ID 及校验和。
2. 双击安装包。因为未签名、未公证，macOS 可能阻止安装或启动；由用户按 [Apple 官方说明](https://support.apple.com/102445) 决定是否允许该具体程序。受组织管理的 Mac 可能不允许这样做。
3. 这里不提供关闭整个系统安全检查、批量解除隔离的安装脚本。安装器可能请求管理员授权，这是安装到 Applications 和注册 Chrome 主机所需。
4. 准备并登录 Codex 或 Claude Code CLI，返回 Lectern 点 AI 终端 → 重新连接，首次在系统选择器中选择同一项目目录。
5. 后续同一项目自动复用关联；新项目选择一次目录。关闭终端结束 CLI 会话。

先在可丢弃的测试目录验收，不卸载日常使用的 CLI。ARM64 和 Intel 的系统安装各自验证，记录到 `first-install-checklist.md`。本机自动化通过不会自动勾选这些记录。

## 4. 公开隐私政策（我准备，你核对链接）

隐私字段填写：[英文隐私政策](https://github.com/zhurudong/lectern/blob/companion-v0.2.1/PRIVACY.md)。[中文隐私政策](https://github.com/zhurudong/lectern/blob/companion-v0.2.1/PRIVACY.zh-CN.md) 同样已公开。两个固定标签页面均已通过未登录访问核验，包含本次 AI/CLI 处理说明，无需新增域名或配置 GitHub Pages。

`site/` 静态站点与 `.github/workflows/pages.yml` 仍可选用。它们不是本次上传前必须由你配置的步骤。

## 5. 生成上传 ZIP（我操作）

公开下载、隐私 URL 和安装页已配置。unsigned 模式保留身份/版本/架构/校验和检查，验证未签名事实和安装页披露。

`npm run prepare:store -- --draft-upload` 核验公开链接、两个架构的发布包和扩展产物，生成 `draft-upload/`。即使还有安装验收缺项，也可以先上传这个 ZIP 并保存商店草稿；`status.json` 会保留缺项。

`--final` 仍要求完整的安装验收记录，再生成 `final-upload/`。这两步不上传或提交商店。Chrome Web Store 的最终审核结果由 Google 决定。

## 6. 上传新版本（你操作商店后台）

`status.json` 为 `ready-for-draft-upload` 时，可以上传 `draft-upload/lectern-0.4.0-ai-DRAFT-ONLY.zip` 并保存草稿，暂不提交审核。`ready-for-manual-review` 对应 `final-upload/` 中的正式上传包。始终以 `status.json` 的 `package` 字段选文件。

1. 回到第 1 步确认的同一个 Lectern 条目。
2. 打开“软件包 / Package”，选择上传新软件包，选上述状态对应的 **AI 扩展 ZIP**。
3. 等后台解析完成，核对名称、版本、`nativeMessaging` 及本地文件权限。名称来自包中的 `_locales`；如不可编辑，不要用后台临时文案掩盖错误。
4. 如果提示版本号不够高或有审核中的版本冲突，保留错误提示发给我；不删除条目。

## 7. 填商店详情（逐字段复制）

| 字段 | 填写内容 |
| --- | --- |
| 英文详细描述 | listing.en.txt 全文 |
| 简体中文详细描述 | 切换到简体中文后粘贴 listing.zh-CN.txt 全文 |
| 名称 / 简短描述 | 由扩展本地化元数据提供，见 metadata.json |
| 分类 | 选择面向开发工具的分类；若当前后台使用新分类名，选择最贴近代码开发的一项 |
| 图标 | images/icon-128.png |
| 英文截图 | images/en/ 中 01、02、03，按顺序上传 |
| 简体中文截图 | images/zh_CN/ 中对应三张 |
| 小型宣传图 | images/promos/small-promo-440x280.png |
| 大型宣传图 | images/promos/marquee-promo-1400x560.png（可选位置） |
| 主页 | 实际公开的 GitHub 仓库或发布页 URL |
| 支持网址 | https://github.com/zhurudong/lectern/issues |
| 成熟内容 | 当前代码阅读工具不包含成人内容，保持关闭 |
| 视频 | 没有真实演示视频就留空，不填占位地址 |

截图展示的是实际候选界面，03 是首次安装引导，**不宣称已连到模型**。推广图使用全局英文文案，未沿用旧的全产品“零网络、只读”宣传。

先保存草稿；两种语言的功能、系统要求和外部依赖必须一致。[商店详情与本地化](https://developer.chrome.com/docs/webstore/cws-dashboard-listing)

## 8. 填隐私权规范和审核说明

1. 对照 `privacy-fields.html` 从上往下填写单一用途、每项权限、远程代码和数据类别。
2. 隐私政策 URL 填第 4 步验证过的隐私政策完整 HTTPS 地址。
3. “测试说明 / Test instructions”粘贴 `reviewer-notes.en.txt`。如有独立网址栏，补正式 companion 下载页；不要提供你的私人 CLI 账号或密钥。
4. 分发保持现有条目的地区、公开范围与免费设置；除非你决定改变。AI 模型的单独账号/费用已在描述里披露。
5. 查看后台错误清单。真实缺少的字段需要补齐；不能仅为消除错误勾选不符合实际的隐私承诺。

## 9. 提交审核和正式上线

所有包、链接与安装验证完成后，检查预览页面：名称/文案/截图互相一致，隐私与下载页可访问，旧的零网络承诺已更新。

点击“提交审核 / Submit for Review”。建议使用审核通过后手动发布：在最终确认对话框中关闭自动发布选项，先看审核结果。审核通过后，再检查一次下载入口并点击发布。延期发布有有效期，以后台显示为准。

新增权限可能使现有用户需要重新启用扩展。发布后，从商店安装做一次真实升级/首次终端验证；自动化本地测试不能替代该环节。[Google 提交流程](https://developer.chrome.com/docs/webstore/publish/)

## 当前无需你做的事

不需要自己修改 manifest、压 ZIP、复制 token、启动常驻服务或安装 Node 给最终用户。代码、配图、说明和构建步骤由我维护。你只承担账号/身份步骤、真实系统安装验证，以及浏览器工具禁止代办的商店后台操作。

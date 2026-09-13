# Lectern 0.4.0：按这份清单发布

本次目标是升级现有 Lectern 条目，发布带可选 AI 终端的版本。扩展候选包和商店材料已在本机生成，尚未上传或发布。完整版本还依赖 Apple 签名、公证和公开安装包；这些不能用未签名开发包替代。

## 先认清你会用到的东西

| 内容 | 位置 | 用在哪里 |
| --- | --- | --- |
| 操作总览 | 本文件 / START-HERE.html | 按顺序做 |
| 中英文详细说明 | listing.zh-CN.txt / listing.en.txt | 商店详情各自语言下粘贴 |
| 权限与数据填写 | privacy-fields.md / .html | 隐私权规范 |
| 审核者步骤 | reviewer-notes.en.txt | 测试说明 |
| 图片 | images/en、images/zh_CN、images/promos、images/icon-128.png | 商店图形资源 |
| 静态公开页面 | site/ | 发布为 HTTPS 网站；含中英文隐私政策 |
| 扩展候选 ZIP | packages/*-ai-CANDIDATE-NOT-FOR-SUBMISSION.zip | 前提齐备前只保留在本机 |
| 正式扩展 ZIP | final-upload/*-ai-web-store.zip | 完成下面所有前置项后生成并上传 |
| 文件校验与状态 | SHA256SUMS.txt、status.json | 防止拿错包、了解缺项 |

`release-artifacts/web-store-0.4.0/` 是交付目录。候选 ZIP 内 manifest 位于根目录，不需要再次压缩。不要上传整个交付目录，也不要上传 macOS `.pkg` 到 Chrome Web Store。

## 1. 先确认现有条目和版本（你现在做这一步）

打开 Chrome Web Store 开发者后台，进入**已有 Lectern 条目**。先不创建新条目，不上传包。

从已打开的后台 URL 观察到的 ID 为 `ahmcjpgaejjfgiihipkjlhmepcnkbddm`。核对它确实属于 Lectern；在“软件包 / Package”以及状态页面查看已发布版本、草稿/审核中版本和当前发布状态。

把 **条目名称、扩展 ID、最高已上传版本、当前状态** 发给我，或发一张包含这些信息的截图。我据此确定最终版本与安装包绑定。若最高版本已达到或超过 0.4.0，必须改用更高版本并重新生成；不要删除线上版本以迁就本地候选。

Chrome 商店 ID 与本机“加载已解压扩展”的开发 ID 不同。现有开发包绑定的 ID 不能用于正式安装包。

## 2. 准备 Apple 开发者资格（你完成账号步骤）

这是发布 macOS 伴随程序所需，和 Chrome 开发者账号是两回事。

1. 打开 [Apple Developer Program](https://developer.apple.com/programs/enroll/)，登录自己的 Apple 账号。
2. 若尚未加入，按个人或公司的实际身份注册，完成双重认证、身份核验、协议与付费。**不要购买 Enterprise Program**。标准会员官方年费通常为 99 美元，按所在地页面显示的货币、税费和条款为准。
3. 若已经是有效会员，直接使用现有团队。完成后只告诉我“会员已生效”，以及用于签名的 Team ID；不用把 Apple 密码、付款资料或验证码发给我。

这些步骤涉及你的身份、协议和付款，需要你本人完成。[官方注册说明](https://developer.apple.com/support/enrollment/)

## 3. 创建签名证书并放入这台 Mac（按页面操作，我接手后续命令）

1. 在这台 Mac 打开“钥匙串访问”，从“证书助理”选择“从证书颁发机构请求证书”，填写自己的邮箱与名称，选择保存到磁盘，生成 CSR。私钥留在这台 Mac 的钥匙串中。
2. Apple Developer → Certificates, Identifiers & Profiles → Certificates → 新建证书。创建 **Developer ID Application**，上传 CSR，下载证书，双击导入钥匙串。
3. 同样创建 **Developer ID Installer** 并导入。不要选择 Mac App Distribution 或 Mac Installer Distribution，它们用于不同分发渠道。
4. 在钥匙串“我的证书”中确认两张 Developer ID 证书各自能展开看到私钥。只下载 `.cer` 而没有私钥，不能签名。
5. 告诉我“两个证书已安装”。证书名称和 Team ID 可提供；不用导出或发送私钥。

然后我核对签名身份、配置构建。公证凭据由你在本机终端交互输入到钥匙串，例如运行 `xcrun notarytool store-credentials lectern-notary` 按提示完成；不要把应用专用密码放进聊天、仓库或发布材料。如果本机缺少可用的 notarytool，先按 Xcode 工具提示完成安装。

[Apple Developer ID 证书说明](https://developer.apple.com/help/account/certificates/create-developer-id-certificates/)

## 4. 我生成正式伴随程序，你验证首次安装

前面资料齐备后，我执行下面这些工程步骤，你无需手工拼命令：

- 为正式扩展 ID 构建 ARM64 和 Intel x64 包，逐个签名、公证、装订票据并验证。
- 在包内核对扩展 origin、版本、运行时架构，生成 SHA-256。
- 把包与校验文件放到你拥有的 GitHub 仓库 Release。拟用独立标签 `companion-v0.2.1`，避免与扩展的 v0.4.0 混淆；实际已有标签冲突时换新版本。
- 发布下载页后，验证不登录也能下载。**GitHub draft release 的地址不能当公开下载地址。**

你在干净用户环境按 `first-install-checklist.md` 操作并记录结果。不要先卸载你日常使用的 CLI；使用另一台 Mac 或独立 macOS 用户做干净验证。两种架构必须各验；只有一种通过时，先明确缩小支持范围并同步包与文案，不能把未测试架构写成已支持。

## 5. 公开隐私政策和下载入口

源码已准备 GitHub Pages 工作流 `.github/workflows/pages.yml`。建议使用现有仓库部署，免买新域名。

1. 先把本次分支的代码和工作流合并到仓库默认分支（由我处理代码与检查，正式合并前可供你审阅）。
2. GitHub 仓库 Settings → Pages → Build and deployment → Source 选择 **GitHub Actions**。
3. Actions → **Publish Lectern support and privacy pages** → Run workflow。`download_url` 填第 4 步已公开且可下载的 companion release 页。
4. 打开工作流输出的实际 `page_url`。若仓库使用默认域名，预期为 `https://zhurudong.github.io/lectern/`；**以实际部署结果为准，不把预期地址当已发布**。
5. 在未登录窗口打开首页、`privacy.html`、`privacy.zh-CN.html`；核对含 AI/CLI 处理说明，下载链接能正常到达正式安装包。

这时把真实 URL 给我，我重新构建扩展，使内置安装指引指向该公开下载入口，再生成正式上传 ZIP。`site/` 内页面也可部署到你已有的其他 HTTPS 静态站点。

## 6. 上传新版本（你操作商店后台）

只有交付目录出现 `final-upload/lectern-版本-ai-web-store.zip` 且 `status.json` 为 `ready-for-manual-review`，才进入这一步。

1. 回到第 1 步确认的同一个 Lectern 条目。
2. 打开“软件包 / Package”，选择上传新软件包，选 `final-upload/` 中的 **AI 扩展 ZIP**。
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
| 主页 | 第 5 步真实发布的页面 URL |
| 支持网址 | https://github.com/zhurudong/lectern/issues |
| 成熟内容 | 当前代码阅读工具不包含成人内容，保持关闭 |
| 视频 | 没有真实演示视频就留空，不填占位地址 |

截图展示的是实际候选界面，03 是首次安装引导，**不宣称已连到模型**。推广图使用全局英文文案，未沿用旧的全产品“零网络、只读”宣传。

先保存草稿；两种语言的功能、系统要求和外部依赖必须一致。[商店详情与本地化](https://developer.chrome.com/docs/webstore/cws-dashboard-listing)

## 8. 填隐私权规范和审核说明

1. 对照 `privacy-fields.html` 从上往下填写单一用途、每项权限、远程代码和数据类别。
2. 隐私政策 URL 填第 5 步验证过的 `privacy.html` 完整 HTTPS 地址。
3. “测试说明 / Test instructions”粘贴 `reviewer-notes.en.txt`。如有独立网址栏，补正式 companion 下载页；不要提供你的私人 CLI 账号或密钥。
4. 分发保持现有条目的地区、公开范围与免费设置；除非你决定改变。AI 模型的单独账号/费用已在描述里披露。
5. 查看后台错误清单。真实缺少的字段需要补齐；不能仅为消除错误勾选不符合实际的隐私承诺。

## 9. 提交审核和正式上线

所有包、链接与安装验证完成后，检查预览页面：名称/文案/截图互相一致，隐私与下载页可访问，旧的零网络承诺已更新。

点击“提交审核 / Submit for Review”。建议使用审核通过后手动发布：在最终确认对话框中关闭自动发布选项，先看审核结果。审核通过后，再检查一次下载入口并点击发布。延期发布有有效期，以后台显示为准。

新增权限可能使现有用户需要重新启用扩展。发布后，从商店安装做一次真实升级/首次终端验证；自动化本地测试不能替代该环节。[Google 提交流程](https://developer.chrome.com/docs/webstore/publish/)

## 当前无需你做的事

不需要自己修改 manifest、压 ZIP、复制 token、启动常驻服务或安装 Node 给最终用户。代码、配图、说明和构建步骤由我维护。你只承担账号/身份步骤、真实系统安装验证，以及浏览器工具禁止代办的商店后台操作。

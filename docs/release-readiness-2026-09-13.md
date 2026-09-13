# Chrome Web Store 发布检查（2026-09-13）

> 以下为初次审计快照；后续实现与验收状态见 [0.4.0 发布候选交接](release-candidate-0.4.0.md)。

结论：当前工作区不应直接作为正式发布包。功能 spike 已跑通，但发布基线、国际化、隐私承诺、安装分发和发布自动化尚未闭合。

范围：当前 `spike/ai-terminal-layer-one` 工作区、已有 dist/dist-ai、仓库本地 main、发布文档和官方 Chrome 发布要求。本轮没有修改产品代码、合并分支、安装程序或提交商店。商店后台、当前线上版本、账号验证和签名凭据未直接核验；线上 0.3.5 信息来自仓库已有 2026-09-12 发布调查记录，不能替代提交前后台核验。

## P0：发布前必须解决

### 1. 发布基线分叉，当前包版本落后

- 当前 HEAD `76037cf`，主包、lockfile 和 manifest 均为 0.3.1。
- 本地 main `e72427f` 的 manifest 为 0.3.5；main 与 HEAD 分别有 21 / 6 个独有提交。
- main 含 `src/i18n/index.ts`、`messages.ts`，当前分支均无；代码语言能力也发生分叉。当前工作区仍有大量未提交及未跟踪的实现文件。
- 现有 `docs/web-store/0.3.5.*.txt` 明确只描述旧发布包，不描述本次 AI、SQL 大纲和自动打开文件功能，不能复制为新包说明。

处理：保存当前改动，在隔离发布分支整合 main 的阅读器与当前 AI 功能，保留国际化和语言能力。核验商店已上传最高版本，选择更高版本，统一 manifest/package/lock/tag/release notes。不要只把 0.3.1 的数字改大。

### 2. AI 产品隐私与宣传存在实质冲突

- `PRIVACY.md` 开头承诺不发送任何内容、不在浏览器外存储；第三方一节写没有第三方。
- AI Companion 实际会在本机保存目录关联，启动用户 CLI；CLI 可以修改项目并按自身设置向模型服务发送内容。
- 欢迎页仍写“零网络、只读…全部在本地完成”。终端面板已有局部声明，但不能替代整套产品描述。
- `SECURITY.md` 和现有商店文案主要描述标准阅读器，不覆盖 native host、目录授权、进程生命周期等新增边界。

处理：明确“阅读器本地只读；可选终端启动有写权限及联网能力的本机 CLI”，分别说明扩展、伴随程序和第三方 CLI 处理的数据、用途、存储位置、删除方法及第三方责任。更新中英文隐私政策、首页、短描述、帮助和商店隐私表单，不能把“维护者不收集”写成“任何组件都不传输”。提供公开可访问的政策 URL；当前后台地址与披露未核验。

依据：[数据披露要求](https://developer.chrome.com/docs/webstore/program-policies/disclosure-requirements)、[隐私表单](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)。这是产品与披露一致性问题，不等于已判定商店会拒绝某项具体声明。

### 3. 伴随安装分发仍是开发状态

- AI 安装页的下载位置仍显示“此开发构建尚未配置正式下载地址”。
- 本机现有 pkg 明确为 UNSIGNED-DEV，仅 arm64 实际构建验证；内置 allowed_origins 为开发扩展 ID，不是已确认的正式条目 ID。
- 已有签名/公证构建代码，但正式证书、公证与干净 Mac 安装/升级/卸载未完成。
- 新用户不应填写扩展 ID、运行 npm 或复制源码来安装伴随程序。

处理：决定升级现有条目还是另立 AI 条目；确定正式 ID 后绑定主机 allowlist，发布按架构区分的 macOS 包，配置真实 HTTPS 下载入口。执行签名、公证、下载完整性和干净机器验收。签名/公证是 macOS 分发体验要求，不是声称 Chrome 扩展 ZIP 本身需要 Apple 签名。

### 4. 现有发布工作流发不出 AI 产品

- `.github/workflows/release.yml` 仅运行 `npm run build`，从 dist 生成 ZIP；按现状触发会发布没有 AI 入口的纯净版。
- CI 未加入 AI build、native PTY/身份验证、AI E2E、macOS 安装产物检查。
- 扩展 AI build 在缺下载 URL 时仍成功；pkg 的 `--release` 校验不覆盖扩展发布流程。
- 现有商店 ZIP 的 manifest 根目录布局校验是正确的，应保留。

处理：明确产物矩阵，保留标准构建门禁，为 AI 增加 macOS CI/发布 job 和 release-mode 配置检查。要求版本、名称、下载 URL、正式 ID/allowlist、协议兼容性、许可文件一致，杜绝把 spike 包当正式包。提交代码并固定可复现的 release commit 后再打包。

### 5. 完整回归尚未通过

- 本轮重新执行 `npm run check`，exit 0。
- 最近一轮宽度调整的 AI 构建、AI 不变量和独立 Chrome E2E 通过，包含扩大宽度、缩窗、输入输出、resize、身份拒绝与生命周期；此次审查没有重新跑整个 check:ai。
- 完整阅读器 `scripts/e2e.mjs` 最近连续两轮 284/286、exit 1：devFixture 含 createWritable 与 dev 产物门禁冲突；大目录折叠等待超时，后续测试未执行。
- 前一问题的夹具和 E2E 文件与分支 HEAD 相同；后一问题根因未确认，不能直接宣称不是回归。

处理：整合发布基线后定位两项失败，保留负向守卫，补旧版本升级、安装/卸载、新项目、英文界面、最低支持 Chrome 和 macOS 验收。不能以 npm run check 通过替代完整发布验收。

## P1：国际化、命名与商店配置

### 6. 国际化需要恢复并覆盖新增入口

当前没有 UI 国际化模块、语言切换、`public/_locales` 或 `default_locale`。manifest 描述、action title、viewer 的 lang、AI 终端、安装 HTML、native 错误和系统目录选择说明均为中文。仅准备英文商店介绍不代表产品已支持英文。

处理：复用 main 的 UI 语言框架；至少补 en / zh_CN 的 manifest 消息及 default_locale，名称/描述/action title 使用消息占位。新增 AI、本地文件设置、SQL 等 UI 纳入翻译，维护 HTML lang；伴随程序错误使用稳定 code 由 UI 翻译，系统提示传入明确语言。验证英语浏览器首启、手动切换、保存/恢复、缺 host/CLI/目录/版本错误及窄面板布局。多语言不是商店普遍强制要求，但如果宣称英语支持，就必须实际具备。

依据：[Chrome 国际化 API](https://developer.chrome.com/docs/extensions/reference/api/i18n)。

### 7. 产品名称需要去掉研发标记并说明用途

- 标准 manifest、页面标题和顶栏为 Lectern。
- AI manifest 为 `Lectern AI (opt-in spike)`。
- 伴随应用为 Lectern Companion；npm 包描述仍为 loopback，package 版本 0.1.0，而 native/pkg 版本 0.2.0。组件版本可以独立，但应标明组件与协议关系，避免同一伴随程序元数据互相矛盾。

建议维持品牌 Lectern，商店标题使用清晰用途，例如 `Lectern — Code Reader & AI Terminal`，中文 `Lectern — 代码阅读与 AI 终端`；伴随程序固定 Lectern Companion。标准离线构建仍可保留，不自动推导必须发布两个商店条目。

商店已有另一个提供网页阅读/摘要的 [Lectern 产品](https://chromewebstore.google.com/detail/lectern-%E2%80%94-reader-mode-ai/oijigankkdblbcafenbdglhjnpladblc)。这是搜索辨识问题，不是商标侵权结论；标题强调 Code Reader 有助区分。

### 8. 权限应逐项解释，升级路径需要实测

当前 AI permissions：storage、declarativeNetRequestWithHostAccess、nativeMessaging；host_permissions 仅 file:///*；无 HTTP(S) host、content scripts。标准版没有 nativeMessaging。现有 CSP 收窄为 self/file，无网络 WS 例外，架构方向正确。

商店说明应对应：storage 保存用户设置；DNR 和 file:///* 用于用户启用的本地文件自动打开；nativeMessaging 用于用户打开终端后连接本机 PTY。阅读器选目录与“允许访问文件网址”是两套授权，不能混淆。当前自动打开配置默认 enabled=true，需在引导中如实说明启用 Chrome 文件 URL 访问后的行为，并保留可见关闭入口。

旧发布条目权限为空，升级到新包的提示/重新授权及已有项目数据保留需要测试。单一用途建议描述为“在本机项目中阅读代码并使用用户选择的开发终端”，权限解释要具体，不能只写“功能需要”。

### 9. 平台与依赖条件要提前显示

伴随程序仅 macOS，arm64 已验证；x64 构建支持尚无实机记录，Windows/Linux/ChromeOS 不可宣传支持终端。阅读器本身的支持范围应单列。目前非 macOS 用户仍会看见统一 macOS 安装指引，应改为清晰的“不支持此系统的终端”状态，并让阅读器继续可用。

商店说明和截图应写清：Chrome >=122；终端需单独安装免费伴随程序及 CLI；CLI 登录/订阅由各服务管理；新目录首次额外关联；关闭终端结束进程，不承诺恢复对话。最低版本和平台声明要经对应环境验证，不能仅来自 manifest 数字。

### 10. 商店素材尚未形成新版本套件

图标文件 16/32/48/128 像素尺寸均正确。仓库现有文档截图为 2880×1800 或 1360×820，不直接满足商店截图尺寸；未找到本次 AI 版本专用 440×280 推广图及成套中英文截图。后台可能已有素材，本轮未核验。

准备：128×128 图标；440×280 小推广图；至少一张 1280×800 或 640×400 实际产品截图，建议覆盖阅读器、搜索/Git、右侧终端和首次安装说明。不要拿纯阅读器旧图表达 AI 版，也不要暴露个人项目、密钥、账号。中英文短描述/长描述需匹配新构建。

依据：[Chrome 商店图像规范](https://developer.chrome.com/docs/webstore/images)。

### 11. 发货包没有附带许可文本

根目录 THIRD-PARTY-NOTICES 包含 xterm 等许可，但当前 dist / dist-ai 内未找到 LICENSE 或 notices；工作流 Web Store ZIP 直接压缩 dist，不会自动携带根目录文件。

处理：根据实际依赖许可将 Apache LICENSE 与第三方版权/许可文本随最终扩展包分发；伴随程序已有 Node 和 native 模块许可，仍需检查实际产物覆盖。源码仓库里有文件不等于 ZIP 已包含。此项是许可分发核对，不推断商店已因此拒审。

## 后台和外部条件：待维护者核验

- 正式条目 ID、当前已发布/草稿最高版本、发布到原条目还是新条目。
- Developer 账号注册状态、双重验证、可验证联系邮箱；此前文档记录有 passkey 重认证，当前状态未知。
- 分类、语言、地区、分发范围、支持 URL、隐私 URL、单一用途和逐权限说明、数据处理披露。
- 为审核人员提供明确的 macOS 安装包、安装步骤、无需私人项目的示例、CLI 依赖/登录说明；不提供个人账号凭据。
- HTTPS 发布入口可用性、正式签名身份/公证 profile、更新与卸载路径、CLI 错误支持说明。
- 依赖漏洞扫描、实际 macOS 签名/公证、商店草稿内容本轮未核验。

官方参考：[发布流程](https://developer.chrome.com/docs/webstore/publish)、[版本格式](https://developer.chrome.com/docs/extensions/reference/manifest/version)。

## 建议实施顺序

1. 明确正式条目与产品名称；保存改动，整合 main，恢复国际化与已有阅读器能力。
2. 补新功能翻译和分组件隐私文案，消除“整体只读/不联网”的误导承诺。
3. 绑定正式 ID，完成 macOS 签名包、HTTPS 分发与安装页下载入口。
4. 统一 release 元数据、许可文件、AI/macOS CI；修复完整回归后验证干净安装及原版本升级。
5. 生成对应版本中英文商店文案和素材，核对后台配置，再提交审核。

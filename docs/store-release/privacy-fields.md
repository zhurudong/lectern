# 隐私权规范：逐字段填写

适用：0.4.0 AI 构建。这里的“处理用户数据”包含本机处理；“维护者没有收集服务器”不等于可以全部选择“未处理数据”。

## Single purpose / 单一用途

Help users read, understand and review local source code in Chrome, with an optional adjacent terminal for their own locally installed coding assistant.

## storage

Stores local reader preferences, automatic file-opening choices, and project association identifiers. Data is stored on the user's device. It is not used for analytics or advertising.

## declarativeNetRequestWithHostAccess

Redirects navigations for user-selected local file suffixes into Lectern's bundled reader after the user enables automatic opening and Chrome file URL access. Rules apply only to file:// URLs; the extension does not intercept Internet traffic.

## Host permission: file:///*

Reads the local file URL the user opens and applies the selected automatic-opening rules. Chrome file URL access is required separately. This permission does not grant access to HTTP(S) websites. The file/folder picker remains available without enabling automatic file-URL opening.

## nativeMessaging

Connects to the separately installed Lectern Companion on the same Mac. Chrome passes terminal input/output, dimensions, selected CLI and project association data over local stdio. The companion starts the user's installed CLI only when the user opens the terminal. The reader works without the companion. No remote Lectern service is involved. The CLI may modify files and contact its own model provider.

## Remote code / 远程代码

选择 No。说明（如有输入框）：

All JavaScript and other executable browser resources are packaged in the extension. It does not download or evaluate remote scripts or WebAssembly. The optional, separately installed macOS companion runs outside the browser using Chrome Native Messaging. Its source and installer are supplied for review; it launches a CLI explicitly chosen by the user and returns terminal output as data.

该判断针对浏览器执行的扩展代码，不是隐瞒伴随程序。必须在审核说明中附上实际安装包下载与源码地址。

## Data usage / 数据使用

当前 AI 版按实际处理能力保守申报以下类别；分类依据是数据经过本机终端，不代表发送给 Lectern 维护者。若后台标签有差异，按定义匹配，勿机械套用。

| 后台类别 | 本次选择 | 对应行为 |
| --- | --- | --- |
| Website content / 网站内容 | 勾选 | 用户选择的本地代码、Markdown、文本、图片及终端内容 |
| User activity / 用户活动 | 勾选 | 终端按键和命令输入；没有网页点击/鼠标轨迹遥测 |
| Authentication information / 身份验证信息 | 勾选 | 用户在 CLI 交互登录中输入的认证信息可能经终端传递；扩展不主动提取系统凭据 |
| Personally identifiable information / 个人身份信息 | 勾选 | CLI 输出或登录中的账号标识；本地绝对路径可能包含用户名称 |
| Personal communications / 个人通信 | 勾选 | 用户与自己选择的 AI CLI 进行的提示和回复交互 |
| Financial/payment、Health、Location、Web history | 不勾选 | 当前功能未专门采集这些类别；不读取浏览器历史、定位或支付资料。用户主动打开的任意文件可能包含敏感内容，隐私政策已说明文件内容范围 |

这是按当前代码行为给出的申报建议，不保证审核结果。不要因为没有遥测而把前五项全部取消。

如果后台提供文本说明，可粘贴：

Data is processed locally to display user-selected files and relay the optional CLI terminal. Lectern has no developer-operated collection or telemetry backend. Terminal input/output may include user-provided source code, prompts, account identifiers or CLI authentication input. The selected CLI independently controls its provider connections and retention. Lectern does not read browser history or monitor other websites.

## 用途承诺

在确认这些承诺与自己的实际运营一致后，勾选后台要求的声明：不出售用户数据；不用于与单一用途无关的目的；不用于信用或贷款评估。不要额外添加数据运营、广告或分析 SDK。

隐私政策 URL：填写 `https://github.com/zhurudong/lectern/blob/companion-v0.2.1/PRIVACY.md`。该固定源码版本的政策已核对无需登录即可访问，覆盖 AI/CLI 行为。中文政策为同一标签下的 `PRIVACY.zh-CN.md`。

依据：[Google 隐私字段](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)、[本机数据处理仍需披露](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)、[远程代码定义](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code)。上述类别对应关系是基于本仓库实现的判断。

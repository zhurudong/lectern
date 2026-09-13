# 发布材料的可复现构建

初次或代码改动后，依次执行：

```sh
npm run build
npm run check
npm run build:ai
npm run check:release
npm run shots:store
npm run prepare:store
```

生成 `release-artifacts/web-store-<version>/`。截图只使用隔离 Chrome 配置，native 注册指向不存在的测试主机，确保不启动开发者机器上的真实伴随程序。03 截图真实展示首次使用安装状态。新的宣传图不修改产品截图。

默认读取 `release-config.json`，其中已记录用户确认的正式扩展 ID；后续逐项补齐。`confirmedUpload` 记录用户已确认可上传的具体扩展 ID 和版本，不虚构未知的历史最高版本；已有明确版本冲突时仍会阻止生成正式包。另备 `release-config.example.json` 供复制到本机不入库的位置填写；只包含发布元数据，不放证书私钥或账号密码。正式准备时 `companionPackages` 应为两个对象：`{ "arch": "arm64", "path": "对应分发模式的包绝对路径" }` 与 `x64` 对应项。只有完成实际核验，才把 `storeIdConfirmed` 和 `cleanInstallVerified` 设为 true。

正式候选构建使用核验后的公开下载页：

```sh
LECTERN_RELEASE=1 \
  LECTERN_DOWNLOAD_URL=https://github.com/zhurudong/lectern/releases/tag/companion-v0.2.1 \
  LECTERN_COMPANION_DISTRIBUTION=unsigned npm run build:ai
# 真实安装验收未完成时先生成候选交付材料
npm run prepare:store
# 记录真实安装验收后生成正式上传包
npm run prepare:store -- --final
```

`companionDistribution` 明确选择 `signed` 或 `unsigned`。signed 验证签名与公证；unsigned 验证未签名标记、安装页披露。两者都核对包内 origin、版本、运行时及 PTY 架构、SHA-256、双语安装页下载入口、链接 HTTP 响应及页面内容。成功才生成 `final-upload/`。这些是技术检查；`cleanInstallVerified` 是操作者提供的验收记录，不是机器测得的成功状态。脚本不会上传文件、创建 Release、接受条款或提交商店。

GitHub Pages：工作流只在手动触发时发布 `release-artifacts/public-site/`。页面从根目录中英文隐私政策生成，不复制旧商店文案。下载参数留空时页面明确说明未提供正式下载，不能用来冒充已完成的终端分发。

GitHub 未签名包：`npm run package:companion -- --unsigned-release --extension-id <正式ID> --arch arm64 --node-archive <官方归档>`，x64 同理。默认不加参数仍为开发包；`--release` 仍是需要证书和公证的签名路径。正式扩展构建和验收配置 `LECTERN_COMPANION_DISTRIBUTION=unsigned`。

商店 ID 的本地验收：公钥保存在 `extension-public-key.pem`，它是可公开的商店身份信息。按上面的公开下载地址构建 AI 包后，执行：

```sh
npm run prepare:store-test
npm run check:store-identity
```

准备脚本先计算公钥对应的 Chrome ID 并与已确认条目核对，然后只在 `release-artifacts/store-test-<version>/extension/` 副本中增加 manifest.key。连接检查使用独立 Chrome 配置及校验过的安装包原始内容，验证正式 ID 的真实握手和开发 ID 的拒绝；不替换系统 companion、不启动 CLI，不把此结果计作干净安装。该架构的报告保存在同目录的 `connection-check.json`。这些命令不操作 Chrome Web Store。

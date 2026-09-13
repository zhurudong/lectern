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
# 在本机环境中配置 LECTERN_DOWNLOAD_URL 为实际公开下载页
LECTERN_RELEASE=1 npm run build:ai
npm run prepare:store -- --final --config /绝对路径/release-config.json
```

`companionDistribution` 明确选择 `signed` 或 `unsigned`。signed 验证签名与公证；unsigned 验证未签名标记、安装页披露。两者都核对包内 origin、版本、运行时及 PTY 架构、SHA-256、双语安装页下载入口、链接 HTTP 响应及页面内容。成功才生成 `final-upload/`。这些是技术检查；`cleanInstallVerified` 是操作者提供的验收记录，不是机器测得的成功状态。脚本不会上传文件、创建 Release、接受条款或提交商店。

GitHub Pages：工作流只在手动触发时发布 `release-artifacts/public-site/`。页面从根目录中英文隐私政策生成，不复制旧商店文案。下载参数留空时页面明确说明未提供正式下载，不能用来冒充已完成的终端分发。

GitHub 未签名包：`npm run package:companion -- --unsigned-release --extension-id <正式ID> --arch arm64 --node-archive <官方归档>`，x64 同理。默认不加参数仍为开发包；`--release` 仍是需要证书和公证的签名路径。正式扩展构建和验收配置 `LECTERN_COMPANION_DISTRIBUTION=unsigned`。

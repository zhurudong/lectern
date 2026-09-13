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

复制 `release-config.example.json` 到本机不入库的位置填写；只包含发布元数据，不放证书私钥或账号密码。正式准备时 `companionPackages` 应为两个对象：`{ "arch": "arm64", "path": "签名包绝对路径" }` 与 `x64` 对应项。只有完成实际核验，才把 `storeIdConfirmed` 和 `cleanInstallVerified` 设为 true。

正式候选构建使用核验后的公开下载页：

```sh
# 在本机环境中配置 LECTERN_DOWNLOAD_URL 为实际公开下载页
LECTERN_RELEASE=1 npm run build:ai
npm run prepare:store -- --final --config /绝对路径/release-config.json
```

正式步骤检查本机签名/公证和包内 origin、运行时架构、双语安装页下载入口、链接 HTTP 响应及页面基本内容。成功才生成 `final-upload/`。这些是技术检查；`cleanInstallVerified` 是操作者提供的验收记录，不是机器测得的成功状态。脚本不会上传文件、创建 Release、接受条款或提交商店。

GitHub Pages：工作流只在手动触发时发布 `release-artifacts/public-site/`。页面从根目录中英文隐私政策生成，不复制旧商店文案。下载参数留空时页面明确说明未提供正式下载，不能用来冒充已完成的终端分发。

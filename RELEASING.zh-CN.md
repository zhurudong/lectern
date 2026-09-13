*[English](RELEASING.md) · 中文*

# 发布流程

**一次发布就是一个 git tag。** 其余全部由
[`.github/workflows/release.yml`](.github/workflows/release.yml) 完成 —— 这是有意
设计的：**让发布出去的 zip 可被证明是"已提交源码"的产物，而不是某个人笔记本上的
产物。**

```bash
# 1. package.json、package-lock.json 与 public/manifest.json 的版本号必须一致，
#    docs/releases/<版本>.md 必须存在，且全部已经提交
# 2. 打 tag 并推送
git tag v0.3.1
git push origin v0.3.1
```

流水线随后会：

1. 从干净检出构建（`npm ci && npm run build`）；
2. 跑 `npm run check` —— **过不了无远程传输 / 只读 / 权限与 CSP / 本地读取审计 /
   语言覆盖门禁的构建，永不发布**；
3. tag 必须同时匹配 `manifest.json`、`package.json` 与 lockfile，打错 tag 或只改了一半
   版本号的发布都出不去；
4. 从同一份 `dist/` 产出两份归档：手动安装用的 `lectern-<version>.zip`，以及
   Chrome 应用商店用的 `lectern-<version>-web-store.zip`；两份各自生成 `.sha256`；
5. 把四个文件连同 `docs/releases/<version>.md` 的发布说明一起发布。

## 规则

- **永不混淆。** 发布产物就是明文构建输出。**对一个开源扩展做混淆什么也保护不了**，
  而且 Chrome 应用商店明文禁止上架混淆代码。
- **不手工打包。** 不是从流水线里出来的 zip，就不许附到 Release 上。这个产物的全部
  价值在于**任何人都能从对应 tag 重新构建出同样的东西**。
- **可复现的是构建，不是 zip 的字节。** 那份 `.sha256` 标识的是**那一个文件**，用途是
  让人确认下载过程中没有被篡改；它**不是**"重新构建能得到逐字节相同的压缩包"这个承诺 ——
  zip 的元数据（条目顺序、时间戳、压缩参数）本来就会因机器而异。要验证产物，**从 tag
  重新构建并比对内容**，并在自己的构建上跑那两条不变量检查。
- **截图的可复现只到场景级，不到像素级。** 重跑一次出图脚本，字节必然全变（抗锯齿与
  渲染时序决定的）。所以**一张已发布的图来自哪一次运行是有意义的**。需要换图时，
  **整批在同一次运行里重出、一起提交**；只把其中一张换掉，会留下一个"来自两次运行的
  拼接基线"，而且**没有任何东西会因此变红**。对外发布的图是 `docs/images/` 与
  `assets/chrome-web-store/` 下的那 12 张；`scripts/*.png` 是工作图，不对外。12 张全部
  出自 `scripts/shot-readme.mjs`、`scripts/shot-store.mjs` 与
  `scripts/render-store-promos.mjs` —— **新增一张对外图，就要在同一个改动里补上产出它的
  脚本**，否则下一次换主题会静默地把它以旧貌发出去（0.3.2 备料时就正是这样差点发出去）。
- **不改已发布 Release 的 assets。** 要改就发一个新的补丁版本。
- **本地读取例外必须可审计。** 标准包只允许 `storage`、
  `declarativeNetRequestWithHostAccess` 与 `file:///*` 主机权限。门禁检查精确 CSP、
  可访问资源和 `local-file-reader.js` 固定摘要；其余产物仍禁止传输 API，全部产物仍
  禁止写入 API。读取模块有变更时，发布前必须完成审计与非本地地址负向检查。

## Chrome 应用商店

商店 listing 需手动上传（需要 Google 账号和商店自己的审核流程）。

1. 从对应 GitHub Release 下载 `lectern-<version>-web-store.zip`，**不要在本机重新构建
   或重新压缩**；
2. 把这个文件原样上传到既有 listing。它的 `manifest.json` 位于归档根目录，手动安装包
   不是这个结构；
3. 提交审核前，依据 [README.zh-CN.md](README.zh-CN.md) 和
   [语言支持矩阵](docs/language-support.md) 同步商店描述与更新说明，并按本次发布的
   源码重新核对能力数量和限制；
4. 上线后下载公开 CRX，与 tag 对应的 `dist/` 比较扩展载荷。商店签名时会加入
   `_metadata/` 与 `update_url`，这些差异正常；应用文件不同则不正常。

- [ ] **下次更新商店时补充：**72 种可预览后缀（45 种代码、2 种 Markdown、6 种图片、
  19 种纯文本，不含按完整文件名识别的文件），28 类语言／语法，以及 9 类、23 种后缀的
  大纲支持：Python、Java、C、C++、Go、JavaScript/JSX、TypeScript/TSX、Markdown、
  SQL。明确 Rust（`.rs`）仅支持预览与语法高亮，不支持大纲、定义跳转、查找引用或
  符号搜索。写入商店文案前重新核对这些数量。

两种归档是有意分开的：`lectern-<version>.zip` 外包 `lectern/` 目录，优化手动解压安装；
商店包则要求扩展文件位于归档根。二者来自同一份干净 CI 构建，但不再假装两种包装格式
可以逐字节相同。

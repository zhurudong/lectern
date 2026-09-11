*[English](SECURITY.md) · 中文*

# 安全策略

## 报告漏洞

请通过本仓库的 GitHub
[私密漏洞报告](https://docs.github.com/zh/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
渠道提交（Security → Report a vulnerability），**不要开公开 issue**。

没有赏金。

## 在这个项目里什么算漏洞

这个扩展的攻击面异常地小，其中两条性质是承重的。**破坏其中任何一条都是安全漏洞，
不是功能请求：**

1. **无远程传输。** 无遥测、无更新检查、无远程字体、无 CDN、无统计。所有资源都在
   包里。标准构建可在 Chrome 授权后读取本地 `file://` 地址，但不得连接 HTTP(S) 服务
   或远程文件主机，不得外传文件内容和路径。
2. **只读。** 绝不往用户打开的目录写任何东西。它持有你文件的读取权限，在你的项目里
   不创建任何东西，连标记文件和缓存都没有。

标准构建仅声明 `storage` 与 `declarativeNetRequestWithHostAccess`，主机权限只有
`file:///*`；仅将 `viewer.html` 对 `file:///*` 暴露为可访问资源。CSP 为
`script-src 'self'; object-src 'self'; connect-src 'self' file:`，没有内容脚本或
远程主机权限。

读取授权有两条路径：原生选择器授予所选文件或目录的句柄；Chrome 的**「允许访问文件
网址」**开关允许本地 URL 读取模块访问本机文件，扩展的后缀设置决定哪些顶层导航会被
自动打开。后缀设置不会缩小 Chrome 底层授予的文件访问范围。自动打开不会获得父目录
句柄，也不会开启 Markdown 相对资源解析。关闭 Chrome 开关可撤销 URL 访问，原生选择器
仍然可用。

可报告问题的具体例子：

- 任何可能导致外发请求的代码路径，包括意外的远程 `@font-face`、
  `<img src="https://…">`，或从渲染内容可达的 `fetch`；
- 任何对用户项目中 `FileSystemFileHandle` / `FileSystemDirectoryHandle` 的写入；
- 通过渲染文件内容实现的 HTML 或脚本注入（Markdown 经 DOMPurify 净化，**净化绕过在
  范围内**）；
- 未取得独立 Chrome 文件网址授权就越出选择器授权范围读取，或让渲染内容触发任意
  本地文件读取的方法；
- 绕过本地 URL 读取校验，接受 HTTP(S)、远程文件主机、重定向，或绕过 64 MiB 自动
  读取上限的方法。

"这个扩展**可以被改成**做这些事"不构成漏洞 —— 源码是公开的，任何人都能 fork。
**重要的是发出去的那个构建做了什么。**

## 自己验证

你不必相信上面任何一条：

```bash
npm ci && npm run build
node scripts/check-invariants.mjs
```

脚本按精确白名单检查产物的权限、可访问资源与 CSP，禁止全部产物出现写入 API，且
禁止唯一审计模块 `local-file-reader.js` 之外出现传输 API。该模块由固定摘要守住内容，
负向测试验证非本地和无效地址被拒绝；更新摘要前必须审阅读取行为。**请先读检查，再
依赖这些结论。**

构建可从源码复现，Release 里的 zip 就是 `npm run build` 的明文产物，**不做混淆**。
在浏览器里也可检查 DevTools → Network：本地 `file://` 读取与扩展资源是正常行为，
不应出现外发 HTTP(S) 请求。

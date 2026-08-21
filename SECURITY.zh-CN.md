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

1. **零网络。** 运行期不发起任何网络请求 —— 无遥测、无更新检查、无远程字体、无 CDN、
   无统计。所有资源都在包里。`manifest.json` 的 `permissions` 是空数组，且没有
   `host_permissions`。
2. **只读。** 绝不往用户打开的目录写任何东西。它持有你文件的读取权限，在你的项目里
   不创建任何东西，连标记文件和缓存都没有。

可报告问题的具体例子：

- 任何可能导致外发请求的代码路径，包括意外的远程 `@font-face`、
  `<img src="https://…">`，或从渲染内容可达的 `fetch`；
- 任何对用户项目中 `FileSystemFileHandle` / `FileSystemDirectoryHandle` 的写入；
- 通过渲染文件内容实现的 HTML 或脚本注入（Markdown 经 DOMPurify 净化，**净化绕过在
  范围内**）；
- 任何能让扩展读到用户授权目录**之外**文件的方法。

"这个扩展**可以被改成**做这些事"不构成漏洞 —— 源码是公开的，任何人都能 fork。
**重要的是发出去的那个构建做了什么。**

## 自己验证

你不必相信上面任何一条：

```bash
npm ci && npm run build
node scripts/check-invariants.mjs
```

脚本会先打印它检查哪些符号，再在产物里检查，命中即失败。**请先读它** —— 它很短、
无依赖，重点就在于**你不需要相信这份文档里的任何一句话**。

构建可从源码复现，Release 里的 zip 就是 `npm run build` 的明文产物，**不做混淆**。
在浏览器里你也可以开着 DevTools → Network 用一整个会话，看它始终是空的。

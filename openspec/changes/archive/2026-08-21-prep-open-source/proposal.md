## Why

开源在即。开源会把"零网络"从**一句我们说的话**变成**任何人都能跑的一条检查** —— 而合规敏感用户认的正是后者那种证据("它根本没有能力做坏事",而不是"它保证不做")。

现状有三处挡路,都不是产品缺陷,但都会在开源那一刻变成问题:

1. **构建产物里有一个 `fetch(`**,来自 Vite 默认注入的 modulePreload polyfill(实测确认:`fetch(r.href, s)`,在 `link[rel=modulepreload]` 兜底逻辑里)。运行时它只会去取 `chrome-extension://` 的本地资源,**零网络承诺没有被违反**;但它让这条承诺**无法用一条命令自证** —— 用户 grep 出一条命中,我们就得开始解释,而**解释得再对,信任也已经掉一格**。
2. **`scripts/e2e.mjs` 不可移植**:写死了本机绝对路径与 Chrome 路径。外部贡献者克隆下来跑不了验收,CI 也接不上 —— 而"你可以自己验证"正是这个项目开源后的主要信任来源之一,**跑不起来等于没有**。
3. **版本号仍是 0.1.0**,而内容早已是 0.2 形态。

## What Changes

- **关闭 Vite 的 modulePreload polyfill**(`build.modulePreload = { polyfill: false }`)。`minimum_chrome_version` 是 122,原生 modulepreload 支持早已覆盖,**这段 polyfill 是纯死重**。关闭后实测产物中 `fetch(` / `XMLHttpRequest` / `WebSocket` / `EventSource` / `sendBeacon` **全部零命中**。
- **把"产物中不含网络 API 符号"升格为 spec 要求**,而不只是一次性清理 —— 否则某次工具链升级重新注入 polyfill,没有任何机制会发现,而对外文档与 CI 门禁都已经建立在这条性质上。
- **`scripts/e2e.mjs` 可移植化**:`PROJECT` 由脚本自身位置推导;`CHROME` 读环境变量并按平台给默认值(macOS / Linux / Windows)。纯测试基建,不碰产品行为。
- **版本统一到 `0.2.0`**(`package.json` + `public/manifest.json`)。
- **产品更名 Code Viewer → Lectern(读码台)**。理由:"Code Viewer" 在 Chrome 商店已被"看网页源码 / 看扩展源码"那一类占满,**会被系统性误读成另一种东西** —— 这不是审美问题,是新用户第一眼就把我们归错类。

  更名波及面已核实:`public/manifest.json`(name / description)、`viewer.html`(title)、`src/app.tsx` 与 `src/welcome/Welcome.tsx`(界面文案)、`README.md`、`docs/prd-v0.2-reading-first.md`、两个图标 SVG 的注释。**主 spec 中零处** —— 规格一直写的是"查看器"这个通称而非产品名,所以更名对规格是零成本。这是当初那个写法的意外红利。

## Capabilities

### Modified Capabilities

- `project-access`:「权限边界」增加**零网络的可自证性**要求 —— 构建产物中不得出现网络 API 调用符号,使承诺可被一条检查验证;并把该性质与 `minimum_chrome_version` 的依赖关系写明。

## Impact

- `vite.config.ts`(一行构建配置)、`scripts/e2e.mjs`(路径推导与平台默认值)、`package.json` / `public/manifest.json`(版本号)。
- **不碰任何产品行为**:`src/**` 零改动。
- 与 `restyle-modern-ide` 的文件交集:更名要碰 `src/app.tsx` / `src/welcome/Welcome.tsx`,而 restyle 主要碰 `src/styles.css` / `src/preview/cmTheme.ts` —— **交集小但不为零**,需按产品阶段的安排由发布阶段在 restyle 落地时统一改,避免抢文件。
- **发货节奏(用户 2026-08-20 拍板)**:键盘导航 + restyle + 0.2.0 + 更名作为**一个完整包**同时发,键盘那条先归档但不单独发货。

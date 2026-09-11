# 实施规格:Lectern AI 终端(lectern-agent)

> 交给实现方(Codex)执行的自包含规格。读完即可开工,不需要额外上下文。
> 目标是一个**可证伪的最小 spike**,不是完整产品。

## 1. 背景(自包含)

- **Lectern(读码台)** 是一个 Chrome MV3 扩展,只读代码阅读器:CodeMirror 6 + Lezer + Preact signals + File System Access API。当前已发布 **0.3.5**。
- 三条核心不变量,由 `scripts/check-invariants.mjs` 静态校验:**零网络**(发货包里无 `fetch`/`XHR`/`WebSocket`/`EventSource`/`sendBeacon`)、**只读**(无 `createWritable`/`showSaveFilePicker`/`removeEntry`)、**空权限**(manifest 无 permissions/host_permissions/content_scripts,不覆盖 CSP)。
- UI 已全量 i18n(`src/i18n/`,`t(key)`,zh/en 对齐)。面板类组件(引用/全文/大纲)共用 `src/lib/useOverlayKeyboard.ts` 的焦点/键盘机制。

## 2. 这次要做什么(一句话)

让用户在读码台里读代码时,能在扩展内的**终端面板**里直接用一个 AI 编码 agent(默认 **Codex**,可配 `claude` 等),做到"**装一个本地小程序 + 打开读码台即可用**"。

**硬约束**:Chrome MV3 扩展**沙箱里起不了 shell**。所以必须有一个本地伴随程序,扩展通过它间接拿到终端。

**非目标(v1 明确不做)**:不做 OpenTelemetry/状态 hook(忙/闲徽标)、不做 autopilot、不做多 agent 编排、不做手机端;扩展内**不**直连任何云端 LLM(模型由 agent CLI 自己管)。

## 3. 架构:两部分

### A. `lectern-agent`(本地 Node 伴随程序)
- 提供方式:`npm i -g lectern-agent` 后跑 `lectern-agent`;或 `npx lectern-agent`。可选做开机自启(login item),让"打开扩展即用"成立。
- 职责:
  1. 在 **`127.0.0.1`**(**绝不** `0.0.0.0`)上起一个 WebSocket 服务,默认端口 `8137`(可配)。
  2. 收到客户端 `start` 后,用 **node-pty** 在指定工作目录 `cwd` 里 `spawn` 配置的 agent 命令(默认 `codex`)。**就是把用户已装好、登录好的那个 CLI 原样开起来,不做任何注入**。
  3. 双向管道:PTY 输出 → ws;ws 输入 → PTY stdin;支持 `resize`。
  4. v1 单会话即可(多会话可留后续)。
- **不需要任何遥测/hook**——那是状态追踪(忙/闲)才要的,本 spike 不做。

### B. Lectern 扩展:新增 "AI 终端" 面板
- 用 **xterm.js**(+ `@xterm/addon-fit`)在一个面板里渲染终端;复用现有 overlay/面板与 `useOverlayKeyboard` 的形态(不新造焦点逻辑)。
- 打开时连 `ws://127.0.0.1:<port>`;连不上时给一条清楚的提示("请先运行 `lectern-agent`")。
- xterm ↔ ws 双向管道;窗口变化用 fit addon 同步 `resize`。
- v1+ 可选:一个"把选中代码 / 当前文件 + 问题拼成提示词发进终端"的入口(喂给 agent)。v1 可以先只做纯终端。

## 4. 协议(ws,最小 JSON 帧)

- client → agent:
  - `{ "type": "start", "cwd": "<abs path>", "cmd": "codex", "cols": 80, "rows": 24, "token": "<token>" }`
  - `{ "type": "stdin", "data": "<utf8>" }`
  - `{ "type": "resize", "cols": N, "rows": N }`
- agent → client:
  - `{ "type": "ready" }` / `{ "type": "data", "data": "<utf8>" }` / `{ "type": "exit", "code": N }` / `{ "type": "error", "message": "..." }`
- 也可直接用 `@xterm/addon-attach` 的原始字节管道 + 一条独立控制消息做 `start`/`resize`,二选一,实现方定。

## 5. 安全(**破零网络后必须做,别省**)

在本机开一个能起 shell 的 localhost 服务是**真实攻击面**:任何网页都能尝试连 `ws://localhost` 驱动它(DNS-rebinding / 恶意站点)。必须:
1. **只绑 `127.0.0.1`**。
2. **强制 token**:`lectern-agent` 首次生成并存一个 token(如 `~/.lectern-agent/token`),扩展侧配置同一 token(设置项或首次配对);无 token / 不匹配一律拒绝。
3. **校验 `Origin`**:只接受来自本扩展 origin 的连接。
4. 文档明确:agent 以用户 shell 权限运行,能力很大,用户需知情。

## 6. 对不变量 / 打包的影响(读码台的产品公理,**要显式、可控**)

- 加 localhost WebSocket **会破坏静态"零网络"保证**。要求:**把 AI 终端做成 opt-in、显式声明的能力**,并**保留纯净档**(不开 AI 时 `check-invariants.mjs` 照常全绿)。
- 两种落地任选:(a) 构建开关 / 独立产物:纯净版无任何 ws;AI 版单独打;(b) 放宽不变量为"**除 `ws://127.0.0.1` 且仅在开启 AI 时**外零网络",配**收窄的、带说明的例外** + UI 顶部**明确标注**"AI 终端连接本地伴随程序;你的代码由 \<agent\> 按其自身设置处理"。
- **CSP**:扩展页发起 WS 需 `connect-src` 允许 `ws://127.0.0.1:*`;更新 AI 版产物的 CSP,纯净版不动。
- 更新 `scripts/check-invariants.mjs` 与 `scripts/check-git-ui-contracts.mjs`:把这条例外写成**收窄断言 + 负向控制**(关了 AI 一个网络符号都没有;开了 AI 只允许那个 localhost ws)。

## 7. 首次使用动线(= 用户要的"装一个程序,打开即用")

1. 装好并登录 agent CLI(`codex` / `claude`)——前提,用户已有。
2. 装 `lectern-agent` 并让它跑着(可开机自启)。
3. 打开读码台 → AI 终端面板**自动连上** → 立刻能用;没连上就显示一行启动指引。

## 8. 验收标准(v1 spike)

1. `lectern-agent` 启动,绑 `127.0.0.1`,强制 token,校验 Origin。
2. 扩展打开 AI 终端面板 → 连上 → 在项目目录里显示活的 `codex`(或 `claude`)会话;按键送达 agent、输出正常渲染、resize 生效。
3. **纯净档(AI 关)仍过 `check-invariants.mjs`(零网络)**。
4. AI 档:`connect-src` 仅 `ws://127.0.0.1`;UI 有可见标注;无其它网络。
5. E2E:一条用例 loopback/mock 该 ws、断言面板双向管道;另一条断言 **AI 关时无任何 ws 连接**;一条断言**无 token / 异 origin 无法驱动 agent**(安全负向控制)。
6. 不引入任何直连云端 LLM 的代码。

## 9. 建议目录 / 技术选型

- 新增 `lectern-agent/`(独立 Node 包或子目录):`node-pty` + `ws`。
- 扩展:`src/ai/AiTerminal.tsx`(xterm 面板)、`src/ai/agentClient.ts`(ws 客户端)、接入预览区/面板 + 顶栏一个开关;设置项(端口 / token / 默认 agent 命令)存 localStorage。
- 依赖:`@xterm/xterm`、`@xterm/addon-fit`、(可选 `@xterm/addon-attach`)、`node-pty`(仅 agent 侧)、`ws`(仅 agent 侧)。

## 10. 开源参考(可抄/可读,注意 license)

- **xterm.js**(MIT):https://github.com/xtermjs/xterm.js
- **node-pty**(MIT):https://github.com/microsoft/node-pty
- **CliDeck**(MIT,rustykuntz/clideck):PTY + ws + spawn agent 的现成后端,**可直接作层一参考**。https://github.com/rustykuntz/clideck
- **dodo/chrome-terminal**:若倾向用 Native Messaging 而非 localhost ws 的替代路线。https://github.com/dodo/chrome-terminal
- ⚠️ **NodeTerm 是 BUSL-1.1**(禁止用于竞品),**不要拷它的代码**。

## 11. 默认值 / 留给实现方的小决定

- 默认 agent 命令:**`codex`**(可配)。
- 传输:**localhost WebSocket**(推荐,门槛最低)vs Native Messaging(更"正规"但装得更麻烦)。默认 ws。
- 端口:默认 `8137`,可配。
- 会话数:v1 单会话即可。

---

**一句话总纲**:做"层一"——`lectern-agent`(node-pty + ws + spawn `codex`)+ 扩展一个 xterm 面板连它;**不碰**遥测/hook/autopilot;纯净零网络档保留,AI 档 opt-in 且显式标注 + 收窄的不变量例外 + 负向 E2E 守住。

---

## 12. 给实现方的额外交代(仓库惯例与坑,光看功能看不出来)

1. **分支纪律**:**别碰 `main`**(现在 0.3.5,有别的会话在同一仓库活跃推进,`main` 会在你脚下移动)。开一个 feature 分支干,别 force-push 共享分支。
2. **门禁必须全绿再交**,一个都不能省:`npm run build`(tsc + vite)、`npm run check`(不变量 + 语言覆盖 + 一堆 git 检查)、`node scripts/e2e.mjs`、`node scripts/check-extract.mjs`、`npx openspec validate --changes --strict`。**零网络是这产品唯一的护城河,别往发货包里随手加 `fetch`/`ws`。**
3. **`node-pty` 是原生模块,只能在 `lectern-agent`(Node)侧**;**绝不能进扩展 bundle**(浏览器跑不了原生模块)。扩展侧只有 ws 客户端 + xterm。这条边界越了就编译/运行都炸。
4. **xterm 面板懒加载**:照 `src/app.tsx` 里 `GitComparison = lazy(...)` 的做法,把 AI 面板做成独立 lazy chunk,别把核心阅读器体积撑大。
5. **i18n 纪律**(`src/i18n/`):新 UI 文案全部走 `t(key)`,`messages.ts` 的 `zh`/`en` **成对**(有键对齐校验,不成对 = 静默漏中文);**E2E 断言中文原文**,新增 zh 值要和界面逐字一致(含全角/半角标点、直/弯引号);**`DETECT_BROWSER_LANG` 已为 true**,任何新增"渲染 UI 的 puppeteer 测试"必须像 `e2e.mjs`/`check-key-single-source.mjs` 那样 `evaluateOnNewDocument` 锁 `cv-lang=zh`,否则 CI 浏览器默认英文会打红一片中文断言。参考 `docs/`/仓库里已有做法。
6. **openspec**:这功能要开一个 change(`openspec/changes/<name>/` 的 proposal/design/tasks/specs),`validate --strict` 过。它**故意推翻**两处既有契约——`check-git-ui-contracts.mjs` 里"Git 对比不含 AI 入口/占位"那条、以及 `check-invariants.mjs` 的零网络——**要在 change 里显式写明、并把这两个检查改成"收窄的例外 + 负向控制",不许偷偷绕过或直接删检查。**
7. **负向控制(red-once)是本仓库的验收铁律**:任何安全/不变量守卫都要**证明它真能咬住**——例如"无 token 连接被拒""异 origin 被拒""AI 关闭时零 ws 连接",都要有一条**注入回归后会变红**的负向断言,别写恒绿的假守卫(仓库 e2e 里到处是这个套路,照抄口径)。
8. **焦点别踩雷**:xterm 是可聚焦元素;AI 面板要接进现有 `src/lib/useOverlayKeyboard.ts` 的焦点移入/归还模型,别把已经修过两次的"面板关闭后焦点归还"搞回归。真机验证**要走鼠标动线**(键盘-only 的 E2E 漏过焦点归还 bug),不是只跑自动化就算数。
9. **WS 从 viewer 页发起**(持久上下文),**别放 MV3 service worker**(它会被回收);AI 档产物的 CSP `connect-src` 放行 `ws://127.0.0.1:*`,纯净档 CSP 不动。
10. **诚实汇报**:门禁跑了就贴真实结果——e2e 红就说红、贴输出,别没跑就报"全绿"。跳过的步骤要说跳过了。
11. **可复用而非重造**:面板/键盘/焦点/i18n 都有现成机制(引用面板、全文面板、大纲都是同一形状),照现有形态接,别新造一套平行实现。
12. **先给方向证伪,别一步到位**:v1 只要"打开读码台 → 连上本地 `codex` 终端 → 能问"跑通即可;遥测/autopilot/多会话/云端直连**明确不做**。跑通后由人决定是否继续投。

## 1. 零网络的可自证性

- [x] 1.1 `vite.config.ts` 加 `build.modulePreload = { polyfill: false }`
- [x] 1.2 构建后实测:`dist/assets/*.js` 中 `fetch(` / `XMLHttpRequest` / `WebSocket` / `EventSource` / `sendBeacon` **全部零命中**
- [x] 1.3 **验证关闭 polyfill 未破坏加载**:真机装载扩展,确认 viewer 页面、符号 Worker、文件名索引 Worker 均正常(polyfill 关闭的前提是 `minimum_chrome_version: 122` 已原生支持 modulepreload)
- [x] 1.4 E2E 增加**产物符号门禁断言**:构建产物中网络 API 符号零命中 —— 这条是"零网络可自证"这项承诺的守卫,**否则某次工具链升级重新注入 polyfill,没有任何机制会发现**,而对外文档与 CI 都已建立在这条性质上
- [x] 1.5 在 `vite.config.ts` 就地注释写明:**关闭它的前提是 `minimum_chrome_version` ≥ 122;下调该版本时必须重新评估**(spec 已要求,此处是给改配置的人的就地提示)

## 1b. 只读的可自证性(对称的另一半)

- [x] 1b.1 实测确认发布产物中 `createWritable` / `showSaveFilePicker` / `removeEntry` **零命中**(已预核:src 与 dist / dist-dev 均为 0)
- [x] 1b.2 E2E 产物符号门禁**同时覆盖写入符号**;符号清单 MUST 列全三个 —— **只查 `createWritable` 会漏掉删除路径(`removeEntry`)**
- [x] 1b.3 门禁的检查对象 MUST 是 **`dist/` 发布产物,不是仓库** —— `scripts/e2e.mjs` 本身含 11 处写入符号(OPFS 建合成项目所需),**钉在仓库上会与验收基建直接冲突**,且将来测试钩子若需写入能力会把要求逼到墙角
- [x] 1b.4 门禁失败时的报错要指明**命中的符号与文件**,而不是只说"检查未通过" —— 这条门禁将来最可能被无意触发(引入新依赖),报错要能直接定位

## 1c. `scripts/check-invariants.mjs`(不变量检查器,对外自证的唯一入口)

> **执行分工(规格阶段 2026-08-21 裁定)**:`scripts/check-invariants.mjs` 与 `scripts/check-language-coverage.mjs` 两个**新文件**由**开源准备阶段**编写(纯新增、零 `src/` 重叠,且契约由它与规格阶段共同定死);**`scripts/e2e.mjs` 的接线(1c.7)仍归开发** —— 那是开发在排除 change 期间持有的文件。**合入前由规格阶段或开发复核,开源准备阶段不自行认定通过** —— 自己写检查、自己写被检查的承诺、再自己判合格,三个角色叠在同一处,正是分工要避免的形状。
>
> **它现在是三份对外文档 + CI 的唯一入口**,不落地则 push 前 CI 直接红。发布准备方有意留了这个耦合:**自证失败比静默漂移好**。
> 背景:原方案是"三处清单保持一致",发布准备方改成了**清单只存在于这一个文件、其余全部是消费者** —— **靠对齐维持的一致性正是会漂移的那种,而漂移那一刻各处都还是绿的**。这是把一致性从纪律问题改成结构问题。

- [x] 1c.1 **本文件是符号清单的唯一持有者**。网络组:`fetch(` / `XMLHttpRequest` / `new WebSocket` / `EventSource` / `sendBeacon`;写入组:`createWritable` / `showSaveFilePicker` / `removeEntry`。**其余任何地方(文档 / CI / E2E)MUST NOT 再抄一份清单**(`scripts/check-invariants.mjs` 的 `FORBIDDEN` 是唯一持有者;文档 / CI / PR 模板已全部删除枚举、改为调用它。文档里仅存的 `fetch` / `createWritable` 是**说理**,带省略号、不构成可比对清单)
- [x] 1c.2 检查对象为 **`dist/` 发布产物**;另检查 `dist/manifest.json`:`permissions` 非空、存在 `host_permissions`、存在 `content_scripts` —— 任一命中即失败(查 `dist/`,`DIST` 可覆盖以便证伪;manifest 三项外**另加 `content_security_policy` 覆写检查** —— 守当初排除 tree-sitter WASM 的那条决定性理由,已由规格阶段同步进 spec)
- [x] 1c.3 **先打印自己将要检查的符号清单,再执行检查** —— 这不是调试输出,是**对外承诺的一部分**:README 写的是"它会打印它检查什么,你先读再信"。**不打印,那句话就成了空头**(stdout 首先打印符号清单与 manifest 三项判据,注释里写明"不是调试输出,别当噪音删掉")
- [x] 1c.4 失败信息 MUST 指明**命中的符号 + 文件 + 行**,并附一句指向 CONTRIBUTING 的不变量一节(说明确有正当理由时该怎么办)(报到**符号 + 文件 + 行:列 + 前后 40 字上下文** —— minify 后行号恒为 1,只报行号等于没报;失败尾行指向 CONTRIBUTING「三条不变量」)
- [x] 1c.5 **零依赖、短、可读** —— 这是**功能需求不是风格要求**:它是给怀疑者读的,**一个需要先信任才能验证的验证脚本没有价值**(零依赖、仅 node 内置模块;头注释写明"一个需要先信任才能验证的验证脚本没有价值",并声明这是功能需求)
- [x] 1c.6 退出码 0/1;是否加 `npm run check` 入口由开发决定 —— 对外文档一律写完整的 `node scripts/check-invariants.mjs`,不依赖 npm script 名
- [x] 1c.8 **必须证明它会失败,不能只证明它会通过**:对一份**故意注入违规符号**的产物副本(如临时插入一处 `fetch(`、一处 `createWritable`、把 manifest 的 `permissions` 改为非空)运行本脚本,**确认退出码非零、且报错准确指出命中的符号与文件行**;把这次证伪过程记进 baseline 或脚本注释。(**已证伪**:注入 `fetch(` / `createWritable` / `permissions:["storage"]` / `host_permissions` / `content_scripts`,退出码 1、逐条报出位置;复现命令写进脚本头注释。**另有一次真实命中**:接手时拿当时的 `dist/` 一跑就红,抓到的正是 Vite 的 modulePreload polyfill —— 人为注入证明它会响,真实命中证明它响得对)
  > 理由:**一个从没见过它失败的检查器,和 `exit 0` 无法区分。** 它将来大部分时间都会绿,而绿是它默认的样子 —— 唯一能证明它在工作的时刻,就是我们主动让它红的那一次。CI 里挂一个永远绿的门,比没有门更糟,因为它制造"已守护"的假象。
- [x] 1c.7 **E2E 的产物符号断言改为调用本脚本**,MUST NOT 自己再写一遍匹配 —— 否则第四份副本又长出来了

## 1d. 覆盖清单对账(`scripts/check-language-coverage.mjs`)

> 语言覆盖清单现在仓库里有 **4 份**(主 spec / `docs/language-support.md` / `README.md` / `README.zh-CN.md`),事实来源是 `src/lib/filetypes.ts` + `src/preview/languages.ts`。**4 份靠人对齐的清单,正是我们刚判定为"会漂移且漂移时全绿"的那种结构** —— 而这次漂移的后果比符号清单更直接:**清单是对用户的承诺,多写一个语言就是多一句假承诺。**
> **不删副本**:README 那两张表有真实作用(GitHub 上的人扫一眼找自己的语言,看不到就走),换成"详见某文档"会实打实掉转化。所以把"靠人对齐"换成"不一致即红"。

- [x] 1d.1 独立文件,**不并进 `check-invariants.mjs`** —— 那个脚本是给**外部怀疑者读**的,越短越好,不能撑成大杂烩(1c.5 的"零依赖、短、可读"是功能需求)(`scripts/check-language-coverage.mjs`,独立文件)
- [x] 1d.2 从 `src/lib/filetypes.ts` / `languages.ts` 解析出**扩展名 → 语言 → 档位**的真实映射,再解析 4 份文档里的表,逐项比对;任一处多出 / 少掉 / 档位不符即失败,并**指明是哪份文档的哪一行**(解析 `filetypes.ts` 的 `CODE_EXT` / `WHOLE_NAME` / `INTEL_FULL` / `APPROXIMATE` / `LANG_LABEL`;**解析不出来一律抛错走非零退出,不是跳过**,并对四档逐一断言非空 —— 1 条 / 2 条的小档正是脆弱正则最容易整档漏掉的规模,而档位归零之后"代码没覆盖"和"文档没列"是同一个空集差,门会为它存在的理由而变绿)
- [x] 1d.3 **对跑,不是生成**。生成会把 4 份变成 1 份 + 3 份产物,看着更干净,但**契约那一份不能是产物** —— 契约由人写、由人审;实现改了契约自动跟着改,是把因果颠倒。**对跑保留"两份独立产物互相打架"的能力,生成会消灭它。** 依据是本项目的真实事故:spec 分类轴那个错误,正是归档后拿主 spec 去对一份**独立写成**的清单才暴露的 —— **如果那份清单当初是生成的,它永远不会和 spec 打架,那个错误至今还在**(对跑,不生成;理由原样写进脚本头注释)
- [x] 1d.4 **区分哪些配对带信息、哪些是同义反复**(实现时必须想清,否则脚本会给出虚假的安心):(四类配对的信息量差异写进头注释,含 `docs/language-support.md` 被裁定为**人维护、参与对账**,以及"若改回生成,它那句『唯一依据』必须同时删掉——产物没资格当依据,依据要能反驳实现")
  - **spec ↔ 实现**:两份**独立撰写**的产物,信息量最高,是那次事故的功臣配对 —— **必须比**
  - **README(中/英)↔ 实现**:人手写的对外表,会漂移 —— **必须比**;两份 README 之间也要比(中英不一致=对不同语言的用户给了不同承诺)
  - **`docs/language-support.md` ↔ 实现**:该文件当初就是**用脚本从实际映射跑出来再成文**的。若它仍由脚本生成,拿它对实现**是同义反复,证明不了任何事**。**裁定(2026-08-20):定为"人维护、参与对账",不是产物。** 理由(开源准备阶段的措辞,比"同义反复"更透):该文件自称"对外表述的唯一依据",而**一份产物没有资格当依据 —— 依据要能反驳实现,产物永远不反驳实现**。若反过来选"产物"这一档,**它那句自我定位也必须同时删掉,否则文档自己在撒谎**。选定结论 MUST 写进脚本注释,让后来者知道这是被裁过的、不是没想过
- [x] 1d.6 **同样必须证明它会失败**:故意在某份 README 里增删一个语言 / 改一个档位,确认脚本报错并指明是哪份文档的哪一行;并验证**"两个维度切分推出同一总数"那条等式断言**确实会在抄漏一个语言时不成立(这条比逐项 diff 更难自欺,但**也要亲眼看它失败一次**)(**已证伪**:①README.md 多写一个语言 ②README.zh-CN.md 漏掉 Kotlin ③docs 把 Rust 挪错档 ④spec 少列一个语言 —— 四种变异全部捕获,①②另报出中英不一致;第④种**总数等式先报**"the spec lists 25 … but the tiers add up to 26 (7+1+18)";另单独证伪了空档断言。变异均 try/finally 还原,还原后复跑 exit=0)
- [x] 1d.5 排在代码侧最后,但 **MUST 在 push 之前落地** —— 开源后这 4 份清单会被真实用户拿来判断"我的语言支不支持",那一刻漂移的代价不再是内部返工(已落地,早于 push;CI 已接入,`npm run check` 亦串联)

## 2. E2E 可移植化(纯测试基建,不碰产品行为)

- [x] 2.1 `PROJECT` 由脚本自身位置推导(`fileURLToPath(import.meta.url)` 上溯),移除写死的本机绝对路径
- [x] 2.2 `CHROME` 读 `process.env.CHROME`,并按平台给默认值(macOS 现路径 / Linux `google-chrome` / Windows 常见路径);**找不到时给出可操作的报错**(提示设置 `CHROME=`),而不是抛一个路径不存在的原始错误
- [x] 2.3 在另一个目录克隆/复制一份验证脚本确实可跑(**验证"可移植"这件事本身,不能只靠改完看着对**)

## 3. 版本与更名(**归开发**;下方原措辞已过期,见裁定)

> **裁定(规格阶段 2026-08-21):本节归实现阶段。** 本节标题原写"由发布阶段统一改",那是产品阶段后来细分代码侧/文档侧**之前**写的,**已过期**。产品阶段其后的分工裁定是:**代码侧(含 `manifest.json` 的 name/description、`package.json` 版本、`app.tsx`/`Welcome.tsx` 产品名文案、`vite.config.ts`)归开发**,文档侧(README/SECURITY/CONTRIBUTING/LICENSE 等)归发布阶段;发布阶段本人也确认过"`package.json` 版本与 `manifest.json` 改名仍归开发,我不碰"。三方口径一致,**过期的是这行标题**,已改。

- [x] 3.1 `package.json` 与 `public/manifest.json` 版本统一为 `0.2.0`
- [x] 3.2 `public/manifest.json` 的 `name` / `description` 改为 Lectern 口径
- [x] 3.3 界面文案:`viewer.html` title、`src/app.tsx`、`src/welcome/Welcome.tsx`
- [x] 3.4 文档:`README.md`、`docs/prd-v0.2-reading-first.md`、两个图标 SVG 的注释(`README.md` / `README.zh-CN.md` 自始即为 Lectern;`docs/prd-v0.2-reading-first.md:30` 定位句、`assets/icon.svg` 与 `assets/icon-small.svg` 两处注释已改)
- [x] 3.5 全仓扫一遍残留:`grep -rn "Code Viewer"` 应只剩历史归档文件(`openspec/changes/archive/**`)与打包产物,**归档文件不改** —— 它们是当时的历史记录,改了就成了伪造记录(由开源准备阶段扫,与改名的执行者不是同一人。**文档侧已改**:`assets/icon.svg`、`assets/icon-small.svg` 两处注释、`docs/prd-v0.2-reading-first.md:30` 定位句。**代码侧扫出三处但结论是保留**:`src/lib/idb.ts` 的 `DB_NAME` 与 `src/lib/access.ts` 两个 picker `id` 是**持久化标识**不是展示字符串 —— 改了会让现有用户的最近项目句柄变孤儿、让 Chrome 忘记上次选的目录;已由开发在三处各加注释说明**为什么它长得像残留但不能动**(这条决定改了不会报错、测试照样全绿,注释是它唯一的守护)。**`docs/spike-1.2-handle-persistence.md:9` 特意不改** —— 它记的是实现里的真实库名,保留决定成立则该行为真,改了反而变错:**同一个字符串,在展示位是残留,在标识位是事实**。剩余命中仅为本 change 自身陈述改名这件事的两处)
- [x] 3.6 确认主 spec 无需改动(规格通篇用"查看器"通称,不含产品名)

## 4. 验收

- [x] 4.1 `npm run build`(含 `tsc --noEmit`)通过;`--strict` 通过
- [x] 4.2 **回归门禁**:既有全部 E2E 断言全绿(关闭 polyfill 属构建层改动,回归风险主要在资源加载)
- [x] 4.3 确认 `src/**` 中**除更名文案外**零行为改动

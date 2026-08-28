## Context

主题机制见 `2026-08-21-restyle-modern-ide/design.md`:`src/styles.css` 两组 CSS 变量
(`:root` 浅 / `html[data-theme='dark']` 深)+ `src/preview/cmTheme.ts` 两套 CM6 主题。
**B 方案 = 替换令牌值**,与 A 同构。视觉锚点 = PM 真机 mockup `style-b-reader.png` /
`style-b-reader-dark.png`(用户已拍板),**是方向锚点不是像素规范**;对比度以下表(已调 AA)
为准,进真机后 PM 截图可微调色相,方向锁定。

## Decisions

### D1 语法 6 角色 · B 值(cmTheme `LIGHT`/`DARK` 与 CSS `--tok-*` 同源)

| 角色 | 浅色 | 深色 | 归入的 `--tok-*` 别名 |
|---|---|---|---|
| kw 关键字 | `#9c5228` | `#db8a4c` | keyword / ctrl / atom / meta |
| fn 函数名 | `#256d75` | `#63a6c4` | fn / link / var2 |
| st 字符串/数字 | `#567032` | `#93ba7e` | string / string2 / number / literal / inserted |
| cm 注释(斜体) | `#74673f` | `#9a8f78` | comment |
| ty 类型/属性 | `#7d5f28` | `#d8b77e` | type / attr / label |
| pa 标签/标题/失效 | `#b04426` | `#e39070` | tag / heading / deleted / invalid |
| (var/prop=正文) | `#3a342a` | `#e7e0d3` | var / prop |
| (op=次文本) | `#6f6656` | `#a99f8c` | op |

注释仍**斜体**(A 方案的一部分,不是装饰)。注释对比度(落地实测):浅 `#74673f`/`#f5f1e8` = **4.96**,
深 `#9a8f78`/`#1a1714` = **5.59** —— **守住 AA,并明显暗于正文**(正文 10.93 / 13.60),
维持"次要但清晰"。

### D2 界面(非语法)令牌 · B 值

| 令牌 | 浅色 | 深色 |
|---|---|---|
| `--bg` 底/代码区 | `#f5f1e8` | `#1a1714` |
| `--bg-sidebar` 面板 | `#f1ebe0` | `#171512` |
| `--bg-topbar` 顶栏 | `#f1ebe0` | `#171512` |
| `--bg-hover` | `#ece4d5` | `#241f18` |
| `--bg-selected` 选中底 | `#e9dfcd` | `#33291d` |
| `--bg-input` 搜索框底 | `#efe8db` | `#24201b` |
| `--border-input` | `#e3dbcb` | `#332d25` |
| `--fg` 主文本 | `#3a342a` | `#e7e0d3` |
| `--fg-dim` 次级 | `#6f6656` | `#a99f8c` |
| `--fg-faint` 弱(分组标题) | `#a89b83` | `#6a6153` |
| `--brand` | `#2c271f` | `#f1ebdf` |
| `--accent` 强调 | `#b0602a` | `#db8a4c` |
| `--border` | `#e4dccc` | `#2c2721` |
| `--error` | `#b03d22` | `#e08a5c` |
| `--warn` | `#8b6815` ¹ | `#d9a95a` |
| `--link` | `#9a561f` | `#e0955a` |
| `--sel-bar` 选中左条 | `transparent` | `transparent` |
| `--hot-bg` 当前代码行 | `#efe6d3` | `#241e15` |
| `--hot-bar` | `#b0602a` ² | `#db8a4c` ² |
| `--tab-active-bg` | `transparent` | `transparent` |
| `--tab-active-fg` | `#a05726` ¹ | `#db8a4c` |
| `--badge-bg` 徽标底 | `#dde7d1` | `#2b3a26` |
| `--badge-fg` 徽标字 | `#4f6e37` ¹ | `#93ba7e` |
| `--checker-a` | `#efe8db` | `#241f18` |
| `--checker-b` | `#e4dccc` | `#171512` |
| `--md-code-bg` | `rgba(176,96,42,0.10)` | `rgba(219,138,76,0.14)` |
| `--md-pre-bg` | `#f1ebe0` | `#171512` |
| `--md-border` | `#e4dccc` | `#2c2721` |
| `--md-zebra` | `rgba(58,52,42,0.025)` | `rgba(255,255,255,0.02)` |
| `--md-placeholder-border` | `#d8cfbd` | `#332d25` |
| `--focus-ring` | `#b0602a` | `#e6a86a` |
| `--on-accent` accent 实底上的字 ³ | `#ffffff` | `#1a1714` |
| `--scrollbar-thumb` ³ | `#d3c8b4` | `#423a30` |

> ¹ **落地时上调到 AA**(PM 已认可)。本表初稿声称"已调过 AA",这三处实测没到:
> `--badge-fg` 3.70、`--tab-active-fg` 3.89、`--warn` 4.35。均按保色相等比压暗
> (88% / 91% / 97%)改到 4.54 / 4.55 / 4.56,肉眼同色。
> ² **`--hot-bar` 落地时没有置 `transparent`**,见下 D3 的补记。
> ³ 落地时新增的两支令牌,见下 D6 / a11y 那条。

`--mono` / `--sans` 不动。
cmTheme 的 `selection`(文本选区高亮):浅 `#e8d9bd` / 深 `#3a3020`(暖版,原为蓝灰)。

### D3 选中态从三形式减为两形式

A:焦点环(`::after` 内缩描边)+ 选中底(整行背景)+ 选中左条(`inset box-shadow`)。
B:去左条(`--sel-bar`/`--hot-bar` = `transparent`),保留**暖圆角填充 + 焦点环**。
理由:暖填充在冷/暖对照下已与焦点环清楚区分,左条是 A 期蓝色系"三者靠形式不靠色相"
的产物;B 是暖色系,填充本身就有足够色温差,左条冗余。**e2e.mjs:1026 仍通过**
(它只验焦点环 `1px solid` + `activeBg ≠ selectedBg`,不验 box-shadow)。

> **落地补记(PM 已裁定采纳)**:`--sel-bar` 照做了,**`--hot-bar` 没有**。本决定当初把
> `--hot-bar` 当成"选中左条"的另一支,实际它有 **4 个消费者**,其中两个会因此静默消失:
> `.candidate-row.selected` / `.ref-row.selected` 的左条(**那两处没有焦点环**,去条后只剩底色
> 一种形式),以及 `.cm-jump-hint` 的 `text-decoration-color` —— **那条下划线的"色"就是整个提示**,
> 置透明等于把 `add-jump-affordance` 静默做没。而当时的 E2E **抓不到**:它只断言
> `.cm-jump-hint` 这个类名在不在。已实测反证:置 transparent 后新加的"下划线真的画得出来"变红,
> 老断言"按住修饰键悬停 → 出现提示"**仍然 PASS**。
> 故 `--hot-bar` 取本决定自己写的退路:浅 `#b0602a` / 深 `#db8a4c`(= `--accent`,恰好也是
> A 期 `--hot-bar` 的值)。目录树选中行的左条按原意去掉了。
>
> 若 review 认为"选中左条"是 spec 承诺的稳定形式、不可减 —— 退路:`--sel-bar` 保留为
> 暖色 `#b0602a`/`#db8a4c`(暖左条),视觉仍是 B、只是多一条。默认**去条**(更贴 mockup),
> 此退路留给 review 裁定。

### D4 tab 激活态去药丸

A 的搜索模式 tab 激活是药丸(`--tab-active-bg` 实底)。B 稿是纯色字无底。
用令牌实现:`--tab-active-bg: transparent` + `--tab-active-fg: 陶土/暖橙`。
**不改 `.search-mode.active` 的 CSS 结构**,纯令牌达成。

> **落地补记**:纯令牌确实达成了(实测激活 tab 底色 = 顶栏 `#f1ebe0`、字 `#a05726`),
> 但**鼠标停在激活 tab 上时不成立**:`.topbar button:hover` 的特异度是 (0,2,1),压过
> `.search-mode.active` 的 (0,2,0),**不看书写顺序就赢**。A 期看不出来(激活字色与 hover
> 字色都是深灰、两个底色也几乎同值);B 把激活态压成**只剩字色**一个信号,一被盖掉,
> 鼠标停在当前模式上时就完全看不出自己处在哪个模式。落地时补了一条
> `.search-mode.active:hover` 提特异度 —— 这是本 change 唯一一处 CSS 结构改动。

### D5 `--icon-*` 双底原样沿用(PM 拍板,记录在案免得静默)

10 支文件类型图标色 **本 change 不重定**,浅深两套**照 A 的值原样沿用**。这不是"忘了改",
是拍板的决定:那是一套**按大类分色、深浅各自调校**的独立系统(冷=编译/后端、暖=前端/标记、
绿=数据/配置、中性=构建/纯文本、粉=图片/二进制),它的价值在于**目录树能被眯眼扫成 5 个块**;
暖底上这 5 个块仍然成立。**把它们一起暖化是另一个 change** —— 那要重新验证 5 个块之间
是否还分得开,不是换 10 个色值就完事。

### D6 滚动条与 UA 控件明暗(落地时补,1c review 提出)

`--icon-*` 之外,B 还有一处大面积色不归令牌管:**UA 滚动条**。浅色下 Chrome 默认滑块是
中性灰 `#c1c1c1`,贴着暖米面板会在界面正中拉出一条冷灰带;而全库没有 `color-scheme`,
深色下 UA 会给出浅色滚动条与浅色表单件。

落地为:`:root { color-scheme: light }` + `html[data-theme='dark'] { color-scheme: dark }`,
外加 `--scrollbar-thumb`(浅 `#d3c8b4` / 深 `#423a30`),`scrollbar-color: var(--scrollbar-thumb) transparent`。

**MUST NOT 写 `color-scheme: light dark`**:那是让 UA 按**操作系统**偏好选,而本应用是手动切主题
(`cv-theme`)。"系统浅色 + 应用切深色"的用户会拿到浅色滚动条 —— 同一个症状换了触发条件,
而且更难复现(在深色系统上开发的人永远看不到)。

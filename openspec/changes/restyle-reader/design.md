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

注释仍**斜体**(A 方案的一部分,不是装饰)。注释对比度:浅 `#74673f`/`#f5f1e8` ≈ 4.7,
深 `#9a8f78`/`#1a1714` ≈ 5.0 —— **守住 AA,并明显暗于正文**,维持"次要但清晰"。

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
| `--warn` | `#8f6b16` | `#d9a95a` |
| `--link` | `#9a561f` | `#e0955a` |
| `--sel-bar` 选中左条 | `transparent` | `transparent` |
| `--hot-bg` 当前代码行 | `#efe6d3` | `#241e15` |
| `--hot-bar` | `transparent` | `transparent` |
| `--tab-active-bg` | `transparent` | `transparent` |
| `--tab-active-fg` | `#b0602a` | `#db8a4c` |
| `--badge-bg` 徽标底 | `#dde7d1` | `#2b3a26` |
| `--badge-fg` 徽标字 | `#5a7d3f` | `#93ba7e` |
| `--checker-a` | `#efe8db` | `#241f18` |
| `--checker-b` | `#e4dccc` | `#171512` |
| `--md-code-bg` | `rgba(176,96,42,0.10)` | `rgba(219,138,76,0.14)` |
| `--md-pre-bg` | `#f1ebe0` | `#171512` |
| `--md-border` | `#e4dccc` | `#2c2721` |
| `--md-zebra` | `rgba(58,52,42,0.025)` | `rgba(255,255,255,0.02)` |
| `--md-placeholder-border` | `#d8cfbd` | `#332d25` |
| `--focus-ring` | `#b0602a` | `#e6a86a` |

`--icon-*` 文件类型色板 **不动**(见 proposal Non-Goals)。`--mono` / `--sans` 不动。
cmTheme 的 `selection`(文本选区高亮):浅 `#e8d9bd` / 深 `#3a3020`(暖版,原为蓝灰)。

### D3 选中态从三形式减为两形式

A:焦点环(`::after` 内缩描边)+ 选中底(整行背景)+ 选中左条(`inset box-shadow`)。
B:去左条(`--sel-bar`/`--hot-bar` = `transparent`),保留**暖圆角填充 + 焦点环**。
理由:暖填充在冷/暖对照下已与焦点环清楚区分,左条是 A 期蓝色系"三者靠形式不靠色相"
的产物;B 是暖色系,填充本身就有足够色温差,左条冗余。**e2e.mjs:1026 仍通过**
(它只验焦点环 `1px solid` + `activeBg ≠ selectedBg`,不验 box-shadow)。

> 若 review 认为"选中左条"是 spec 承诺的稳定形式、不可减 —— 退路:`--sel-bar` 保留为
> 暖色 `#b0602a`/`#db8a4c`(暖左条),视觉仍是 B、只是多一条。默认**去条**(更贴 mockup),
> 此退路留给 review 裁定。

### D4 tab 激活态去药丸

A 的搜索模式 tab 激活是药丸(`--tab-active-bg` 实底)。B 稿是纯色字无底。
用令牌实现:`--tab-active-bg: transparent` + `--tab-active-fg: 陶土/暖橙`。
**不改 `.search-mode.active` 的 CSS 结构**,纯令牌达成。

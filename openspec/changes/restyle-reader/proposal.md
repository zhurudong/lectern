# restyle-reader — B 方案「阅读器风」主题

> 这是 `2026-08-21-restyle-modern-ide`(A 方案)的**姊妹改动**。同一套主题机制,
> **只替换令牌值**,不新建平行体系、不改交互与布局。

## Why

当前线上是 A 方案「现代 IDE 风」——冷调、蓝色系、紧凑,视觉上与 VS Code 同构。
PM 在上一轮视觉探索里出了 A/B/C 三稿并由用户拍板 **B 方案「阅读器风」**:暖调、
留白、书卷气,刻意与 IDE 拉开——契合本产品"读码台 / 阅读器"而非"编辑器"的定位
(注释在阅读场景承载原作者意图,是信息密度最高的文本,这一取向 A 版已在 cmTheme
注释对比度上体现,B 版继续强化)。

**探索早已完成、方向已定,但一直没落成真主题。** 本 change 把 B 稿做进真机。

## What Changes

- 替换 `src/styles.css` 的 `:root`(浅色)与 `html[data-theme='dark']`(深色)两组
  **非图标令牌** + 语法 `--tok-*` 令牌为 B 方案值。
- 同步替换 `src/preview/cmTheme.ts` 的 `LIGHT` / `DARK` 调色板(6 语法角色 + bg/fg/
  dim/gutter/selection),与 CSS 令牌成套一致。
- **选中态减一形式**:A 是「整行底 + 蓝色左条 + 焦点环」三形式;B 去掉左色条
  (`--sel-bar` / `--hot-bar` → `transparent`),只保留「暖色圆角填充 + `::after` 焦点环」
  两形式——暖填充与焦点环已足够区分,左条在 B 里是冗余。见 design D3。
- **Tab 激活态去药丸**:`--tab-active-bg → transparent`、`--tab-active-fg → 陶土色`,
  纯色字表达激活(B 稿如此)。

## Non-Goals

- 不改**文件类型图标色板**(`--icon-*`):那是一套按大类分色、深浅各自调校的独立系统,
  暖底上仍成立;动它是另一个 change。
- 不改字体栈(`--mono` / `--sans` 保持系统栈)。
- 不改交互、布局、代码理解层。
- 不做用户自定义主题/多主题切换(本产品单一主题,B 直接替换 A)。

## 必须守住(否则视为回归)

1. **对比度地板**:正文 ≥ AA(4.5)、注释 ≥ AA(4.5,延续 A 的有意取向)、
   徽标字 ≥ AA。**MUST NOT 照搬 mockup 的低对比暖灰**(如注释 `#AB9D86` 压 `#F5F1E8`
   约 2.5:1,击穿地板)——design D2 给的是**已调到 AA 的** B 值。
2. **cmTheme ↔ CSS 成套一致**:E2E 6.2 是行为断言(切暗色代码色须变),但设计上两处
   语法 6 色应相等,避免"预览区与 Markdown 代码块两种配色"。
3. **选中/焦点断言(e2e.mjs:1026)**:焦点环仍 `1px solid`、`activeBg ≠ selectedBg`。
   去左条不影响它(该断言不检查 box-shadow),但 `--bg-selected` 必须是**实心暖填充**、
   与活动行背景可区分。
4. **构建后 `node scripts/check-invariants.mjs` 仍绿**(零网络/只读/空权限不受影响,
   但作为回归门必须跑)。

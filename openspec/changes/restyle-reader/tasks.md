# Tasks — restyle-reader

## 1. 令牌替换(styles.css)
- [x] 1.1 `:root` 浅色:按 design D1(tok-*)+ D2(界面令牌)替换值;**保留 `--icon-*` / `--mono` / `--sans` 原值不动**(54 项;`git diff` 核过 `--icon-*`/`--mono`/`--sans` 零改动)
- [x] 1.2 `html[data-theme='dark']` 深色:同上替换为深色列(54 项)
- [x] 1.3 `--sel-bar` / `--tab-active-bg` = `transparent`;**`--hot-bar` 未置 transparent** —— 见下「与 design 的偏离」①,待 PM/review 裁定

## 2. CM6 主题(cmTheme.ts)
- [x] 2.1 `LIGHT` 调色板:bg/fg/dim/gutter/selection + kw/fn/st/cm/ty/pa 按 D1/D2 浅色列
- [x] 2.2 `DARK` 调色板:同上深色列
- [x] 2.3 与 CSS `--tok-*` 逐一核对相等 —— 机械核对(不是肉眼):6 角色的 23 个 `--tok-*` 别名 +
      var/prop=`--fg` + op=`--fg-dim` + palette 的 bg/fg/dim/gutter 对 `--bg`/`--fg`/`--fg-dim`/`--fg-faint`,
      浅深两套全部相等

## 3. 构建与不变量
- [x] 3.1 `npm run build` 通过(tsc --noEmit + vite build)
- [x] 3.2 `node scripts/check-invariants.mjs` 绿(零网络/只读/空权限)

## 4. E2E 验证(scripts/e2e.mjs)
- [x] 4.1 6.2「主题切换后代码区着色同步换套」通过 — 浅 `rgb(156,82,40)` → 深 `rgb(219,138,76)`
- [x] 4.2 1026「焦点环 + activeBg≠selectedBg」通过 —— 但**该断言原本是恒真的**,见下「断言修正」
- [x] 4.3 全套 **327/327 PASS**,零 FLAKY

## 5. 真机验收(交 PM)
- [x] 5.1 浅色 `shot-1/2/3/4/5/6/8/9/10/11/12/13`、深色 `shot-7-dark` 全部重出
      (mockup `style-b-reader*.png` 不在仓库里,未做像素比对;方向比对交 PM)
- [x] 5.2 对比度抽验(实测,见下表)
- [ ] 5.3 交 PM 审批 / review 裁定 D3

---

## 与 design 的偏离(需 PM 裁定)

### ① `--hot-bar` 不置 `transparent`(D3 只做了一半)
D3 写「`--sel-bar`/`--hot-bar` 一起置 transparent」。`--sel-bar` 照做了(目录树选中行仍有
暖填充 + 焦点环两形式)。**`--hot-bar` 不能照做** —— 它有四个消费者,其中两个会因此静默消失:

| 消费者 | 置 transparent 的后果 |
|---|---|
| `.cm-target-line` 左条 | 可接受(同一行还有 `--hot-bg` 底) |
| `.markdown-body .md-target` 左条 | 可接受(同上) |
| `.candidate-row.selected` / `.ref-row.selected` 左条 | **这两处没有焦点环**,只剩底色一种形式 |
| `.cm-jump-hint` 的 `text-decoration-color` | **"色"就是整个提示** —— 下划线彻底不可见,`add-jump-affordance` 这个功能等于没了 |

而 E2E 原本**查不出来**:它只断言 `.cm-jump-hint` 这个类名在不在。已实测反证:把
`--hot-bar` 置 transparent 后,新断言「下划线真的画得出来」变红,而老断言
「按住修饰键悬停可跳转标识符 → 出现提示」**仍然是 PASS**。

现取 D3 自己写的退路,**只用在 `--hot-bar` 上**:浅 `#b0602a` / 深 `#db8a4c`(= `--accent`,
恰好也是 A 期 `--hot-bar` 的值,所以这支在 A 上是同值替换)。若 review 要求彻底去条,
需要另配一支 jump-hint 专用色,那是改 CSS 结构、不是换令牌。

### ② 新增一条 CSS 选择器:`.search-mode.active:hover`
D4「去药丸」用纯令牌**达成了**(实测:激活 tab 底色 = 顶栏 `#f1ebe0`,字 `#a05726`)。
但鼠标停在激活 tab 上时不成立:`.topbar button:hover` 的特异度是 (0,2,1),压过
`.search-mode.active` 的 (0,2,0),**不看书写顺序就赢**。A 期看不出来(激活字色与 hover 字色
都是深灰、两个底色也几乎同值);B 把激活态压成**只剩字色**一个信号,被盖掉就等于
"鼠标停在当前模式上时看不出自己在哪个模式"。加一条 `.search-mode.active:hover` 补特异度。

### ③ 三个 design 值上调到 AA(design 称"已调过 AA",这三处实测未到)
| 令牌 | design 值 | 实测 | 改为 | 实测 |
|---|---|---|---|---|
| `--badge-fg` 浅 | `#5a7d3f` | 3.70 | `#4f6e37` | **4.54** |
| `--tab-active-fg` 浅 | `#b0602a` | 3.89 | `#a05726` | **4.55** |
| `--warn` 浅 | `#8f6b16` | 4.35 | `#8b6815` | **4.56** |
均为保色相的等比压暗(88% / 91% / 97%),视觉上与 design 值同色。
`--badge-fg` 是 PM 点名的地板项(徽标字 ≥ AA);另两项是正文类文本令牌,顺手补齐。

---

## 断言修正(scripts/e2e.mjs)

1. **e2e.mjs:1026 原本是恒真的。** 它在 `focusTree()` 之后直接读 `.tree-row.selected`,
   而那一刻树里根本没有选中行 —— `selectedBg` 恒为 `null`,`activeBg !== selectedBg`
   永远成立。断言绿了三百多轮,从未真正比较过两种视觉形式。
   现改为:先 `openFile('README.md')` 造出真的选中行,再 `Home` 把活动行挪到别的行
   (否则 active 与 selected 是同一个元素,同一个 `backgroundColor` 比两次必然相等),
   等 `.tree-row` 自己声明的 130ms 背景过渡走完再读;并加一条**前提断言**
   (活动行与选中行确实是两行)+ 一项**选中行 ≠ 普通行**。
   实测值:`selectedBg rgb(233,223,205)` / `activeBg transparent` / `plainBg transparent` /
   `selectedBar rgba(0,0,0,0) 2px inset`(左条槽位在、色透明,D3 已落实)。
2. **新增**「可跳转提示的下划线真的画得出来(颜色非透明)」—— 堵上偏离①里说的那个盲区。

两条都做过反证:注入对应回归后各自变红,而它们的前提断言保持绿。

## 对比度实测(WCAG 相对亮度,自算;✓ = ≥4.5)
| 项 | 浅色 | 深色 |
|---|---|---|
| 正文 `--fg` / `--bg` | ✓ 10.93 | ✓ 13.60 |
| 注释 `--tok-comment` / `--bg` | ✓ 4.96 | ✓ 5.59 |
| 徽标字 `--badge-fg` / `--badge-bg` | ✓ 4.54 | ✓ 5.51 |
| 次级 `--fg-dim` / `--bg` | ✓ 5.02 | ✓ 6.82 |
| 语法 kw/fn/st/ty/pa / `--bg` | ✓ 5.10 / 5.29 / 4.96 / 5.26 / 5.03 | ✓ 6.59 / 6.61 / 8.13 / 9.34 / 7.22 |
| `--link` / `--bg` | ✓ 5.00 | ✓ 7.32 |
| `--error` / `--bg` | ✓ 5.27 | ✓ 6.76 |
| `--warn` / `--bg` | ✓ 4.56 | ✓ 8.31 |
| `--tab-active-fg` / `--bg-topbar` | ✓ 4.55 | ✓ 6.73 |
| 正文 / `--bg-selected` | ✓ 9.33 | ✓ 10.84 |
| 正文 / `--hot-bg` | ✓ 9.93 | ✓ 12.58 |

### 未达 AA 但**不是本 change 引入**的两处(交 PM,建议并入 fix-help-panel-a11y)
- `--fg-faint`(分组标题/占位文案/行号槽):浅 2.30、深 2.99。A 期为 2.36 / 2.91 —— **平级,非回归**。
  这是刻意的"弱文本"档,但欢迎页的"暂无最近项目…"整段说明文字也用它,那段是要读的。
- 欢迎页主按钮 `color: #ffffff` 压 `--accent`:浅 4.61 ✓,**深 2.71 ✗**(A 深色为 3.16,同样未达)。
  该 `#ffffff` 是写死值不是令牌,B 只是让它更差了一点;修法是深色下改用 `var(--bg)` 作字色,
  属改 CSS 结构,未擅自动。

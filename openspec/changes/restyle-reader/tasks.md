# Tasks — restyle-reader

## 1. 令牌替换(styles.css)
- [ ] 1.1 `:root` 浅色:按 design D1(tok-*)+ D2(界面令牌)替换值;**保留 `--icon-*` / `--mono` / `--sans` 原值不动**
- [ ] 1.2 `html[data-theme='dark']` 深色:同上替换为深色列
- [ ] 1.3 确认 `--sel-bar` / `--hot-bar` / `--tab-active-bg` = `transparent`(D3/D4)

## 2. CM6 主题(cmTheme.ts)
- [ ] 2.1 `LIGHT` 调色板:bg/fg/dim/gutter/selection + kw/fn/st/cm/ty/pa 按 D1/D2 浅色列
- [ ] 2.2 `DARK` 调色板:同上深色列
- [ ] 2.3 与 CSS `--tok-*` 6 色逐一核对相等(避免预览区与 Markdown 代码块两配色)

## 3. 构建与不变量
- [ ] 3.1 `npm run build` 通过(dist 产出)
- [ ] 3.2 `node scripts/check-invariants.mjs` 绿(零网络/只读/空权限回归门)

## 4. E2E 验证(scripts/e2e.mjs)
- [ ] 4.1 6.2「主题切换后代码区着色同步换套」通过
- [ ] 4.2 1026「焦点环 + activeBg≠selectedBg」通过(去左条不得使其红)
- [ ] 4.3 全套跑绿(或红项与本 change 无关且有说明)

## 5. 真机验收(交 PM)
- [ ] 5.1 出浅色截图 `shot-6-*` 与深色 `shot-7-dark`,与 mockup `style-b-reader*.png` 比对
- [ ] 5.2 对比度抽验:正文/注释/徽标字 ≥ AA(4.5),用实测值报告
- [ ] 5.3 交 PM(代码阅读器pm)审批;review 会话过一遍 D3 去左条的裁定

## 1. 机制(本次交付)

- [x] 1.1 `src/i18n/index.ts`:`Lang = 'zh' | 'en'`、`lang` 信号、`initialLang()`(localStorage → `DETECT_BROWSER_LANG` 探测 → 默认中文)、`setLang` / `toggleLang`(持久化 + 更新 `<html lang>`)、`t(key, params?)`(查表 + `{name}` 插值 + 三级回退)
- [x] 1.2 `src/i18n/messages.ts`:zh/en 双语表,承载样板范围(`welcome.*` + `topbar.langToggleTitle`);占位符约定 `{n}`
- [x] 1.3 `npm run build`(tsc --noEmit + vite)通过

## 2. 样板(本次交付)

- [x] 2.1 顶栏加语言开关按钮(`app.tsx`),`toggleLang`,标签 `EN`/`中`,title 走 `t()`;位于主题开关旁,welcome 与 project 两种模式均可见
- [x] 2.2 `Welcome.tsx` 全部可见文案改走 `t()`,含相对时间(`justNow`/`minutesAgo`/`hoursAgo`/`daysAgo`)的占位符插值与两条错误提示
- [x] 2.3 手动核验:切换开关时入口页在中↔英即时切换,字体不变,刷新后语言保持(localStorage)

## 3. 门禁(本次)

- [x] 3.1 `npm run build` + `npm run check` 通过
- [x] 3.2 全套 E2E 绿(默认中文,渲染文案与迁移前一致,不触发既有文案断言回归)

## 4. 批量迁移(**等 PM 审过方案后再做,本次不执行**)

- [ ] 4.1 按面板分批把其余 ~200 处文案抽 key、填双语、改走 `t()`(顺序见 design.md 迁移路线)
- [ ] 4.2 每批同步把相关 E2E 文案断言改为语言无关(锁 `lang='zh'` 或用 class/`data-*`)
- [ ] 4.3 全量完成后把 `DETECT_BROWSER_LANG` 置 true(非 `zh-*` 浏览器默认英文)
- [ ] 4.4 补 E2E:切换语言后关键交互(打开、跳转、搜索、大纲)不回归

## Why

代码理解(大纲 / 跳转定义 / 查找引用 / 符号搜索)当前只覆盖 7 门语言(Python / Java / C / C++ / Go / JS / TS)。Rust、Ruby、Kotlin、C# 等高频语言只有语法高亮,读这些代码库的用户拿不到"读得懂"那一层。本次把**可行的 2 门**从"仅高亮"升到"可跳转",直接扩大受众,且不改变任何既有语言的行为。

"可行"由一条硬约束决定:可跳转档要求一等 **Lezer 语法**(产出带命名节点的语法树,符号抽取据此按直接父节点白名单过滤形参与局部变量)。legacy-modes 的 `StreamLanguage` 只产扁平 token 流,无法抽符号。

## What Changes

- **Rust → 可跳转**:接 `@codemirror/lang-rust` + `@lezer/rust`。抽取 struct / enum / trait / type alias / mod / const&static / free fn / impl 方法 / 结构体字段 / enum variant / macro;排除形参(`BoundIdentifier < Parameter`)与局部变量(`< LetDeclaration`)、impl 目标类型与各类型标注(引用位)。
- **PHP → 可跳转**:接 `@codemirror/lang-php` + `@lezer/php`。抽取 namespace / class / interface / trait / enum / 方法 / 函数 / 类属性 / 类常量 & 顶层常量 / enum case;排除形参、局部赋值、`$this->x` 成员访问、`implements` 引用、返回类型标注。
- Rust 高亮从 `legacy-modes/rust` 的近似流式高亮换成一等语法树高亮(顺带收益)。
- 四份覆盖清单(README.md / README.zh-CN.md / docs/language-support.md / file-preview spec)与代码同步:navigable 7 → 9,highlight-only 18 → 17(Rust 移出),PHP 从"不覆盖"清单移除。

## Non-goals / 明确不做

- **Ruby、Kotlin、C# 维持"仅高亮"**:npm 上没有官方 Lezer 语法(`@lezer/ruby`、`@lezer/kotlin` 均不存在),只有 `legacy-modes` 的流式高亮,升不到可跳转。这是当前的**明确边界**,不是欠条 —— 一旦出现可用的一等语法即可复用本次同一条抽取通道接入。
- 不做类型推断 / 作用域解析 / 导入解析 / 宏展开:与既有 7 门一致,仍是基于符号名 + 语法树的启发式。

## Capabilities

### Modified Capabilities

- `code-intelligence`:支持范围从 7 门扩到 9 门(新增 Rust、PHP)。
- `file-preview`:专用高亮清单新增 PHP;Rust 由近似档修正为专用语法树高亮档(仍在专用高亮集合内,不改变对外档位数的总和口径,仅 navigable/highlight-only 内部迁移 + PHP 净增 1)。

## Impact

**代码**
- 改:`src/preview/languages.ts`(rust 换一等包、新增 php;`languageExtension` / `languageParser` / `normalizeFenceLang`)、`src/intel/extract.ts`(新增 `classifyRust` / `classifyPhp`、容器表、parserFor、prefilter 增补 `BoundIdentifier` / `Name`)、`src/lib/filetypes.ts`(CODE_EXT 增 php 扩展名、INTEL_FULL 增 rust/php、LANG_LABEL 增 PHP)。
- 测试:`scripts/check-extract.mjs` 增 Rust / PHP 抽取与容器断言;`scripts/e2e.mjs` 增 Rust / PHP 可跳转全链路(大纲 + ⌘点击跳转到定义 + 查找引用非空),并把 Rust 移出"仅高亮"E2E 清单。
- 文档 / spec:四份覆盖清单同步(`check-language-coverage` 交叉核对通过)。

**依赖**
- 新增 npm 运行时依赖:`@codemirror/lang-rust`、`@codemirror/lang-php`、`@lezer/rust`、`@lezer/php`(官方 CodeMirror 6 包)。实测 `symbolWorker` chunk 350 KB → 519 KB(+169 KB,+48%,PHP 语法解析表尤大),**全部落在 Worker chunk,不进首屏关键路径**;首屏主 chunk 与 CSS 不变。

**门禁**
- `npm run build` + `npm run check`(含 `check-language-coverage`)+ 全套 E2E 绿。

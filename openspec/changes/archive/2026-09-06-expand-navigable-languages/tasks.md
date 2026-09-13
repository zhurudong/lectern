## 1. 可行性甄别(先做,决定接哪几门)

- [x] 1.1 核实候选语言的一等 Lezer 语法在 npm 的可得性:`@lezer/rust` ✅ `@lezer/php` ✅;`@lezer/ruby` ❌、`@lezer/kotlin` ❌(不存在)。据此定为 **Rust + PHP**,Ruby/Kotlin/C# 维持"仅高亮"并在文档写明理由
- [x] 1.2 用样例源码 dump `@lezer/rust`、`@lezer/php` 的节点名与父子结构,确认定义位 / 形参位 / 局部变量位可按直接父节点区分

## 2. 语法接入(高亮 + parser)

- [x] 2.1 `src/preview/languages.ts`:Rust 由 `legacy-modes/rust` 换成 `@codemirror/lang-rust`,新增 `@codemirror/lang-php`;`languageExtension` 增 `rust` / `php` 分支
- [x] 2.2 `languageParser`(Markdown 围栏静态高亮用)增 `rust` / `php`;`normalizeFenceLang` 增 `php` / `php3..5` / `phtml` 别名
- [x] 2.3 `package.json` 显式加 `@codemirror/lang-rust`、`@codemirror/lang-php`、`@lezer/rust`、`@lezer/php`(锁定版本)

## 3. 符号抽取(intel)

- [x] 3.1 `src/intel/extract.ts`:`parserFor` 增 rust / php;`Lang` 类型增 `'rust' | 'php'`;prefilter 节点名集合增 `BoundIdentifier`(Rust)与 `Name`(PHP)
- [x] 3.2 `classifyRust`:struct/union→struct、enum→enum、trait→interface、type→type、mod→namespace、const&static→constant、free fn→func、impl/trait 方法→method、结构体字段→field、enum variant→constant、macro→macro;**排除**形参(`BoundIdentifier < Parameter`)、局部变量(`< LetDeclaration`)、impl 目标类型与类型标注(引用位)
- [x] 3.3 `classifyPhp`:namespace/class/interface/trait/enum/method/function/enum case/const(顶层与类内);类属性(`VariableName < VariableDeclarator < PropertyDeclaration`)→field;**排除**形参、局部赋值、`$this->x` 成员访问、`implements` 引用、返回类型标注
- [x] 3.4 容器名表 `CONTAINER_NAME_CHILD` 增 rust(StructItem/EnumItem/TraitItem/ImplItem/ModItem/FunctionItem/UnionItem)与 php(ClassDeclaration/InterfaceDeclaration/TraitDeclaration/EnumDeclaration/MethodDeclaration/FunctionDefinition/NamespaceDefinition);抽取主循环 dispatch 增 rust / php
- [x] 3.5 `scripts/check-extract.mjs` 增 Rust / PHP 用例:定义齐全 + 行号正确、形参/局部变量不在结果、容器名正确(impl 方法容器=目标类型、类方法/属性容器=类)。31/31 PASS

## 4. 覆盖清单同步(check-language-coverage 交叉核对)

- [x] 4.1 `src/lib/filetypes.ts`:CODE_EXT 增 php 系扩展名、INTEL_FULL 增 `rust`/`php`、LANG_LABEL 增 `php: 'PHP'`
- [x] 4.2 README.md / README.zh-CN.md:navigable 增 Rust、PHP;highlight-only 移除 Rust
- [x] 4.3 docs/language-support.md:第 1 节增 Rust/PHP 行(标题 9 类)、第 3 节移除 Rust(标题 17 类)、第 6 节"不覆盖"移除 PHP,并加一段说明 Ruby/Kotlin/C# 为何停在仅高亮
- [x] 4.4 openspec/specs/file-preview/spec.md 专用高亮清单增 PHP、"不覆盖"清单移除 PHP;openspec/specs/code-intelligence/spec.md 覆盖范围增 Rust、PHP
- [x] 4.5 `node scripts/check-language-coverage.mjs` 通过(navigable 9 / outline 1 / highlight 17 / approximate 2,四份清单与实现一致)

## 5. E2E(每门:大纲有符号 + 跳转到定义 + 查找引用非空)

- [x] 5.1 夹具:`src/main.rs` 换成含 const/struct/字段/impl 方法/free fn + 调用点的紧凑 Rust 文件;新增 `app.php`(放**项目根**,避免给 src 子项 +1 挤出"刷新后"断言的虚拟滚动窗口)
- [x] 5.2 把 Rust 移出"仅高亮"E2E 清单(改判"可跳转")
- [x] 5.3 新增 Rust / PHP 可跳转断言块:大纲条目+行号正确、形参/局部变量未收、能力标识="可跳转"、⌘点击调用点跳转到定义行(定义不在第 1 行)、查找引用命中定义处+调用处
- [x] 5.4 全套 E2E 绿:336/336 PASS(基线 main 325/325,净增 11 条)

## 6. 门禁

- [x] 6.1 `npm run build` 通过(tsc --noEmit + vite build)
- [x] 6.2 `npm run check` 通过(check-invariants + check-language-coverage)
- [x] 6.3 `node scripts/check-extract.mjs` 31/31、`node scripts/e2e.mjs` 336/336(EXIT=0)

## 决策

### D1:可跳转档的准入 = 一等 Lezer 语法可得性

"可跳转"要抽符号,抽符号靠语法树按**直接父节点白名单**过滤(见既有 `extract.ts` 的 design 注释:祖先集合命中会把每个局部变量都收成符号)。这要求语言有产出**带命名节点**的 `@lezer/*` 语法。`@codemirror/legacy-modes` 的 `StreamLanguage` 只给逐 token 的高亮流,`parse()` 出来是扁平树,没有 `StructItem`/`MethodDeclaration` 这类可判定的节点名 —— 因此高亮能做,符号抽取做不了。

据此逐门甄别(2026-09-04 实测 `npm view`):

| 语言 | `@lezer/*` | 结论 |
|---|---|---|
| Rust | `@lezer/rust` ✅ | 接入(本次) |
| PHP | `@lezer/php` ✅ | 接入(本次) |
| Ruby | `@lezer/ruby` ❌ 不存在 | 维持仅高亮 |
| Kotlin | `@lezer/kotlin` ❌ 不存在 | 维持仅高亮 |
| C# | 无官方一等语法 | 维持仅高亮 |

任务原列的候选是 Rust/Ruby/Kotlin;甄别后只有 Rust 可行,补上同样有官方语法、受众更大的 PHP,凑成 2 门。**没有为 Ruby/Kotlin 硬凑** —— 用 StreamLanguage 假装能抽符号会得到一份充满噪声(把每个局部变量都当定义)的大纲,比"仅高亮"更糟。

### D2:节点白名单(与既有语言同一原则)

- **Rust**:名字位是 `BoundIdentifier`(const/static/fn/param/let 共用)、`TypeIdentifier`(类型定义与引用共用)、`FieldIdentifier`、`Identifier`(enum variant / macro)。定义 vs 使用靠**直接父节点**区分:
  - 形参 `BoundIdentifier < Parameter`、局部 `BoundIdentifier < LetDeclaration` → 排除;
  - `TypeIdentifier < ImplItem`(impl 目标)、`< ConstItem/FunctionItem/FieldDeclaration`(类型标注/返回类型)都是引用位 → 排除;类型**名字**位要求是所在声明的第一个 `TypeIdentifier`(`isFirstChildOfType`);
  - fn 是 method 还是 func:看 `FunctionItem` 是否在 `DeclarationList < ImplItem|TraitItem` 下。
- **PHP**:名字位是 `Name`(类/接口/trait/enum/方法/函数/命名空间/常量/enum case),类属性是 `VariableName < VariableDeclarator < PropertyDeclaration`。排除:形参、局部赋值(`VariableName < AssignmentExpression`)、`$this->x`(`Name < MemberExpression`)、`implements`(`Name < ClassInterfaceClause`)、返回类型(`Name < NamedType`)。类属性名保留 PHP 的 `$` 拼写(`$x`),与源码一致。

两门的抽取都进 `scripts/check-extract.mjs` 逐条断言(定义齐全 / 形参与局部变量不收 / 容器名正确),这是本项目对抽取精度的既定护栏。

### D3:trait / PHP-trait 的 KIND 归属

Rust `trait` → `KIND.interface`(抽象方法契约,最接近)。PHP `trait` → `KIND.class`(含具体方法实现的可复用单元,比 interface 更贴切)。无专门的 trait KIND,不为此新增一档,避免徽标/标签体系膨胀。

### D4:E2E 夹具放置(虚拟滚动边界)

新增 PHP 夹具刻意放**项目根**而非 `src/`:`src` 子项数一旦 +1,会把根层尾部的 `added-later.txt` 挤出"刷新后新增文件出现"那条既有断言的**虚拟滚动渲染窗口**(实测复现:窗口在 `widget.cpp` 处截断,根文件全部落在窗口外)。可跳转能力与文件所在目录无关,放根层即让 `src` 子项数与基线一致,既有断言零改动。Rust 夹具复用已存在的 `src/main.rs`(仅改内容,不新增树行)。

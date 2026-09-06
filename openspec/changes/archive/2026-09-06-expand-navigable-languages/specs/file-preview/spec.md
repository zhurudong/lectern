## MODIFIED Requirements

### Requirement: 代码语法高亮渲染

代码文件 SHALL 以只读模式渲染,包含语法高亮与行号。渲染 SHALL 保持原始内容逐字呈现,MUST NOT 修改或重排文件内容。

高亮能力 SHALL 分为以下**两档**(本要求只管高亮;**文件的代码理解能力是另一个维度**,由代码理解的能力标识负责明示,二者 MUST NOT 混为一档):

- **专用高亮**:Python、Java、C、C++、Go、JavaScript、TypeScript(含 JSX/TSX)、Rust、PHP、Markdown、JSON、HTML、CSS、SCSS、Sass、Less、SQL、YAML、XML、Shell、Ruby、Kotlin、C#、Groovy(含 `.gradle`)、TOML、Dockerfile、CMake。其中 Rust、PHP 使用官方 Lezer 语法(与其余可跳转语言同一条语法树通道),而非借用相近语言的近似高亮。
- **近似高亮**(借用相近语言的高亮通道,准确性不保证):Vue、Svelte(借用 HTML 高亮,`<script>` / `<style>` 块可高亮,模板指令如 `v-if` / `{#if}` 不保证准确)。

查看器 SHALL 让用户在预览时知道以下两件事,**至于界面用哪些词来表达、共有几个标签,由实现决定,本要求 MUST NOT 被理解为对展示文案的枚举**:

1. **该文件的高亮是专用的还是近似的** —— 近似 MUST 被标注为近似,MUST NOT 让用户以为是该类型的专用高亮;有专用模式可用的类型 MUST NOT 以近似充当。
2. **该文件是否参与代码理解**(可跳转 / 仅大纲 / 不参与)—— 具体档位与措辞由代码理解的能力明示要求规定。

**两档之外的类型 SHALL 以纯文本(含行号)展示**。以下是**常见类型中当前明确不覆盖**的部分(该清单是常见项的举例,**并非穷举** —— 未列出 ≠ 已覆盖):Swift、Dart、Lua、Scala、R、Perl、PowerShell、Protobuf、GraphQL、Terraform/HCL,以及 Makefile(无可用的专用高亮模式,按纯文本展示但保留正确的文件图标)。此清单为**当前的明确边界**而非待办 —— 对外说明 SHALL 表述为"当前覆盖 X、不覆盖 Y",MUST NOT 表述为"尚未支持"或"以后补齐"。

#### Scenario: 高亮渲染 Go 文件

- **WHEN** 用户打开一个 `.go` 文件
- **THEN** 关键字、字符串、注释等以不同样式高亮,左侧显示行号,内容与磁盘文件逐字一致,能力标识显示为"可跳转"

#### Scenario: 高亮渲染 SCSS 文件

- **WHEN** 用户打开一个含嵌套规则、`$` 变量与 `@mixin` 的 `.scss` 文件
- **THEN** 这些 SCSS 特有语法被正确高亮(而非当作纯文本或仅按 CSS 近似处理),能力标识显示为"仅高亮"

#### Scenario: 近似高亮必须明示

- **WHEN** 用户打开一个 `.vue` 文件
- **THEN** `<script>` 与 `<style>` 块获得高亮,且界面**明确标注该文件为近似高亮**,用户不会误以为这是 Vue 专用高亮

#### Scenario: 明确不覆盖的类型

- **WHEN** 用户打开一个 `.swift` 或 `Makefile`
- **THEN** 预览区以纯文本(含行号)正常展示,文件图标正确,界面不声称提供该语言的高亮

#### Scenario: 只读保证

- **WHEN** 用户在预览区尝试输入或修改文本
- **THEN** 内容不发生变化(允许选择与复制)

#### Scenario: PHP 专用高亮生效

- **WHEN** 用户预览一个 `.php` 文件
- **THEN** 该文件获得 PHP 专用高亮(产生多种高亮类),预览区语言名显示为 PHP

#### Scenario: Rust 使用专用语法树高亮

- **WHEN** 用户预览一个 `.rs` 文件
- **THEN** 该文件由 Rust 一等语法高亮(非 legacy 近似),预览区语言名显示为 Rust

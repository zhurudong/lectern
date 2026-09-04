## MODIFIED Requirements

### Requirement: 语法高亮的覆盖与档位

查看器 SHALL 对下列类型提供**专用高亮**(各自的一等词法/语法模式):Python、Java、C、C++、Go、JavaScript、TypeScript(含 JSX/TSX)、Rust、PHP、Markdown、JSON、HTML、CSS、SCSS、Sass、Less、SQL、YAML、XML、Shell、Ruby、Kotlin、C#、Groovy(含 `.gradle`)、TOML、Dockerfile、CMake。

其中 Rust、PHP 使用官方 Lezer 语法(与其余可跳转语言同一条语法树通道),而非借用相近语言的近似高亮。

**近似高亮**(借用相近语言的高亮通道,准确性不保证):Vue、Svelte(借用 HTML 高亮,`<script>` / `<style>` 块可高亮,模板指令如 `v-if` / `{#if}` 不保证准确)。近似 MUST 被标注为近似,MUST NOT 让用户以为是该类型的专用高亮;有专用模式可用的类型 MUST NOT 以近似充当。

两档之外的类型 SHALL 以纯文本(含行号)展示。PHP 已从"当前不覆盖"清单移除(现为专用高亮 + 可跳转)。

#### Scenario: PHP 专用高亮生效

- **WHEN** 用户预览一个 `.php` 文件
- **THEN** 该文件获得 PHP 专用高亮(产生多种高亮类),预览区语言名显示为 PHP

#### Scenario: Rust 使用专用语法树高亮

- **WHEN** 用户预览一个 `.rs` 文件
- **THEN** 该文件由 Rust 一等语法高亮(非 legacy 近似),预览区语言名显示为 Rust

## MODIFIED Requirements

### Requirement: 文件类型识别

查看器 SHALL 依据文件扩展名识别文件类型并选择渲染方式。对**无扩展名或以整文件名标识**的常见文件(如 `Dockerfile`、`CMakeLists.txt`、`Makefile`),查看器 SHALL 先按**整文件名**匹配再回退到扩展名匹配。两者都不命中时 SHALL 进行内容嗅探:文本内容按纯文本展示(可结合 shebang 识别脚本语言),疑似二进制内容走二进制降级。

#### Scenario: 常见语言识别

- **WHEN** 用户打开 `.md` / `.py` / `.java` / `.c` / `.cpp` / `.go` / `.js` / `.ts` / `.json` / `.html` / `.css` / `.scss` / `.sass` / `.less` / `.sql` / `.yaml`(含 `.yml`)/ `.xml` / `.sh` / `.rs` / `.rb` / `.kt` / `.cs` / `.gradle` / `.groovy` / `.toml` 等扩展名的文件
- **THEN** 预览区以对应语言的语法高亮(或对应渲染通道)展示内容

#### Scenario: 按整文件名识别

- **WHEN** 用户打开 `Dockerfile` 或 `CMakeLists.txt`(前者无扩展名)
- **THEN** 预览区以对应语言的语法高亮展示,而非落入纯文本

#### Scenario: 未知扩展名的文本文件

- **WHEN** 用户打开无扩展名且不在整名清单中、但内容为文本的文件(如 `LICENSE`)
- **THEN** 预览区以纯文本(含行号)展示,不报错

### Requirement: 代码语法高亮渲染

代码文件 SHALL 以只读模式渲染,包含语法高亮与行号。渲染 SHALL 保持原始内容逐字呈现,MUST NOT 修改或重排文件内容。

查看器 SHALL 按以下三档提供能力,并 SHALL 在界面上明示当前文件属于哪一档:

- **可跳转**(专用高亮 + 代码理解):Python、Java、C、C++、Go、JavaScript、TypeScript(含 JSX/TSX)。
- **仅高亮**(专用高亮,无代码理解):Markdown(源码;富文本视图另有标题大纲)、JSON、HTML、CSS、SCSS、Sass、Less、SQL、YAML、XML、Shell、Rust、Ruby、Kotlin、C#、Groovy(含 `.gradle`)、TOML、Dockerfile、CMake。
- **近似高亮**(借用相近语言的高亮,不完全准确):Vue、Svelte(借用 HTML 高亮,`<script>` / `<style>` 块可高亮,模板指令如 `v-if` / `{#if}` 不保证准确)。

**近似高亮 MUST 在界面上标注为近似**,MUST NOT 让用户以为是该类型的专用高亮。有专用模式可用的类型 MUST NOT 以近似高亮充当。

**未覆盖的类型 SHALL 以纯文本(含行号)展示**,当前明确不覆盖:Swift、Dart、Lua、Scala、R、Perl、PowerShell、Protobuf、PHP、GraphQL、Terraform/HCL,以及 Makefile(无可用的专用高亮模式,按纯文本展示但保留正确的文件图标)。此清单为**当前的明确边界**而非待办 —— 对外说明 SHALL 表述为"当前覆盖 X、不覆盖 Y",MUST NOT 表述为"尚未支持"或"以后补齐"。

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

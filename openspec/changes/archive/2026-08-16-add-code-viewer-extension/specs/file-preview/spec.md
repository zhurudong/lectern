## Purpose

负责文件内容的识别与渲染:按文件类型分发到代码高亮、Markdown 富文本、图片预览等渲染通道,并对二进制文件与超大文件做安全降级,提供接近 IDE 的只读阅读体验。

## ADDED Requirements

### Requirement: 文件类型识别

查看器 SHALL 依据文件扩展名识别文件类型并选择渲染方式;无扩展名或未知扩展名时 SHALL 进行内容嗅探:文本内容按纯文本展示(可结合 shebang 识别脚本语言),疑似二进制内容走二进制降级。

#### Scenario: 常见语言识别

- **WHEN** 用户打开 `.md` / `.py` / `.java` / `.c` / `.cpp` / `.go` / `.js` / `.ts` / `.json` / `.html` / `.css` / `.sql` / `.yaml`(含 `.yml`)/ `.xml` / `.sh` 等扩展名的文件
- **THEN** 预览区以对应语言的语法高亮(或对应渲染通道)展示内容

#### Scenario: 未知扩展名的文本文件

- **WHEN** 用户打开无扩展名但内容为文本的文件(如 `Makefile`、`LICENSE`)
- **THEN** 预览区以纯文本(含行号)展示,不报错

### Requirement: 代码语法高亮渲染

代码文件 SHALL 以只读模式渲染,包含语法高亮与行号,至少覆盖 Markdown(源码)、Python、Java、C、C++、Go、JavaScript/TypeScript、JSON、HTML、CSS、SQL、YAML、XML、Shell。渲染 SHALL 保持原始内容逐字呈现,MUST NOT 修改或重排文件内容。

#### Scenario: 高亮渲染 Go 文件

- **WHEN** 用户打开一个 `.go` 文件
- **THEN** 关键字、字符串、注释等以不同样式高亮,左侧显示行号,内容与磁盘文件逐字一致

#### Scenario: 只读保证

- **WHEN** 用户在预览区尝试输入或修改文本
- **THEN** 内容不发生变化(允许选择与复制)

### Requirement: Markdown 双模式渲染

Markdown 文件 SHALL 默认以富文本渲染(标题、列表、表格、链接、代码块等),代码块内按其声明语言高亮;用户 SHALL 能在"渲染视图"与"源码视图"之间切换。富文本渲染 MUST 对 HTML 内容做净化,防止脚本注入。

#### Scenario: 渲染视图与源码切换

- **WHEN** 用户打开 `README.md` 并点击视图切换按钮
- **THEN** 预览区在富文本渲染与带高亮的源码视图之间切换,再次点击可切回

#### Scenario: 恶意内容净化

- **WHEN** Markdown 文件中包含 `<script>` 或内联事件处理器等可执行内容
- **THEN** 渲染结果中这些内容被移除或转义,不被执行

### Requirement: Markdown 相对资源处理

在项目(目录)上下文中渲染 Markdown 时,相对路径图片 SHALL 通过目录句柄解析为本地内容展示;解析失败或处于单文件模式(无目录上下文)时 SHALL 展示占位符而非裂图。相对路径链接指向项目内文件时,点击 SHALL 在查看器内打开该文件;无法解析的相对链接 SHALL 置为不可用。远程(http/https)图片 MUST NOT 自动加载,以占位符代替;外部链接允许用户点击后在新标签页打开。

#### Scenario: 相对路径图片解析

- **WHEN** 项目内 `README.md` 引用 `![](docs/img.png)` 且该文件存在
- **THEN** 渲染视图中该图片正常显示(经本地句柄读取,无网络请求)

#### Scenario: 资源缺失或单文件模式降级

- **WHEN** 相对图片路径无法解析(文件不存在,或以"打开文件"方式打开、无目录上下文)
- **THEN** 图片位置展示占位符,页面其余部分正常渲染,不报错

#### Scenario: 相对链接项目内导航

- **WHEN** 用户点击指向项目内其他文件的相对链接(如 `[说明](../CONTRIBUTING.md)`)
- **THEN** 查看器在预览区打开目标文件,目录树选中态同步

### Requirement: 图片与二进制降级

常见图片格式(PNG/JPEG/GIF/SVG/WebP)SHALL 以图片形式预览;其他二进制文件 SHALL 展示"暂不支持预览"的提示及文件基本信息(文件名、大小),MUST NOT 将二进制内容当作文本渲染导致乱码或卡死。

#### Scenario: 图片预览

- **WHEN** 用户点击一个 `.png` 文件
- **THEN** 预览区以图片形式展示,超出区域时自适应缩放

#### Scenario: 二进制文件提示

- **WHEN** 用户点击一个 `.exe` 或 `.zip` 文件
- **THEN** 预览区展示不支持预览的提示与文件名、大小信息

### Requirement: 主题切换

查看器 SHALL 在右上角提供浅色/暗色主题切换,默认浅色;切换即时生效,作用于整体界面、代码高亮与 Markdown 渲染,选择 SHALL 在后续会话中保持。两种主题下内容均 SHALL 保持可读的对比度。

#### Scenario: 切换到暗色主题

- **WHEN** 用户点击右上角主题切换选择暗色
- **THEN** 界面、代码高亮与 Markdown 渲染即时切换为暗色配色,重新打开查看器时仍为暗色

#### Scenario: 默认浅色

- **WHEN** 用户首次安装扩展并打开查看器
- **THEN** 界面为白底浅色主题

### Requirement: 大文件降级

超过阈值(默认 5 MB)的文本文件 SHALL 走降级渲染:仅加载文件开头部分(默认前 1 MB)并明确提示"文件过大,已截断展示";降级过程 MUST NOT 阻塞界面。

#### Scenario: 超大日志文件

- **WHEN** 用户点击一个 50 MB 的 `.log` 文件
- **THEN** 预览区在短时间内展示文件开头内容与截断提示,界面全程可交互

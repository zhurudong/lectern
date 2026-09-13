## Context

Lectern 是 Preact + Signals + CodeMirror 6 的 Chrome MV3 扩展。项目目录通过 File System Access API 授权；发布产物必须保持零网络符号、零文件写入符号和空 manifest 权限。`.git` 虽被目录树/索引默认排除，但在标准仓库根目录内仍可由独立读取通道访问。

既有 spike 已证明浏览器原生 `DecompressionStream('deflate')` 能解 Git loose object，也证明典型 clone 仓库的 HEAD 和 blob 位于 packfile，故 loose-only 不是可交付切口。当前 change 进一步要求任意本地引用和 merge base，因此对象读取、引用解析、commit 图和 tree diff 必须作为一个完整的只读纵切实现。

目前唯一经用户选定的视觉是分支选择交互第 2 稿 `lectern-branch-interaction-2.png`。它只锁定“双选择器如何打开引用来源面板”，不是完整 Git 对比页面视觉。变更文件导航、diff 主区、信息密度和整体页面布局仍须在 UI 实现前单独出稿并由用户选择。图中的“解释当前改动”按钮和 AI 右栏不属于本 change 的功能范围。

## Goals / Non-Goals

**Goals:**

- 对标准 SHA-1、非 bare、本地可达 `.git` 目录实现可信的 loose/packed/delta 对象读取。
- 在不 checkout 的情况下比较本地分支、远程跟踪分支、Tag、Commit SHA 和当前工作区。
- 让 Git 解析、工作区扫描和 commit 图遍历离开 UI 主线程，并对大对象、损坏对象和竞态设置明确边界。
- 产出结构化的端点、文件状态和逐文件内容接口，后续 AI 阅读可消费，但本期不建立任何模型依赖。

**Non-Goals:**

- 不实现 fetch/pull、认证、remote 协议、checkout、index/staging、提交、合并或写回。
- 不做提交历史浏览器、blame、三方合并、冲突解决或相似度 rename 检测；首期 rename 按 delete + add 呈现。
- 不支持 bare repository、SHA-256 object format、授权根之外的 alternates/gitdir、replace refs、工作区 symlink/权限位精确检测；均走可解释降级或已声明边界。
- 不为 Git 功能放宽 CSP，不引入 native messaging、Git CLI 或 WASM。
- 不实现视觉稿中的 AI 操作和 AI 解释面板。

## Decisions

### D1 — “文件 / 变更”是同一项目下的视图态，不是第二套应用模式

在 `project` 模式内增加 `projectView = files | changes`。`files` 保持现有目录树、预览、大纲、搜索和导航栈；`changes` 使用变更文件列表 + Git 差异视图。切换视图不清空 `selectedFile`、caret、导航栈或索引状态，Git 对比也不进入 `navStack`。

这样做的关键不是少写状态，而是隔离两种语义：文件导航描述“我在项目哪里”，Git 对比描述“两个快照有什么不同”。把比较端点塞进现有 `selectedFile` 会让搜索、跳转和大纲误以为 diff 是一个真实文件。

两种项目视图共用项目壳层中的 `useResizable` 侧栏宽度、拖拽边界和持久化 key。Git 变更导航不能再自带固定列宽，否则视图切换必然发生几何跳动，也让“变更”侧栏失去用户控制。

第一次进入“变更”后，文件阅读区与 Git 对比区都保留挂载，只通过隐藏态切换可见性。这样恢复的是同一个 CodeMirror、滚动位置和 worker 会话，而不是把 UI 字段复制进第二套缓存再尝试重建；项目根变化或离开项目模式时再销毁隐藏会话。

### D2 — 只锁定分支选择交互，整体对比视觉设独立门禁

分支选择交互第 2 稿只锁定以下内容：

1. `基准 [ref] ⇄ 目标 [ref] [审查改动/直接比较]` 作为一个连续的端点选择控制组，引用控件显示名称与短 SHA。
2. 点击基准或目标后，来源面板锚定在被点击控件下方，用户在不丢失当前端点上下文的情况下反复选择。
3. 面板包含搜索、当前工作区、本地分支、远程跟踪分支、Tag 和 Commit SHA；远程跟踪分支用文字标注“本地快照”。
4. 面板支持完整键盘操作，关闭后焦点回到触发它的选择器。

引用选择不使用居中 modal：它是局部、高频动作，modal 会遮断比较上下文。也不使用 sidebar drawer：引用来源与变更文件导航是两个不同层级，塞进同一导航容器会混淆“选端点”和“选文件”。

以下内容**尚未选定**，不得从第 2 稿外推：

- “文件 / 变更”入口的具体位置和形态；
- 变更文件导航位于左侧、右侧还是可折叠区域；
- diff、文件摘要、导航按钮及状态信息的空间层级与密度；
- 是否保留辅助信息区域，以及宽窄窗口下如何重排。

进入 UI 实现前必须先提供至少 3 个完整 Git 对比页面视觉方向，覆盖正常 diff、引用面板打开和错误/空状态，由用户明确选择后再编码。该门禁不阻塞 D3–D8 的 Git 数据层和 worker 实现。本期无论选择哪套整体视觉，都不能出现可点击但无功能的 AI 按钮或 AI 空面板。

### D3 — 只在授权根内解析 repository，不向上发现

Repository probe 只检查项目根的 `.git`：

- `.git` 为目录：标准路径，进入初始化。
- `.git` 为文本文件：解析 `gitdir:`，只接受规范化后仍在授权根内的相对路径；绝对路径或包含逃逸根目录的路径返回 `gitdir-outside-authorized-root`。
- `.git` 不存在：返回 `not-a-git-repository`。

不向父目录搜索，因为 FSA 句柄没有父目录能力，尝试“猜上级路径”既做不到，也会把用户只授权子目录的选择扩大成隐式授权诉求。`src/git/fsa.ts` 只暴露 `getFile`、`getDirectory`、`entries` 和 `slice` 等读取原语，不实现任何写方法。

### D4 — 自研聚焦只读的随机访问对象层，否决通用 Git 库整包读 pack

选用 `src/git/objectStore.ts` 下的最小只读对象层，而不是引入完整 Git 实现。

本次在 2026-09-02 检查了 `isomorphic-git@1.41.9` 的发布源码：packed object 主路径在找到 `.idx` 后执行 `p.pack = fs.read(packFile)`，并对整份 pack buffer 做校验。它解决了协议和写操作等本产品不需要的问题，却在本产品最关键的本地大仓库路径上把整个 packfile 放进内存。几百 MB 的 pack 并不异常，因此不能用“加一个文件大小门槛”掩盖这个结构问题。

对象层只实现读取所需子集：

- loose object：读取单对象文件，使用 `DecompressionStream('deflate')`，解析并校验 `<type> <size>\0`。
- pack index v2：解析 fan-out、OID、CRC/offset 表和 64-bit large offset；按 OID 二分定位对象，并维护按 pack offset 排序的紧凑索引用于确定压缩流边界。
- pack v2：通过 `File.slice(start, end)` 只读取目标 entry；解析可变长 object header、OFS_DELTA 相对偏移和 REF_DELTA base OID。
- delta：递归读取 base、执行 copy/insert 指令并校验 source/result size；循环引用、越界指令或深度超过 64 立即失败。
- 对象类型：只对外暴露 commit/tree/blob/tag；读取完成后计算 Git object SHA-1 并与请求 OID 对账。SHA-1 只用于 Git 对象身份校验，不用于安全决策。

资源边界：文本 diff 复用现有 `SIZE_LIMIT = 5 MB`；commit/tree/tag 等元对象解压上限 16 MB；decoded object 使用 32 MB LRU；packfile 永不整包缓存。超过边界返回带对象类型、OID 和声明大小的结构化错误，不能回退成部分对象。

替代方案：

- loose-only：核心 clone 场景必然失败，否决。
- `isomorphic-git`：pack 整包进内存，否决主路径使用。
- Git CLI/native host：需要额外安装与高权限通道，破坏扩展的空权限/可移植模型，否决。
- libgit2/gitoxide WASM：需要放宽 MV3 CSP，且体积和审计面更大，否决。

### D5 — 引用解析只实现本地可证明语义

`src/git/refs.ts` 合并 loose refs 与 `packed-refs`，解析 symbolic ref 链并检测循环。来源映射为：

- `refs/heads/*` → 本地分支；
- `refs/remotes/*` → 远程跟踪分支，UI 永久标“本地快照”；
- `refs/tags/*` → Tag，递归 peel annotated tag，最终必须是 commit；
- SHA 输入 → 在 loose objects 与各 `.idx` 中做唯一前缀匹配，最终必须是 commit。

端点在一次比较开始时冻结为 `{ kind, label, oid }`，避免外部 Git 操作改变 ref 后，标题仍显示旧名称而内容已读到新对象。当前工作区端点冻结 `HEAD oid`，文件内容则按本次 worker 请求读取。

默认基准按以下顺序选取：本地分支中与 `refs/remotes/*/HEAD` 指向同名者、`main`、`master`、当前 HEAD。目标固定为当前工作区。该顺序只决定初始值，不写 Git config，也不声称猜中远端默认分支。

SHA-256 仓库通过 config/object ID 宽度识别后直接返回 `unsupported-object-format`，不能把 64 位十六进制 OID 截成 SHA-1。

### D6 — review 与 direct 共用快照比较器，只改变左端快照

内部端点模型：

```ts
type ImmutableEndpoint = { kind: 'branch' | 'remote' | 'tag' | 'commit'; label: string; oid: string }
type TargetEndpoint = ImmutableEndpoint | { kind: 'worktree'; label: string; headOid: string }
type CompareMode = 'review' | 'direct'
```

`direct` 将基准 commit tree 与目标 commit tree/worktree snapshot 直接交给同一 tree comparer。`review` 先在基准 OID 与目标 OID（worktree 使用 HEAD OID）之间求 merge base，再把 merge-base tree 作为左端；右端仍是用户目标，故当前工作区的未提交内容自然叠加在目标侧。

Merge base 使用 commit parent 图计算真正的“最佳共同祖先”，不以 commit 时间或最短距离猜测。若没有共同祖先、历史因 shallow/缺失对象不完整，或存在多个同等最佳 merge base，需要虚拟合并才能得到 Git 的 recursive 语义，则返回明确状态并建议 direct，绝不任选一个。

历史快照比较递归遍历 tree：相同 tree OID 整棵跳过；不同节点按原始路径合并，输出 A/M/D；gitlink、mode 或对象类型变化输出 metadata diff。首期不做 rename 推断，因为 rename 是相似度解释，不是 Git tree 中的事实。

### D7 — 当前工作区是磁盘快照，不混入 index/staged 语义

用户选择“当前工作区”时，右端描述的是此刻磁盘内容；不单独展示 staged/unstaged 两层。`src/git/worktree.ts` 从项目根遍历，硬排除 `.git`，依次应用根及嵌套 `.gitignore` 与可达的 `.git/info/exclude`。ignore pattern 采用 `ignore@7.0.8`，但需要在最小接入后先跑构建体积和不变量检查；不能为了依赖放宽检查器。

工作区普通文件以 `blob <size>\0 + bytes` 增量计算 SHA-1，与 tree OID 对比；这避免仅靠 `lastModified`/size 产生同尺寸内容变更的假阴性。哈希在 worker 中分块读取，不把大文件一次装入内存。授权范围之外的 global excludes 不读取，并按 spec 披露。FSA 不暴露 POSIX executable bit，因此当前工作区 mode-only 变化不可观测；immutable commit 之间仍精确比较 mode。

不读取 index 作为真相：index 描述暂存区，不等同于用户看到的磁盘快照；把它混进来会让“当前工作区”一词失真。它也不能解决 FSA 权限位不可见的问题。

### D8 — Git 计算放入可终止 worker，主线程只持有可序列化结果

新增 lazy-loaded `gitWorker`。第一次进入“变更”时把可 structured-clone 的 root handle 发送给 worker。协议分四类：

- `probe-and-list-refs`：仓库状态、默认端点、分组引用；
- `compare`：解析模式与端点，返回文件 manifest 和可信度状态；
- `load-file-pair`：只为当前选中文件读取旧/新内容或 metadata；
- `dispose`：释放 pack index/object cache。

每个请求带单调递增 generation。用户快速换 ref 时，主线程立即终止旧 worker 并创建新 worker；只靠“忽略旧结果”仍会让昂贵的旧图遍历阻塞新请求，不能满足最新操作优先。对象层纯读且无锁，worker 终止不会留下仓库状态。

文件 manifest 只传路径、状态、mode/OID/size 等元数据；blob 按选择懒加载，避免把整个 diff 的所有文件内容送进主线程。Git worker 独立 chunk，主界面首屏不加载 Git 解析器。

worker 生命周期属于以项目根为 key 的 `GitComparison` 实例，而不是 `projectView` 可见状态。临时切到“文件”不会 dispose worker，也不会触发新的 probe/compare；项目根变化或组件真正卸载才释放它。

刷新本地状态必须是显式动作。“重新比较”只递增比较 generation，保留用户已选端点和模式并复用既有竞态防护；视图切换本身不具有刷新语义。这样用户能在“保留审查现场”和“读取磁盘最新状态”之间做明确选择。

### D9 — 文本差异用 `@codemirror/merge`，但关闭它的写入心智

采用已在 `add-file-compare` spike 中实测的 `@codemirror/merge@6.12.2`：接入后的 `viewer` min+gzip 增量约 7.8 KB，且与现有 CodeMirror 状态/主题栈复用。这里使用 unified 形态，因为 Git 对比具有明确的 base → target 方向。

每次只把已选文件两侧不超过 5 MB 的文本交给 diff 视图。新增文件左侧为空、删除文件右侧为空。先用现有二进制嗅探判断通道；二进制、gitlink、mode-only 和超限 blob 走 metadata view。

必须显式关闭 merge/accept/reject/revert 控件，并用 DOM 负向断言验证“控件不存在”，不能只断言配置值。CodeMirror state 同时设置 read-only。差异配置不采用默认 `scanLimit: 500`；用有界 timeout 控制主线程计算，并读取 chunk 的 `precise` 信号。只要任一 chunk 不精确，文件标题持续显示近似警告。

上一处/下一处复用 CodeMirror merge 的 chunk 导航能力，按钮和键位走同一命令；进入 diff 后定位第一处，退出 ref panel 或变更视图时显式归还焦点。

### D10 — 状态模型把“空结果、不可用、近似”分开

`src/git/state.ts` 不用一个空数组同时表示所有情况，而使用判别联合：

```ts
type GitCompareState =
  | { kind: 'idle' | 'loading' }
  | { kind: 'unavailable'; reason: RepoUnavailableReason }
  | { kind: 'ready'; files: ChangedFile[]; confidence: 'exact' | 'limited' }
  | { kind: 'error'; error: GitReadError }
```

`ready/files=[]` 才能显示“没有变化”；repo 不可达、merge base 不成立、对象损坏、大文件和近似 diff 各有独立原因。错误携带操作阶段、OID/ref/path（如有）和可恢复动作，但不泄露授权根之外的绝对路径。

### D11 — 自动化以系统 Git 为 oracle，不自己给自己判卷

对象层和比较语义不能只用手写 fixture 的期望值验证；测试脚本在临时目录调用系统 Git 生成仓库，再把完整目录复制进 OPFS/FSA fixture：

- loose、普通 pack、强制 OFS_DELTA、强制 REF_DELTA、annotated tag、packed-refs、detached HEAD；
- 分叉分支、无共同祖先、criss-cross 多 merge base、shallow/缺失对象；
- tracked 修改/删除、非 ignored untracked、嵌套 `.gitignore`、binary、gitlink、mode-only、>5 MB blob；
- 损坏 header、越界 delta、delta 环/深度、pack 在读取期间被替换。

对象结果逐一对拍 `git cat-file`; merge base 对拍 `git merge-base`; 文件状态和内容对拍 `git diff --raw/--no-renames` 与受控工作区快照。delta 解释器增加随机合法指令的还原测试和恶意边界测试。UI E2E 覆盖视觉层级、五类来源、键盘、焦点、旧请求不覆盖新请求、无合并控件及近似/大文件披露。

OPFS 无法证明真实系统目录对 `.git` 的可达性，也无法复现授权根外的真实 gitdir，因此 release 前保留真机人在环：打开标准 clone、linked worktree 和 submodule 各一次。最后比较操作前后的工作区与 `.git` 内容摘要，并运行现有发布产物不变量检查。

## Risks / Trade-offs

- [自研 pack/delta 读取器的正确性负担高] → 严格缩到只读子集；以 Git CLI 作为 oracle；随机/恶意 fixture；对对象 OID、size 和 delta 边界逐层校验。
- [超大 pack 或高对象数导致内存/响应时间上升] → `.idx` 与 `.pack` 均随机读取；紧凑 typed-array 索引；32 MB LRU；worker 懒加载和可终止；不整包缓存。
- [巨大/古老 commit 图的 merge-base 遍历较慢] → 双端遍历、parent cache、worker 进度与终止；首期不解析 commit-graph 文件，实测若成为瓶颈再单立优化，不用 commit 时间近似正确性。
- [外部 Git 进程在读取期间 gc/repack 或改 ref] → 比较开始冻结 OID；File/handle 读取失败后整次请求最多重试一次；仍不一致则提示仓库正在变化，不创建 `.lock`。
- [部分 clone、alternates、SHA-256、worktree gitdir 等仓库形态不可读] → 识别并给具体原因；不联网补对象，不把缺失显示为空差异。
- [ignore 规则与系统 Git 的 global excludes 不完全一致] → 精确执行仓库内规则，明确不读取授权外全局配置，测试以隔离 global config 的 Git oracle 对拍。
- [新增 Git worker 增加包体积] → Git 代码独立 lazy chunk；记录主 chunk、Git chunk、总 zip 的 min+gzip 增量；任何依赖必须继续通过零网络/只读符号检查。
- [保活隐藏的 Git 对比会话会占用一份 worker 与 diff DOM] → 仅缓存当前项目的一份会话；项目根变化或离开项目模式立即释放，不做多项目后台缓存。

## Migration Plan

1. 先落对象层、oracle fixtures 和不变量/体积基线，不暴露 UI 入口；loose/pack/delta 未全部对拍前不得进入界面实现。
2. 接入 refs、merge base、tree/worktree compare 和 worker，先通过结构化结果测试。
3. 接入“文件 / 变更”、双选择器、变更列表和 unified diff；补齐键盘、主题和负向只读断言。
4. 完成标准 clone、linked worktree、submodule 真机核验后再发布。

本变更不迁移或持久化用户数据。若需要回滚，移除 `changes` 视图入口、Git worker 与新增依赖即可；既有文件阅读路径和 IndexedDB 数据不受影响。

## Resolved Visual Direction

- 2026-09-02 用户在三套完整方向中明确选择第 2 套。实现采用左侧 M/A/D 变更导航、中间统一 diff、右侧只读“文件事实”栏；ref picker 继续匹配已选的锚点式交互稿 #2。两份视觉中的 AI 操作与解释内容均不属于本 change，禁止实现或保留占位。

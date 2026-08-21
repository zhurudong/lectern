## MODIFIED Requirements

### Requirement: 权限边界

扩展 MUST 仅访问用户显式授权的目录/文件,MUST NOT 将文件内容发送到任何远程服务;所有读取与渲染均在本地完成。

**该承诺 SHALL 是可自证的**:构建产物中 MUST NOT 出现任何网络 API 的**引用**(`fetch(` / `XMLHttpRequest` / `WebSocket` / `EventSource` / `sendBeacon`)。**判定按符号引用而非构造调用** —— `WebSocket` 的任何出现都要看一眼,不限于 `new WebSocket`:**能拿到构造器就能在别处构造,把判定限死成"构造调用"等于给绕过留了写法**,使"零网络"能被一条针对产物的文本检查验证,而不必依赖阅读源码或信任声明。

**只读同样 SHALL 是可自证的**:发布产物中 MUST NOT 出现文件写入 API 的调用符号(`createWritable` / `showSaveFilePicker` / `removeEntry`)。File System Access API 的一切写入都必须经 `createWritable()`,该符号缺席即"**没有能力写**"的机器可查形式 —— 这比"承诺不写"强,理由与零网络同构。

**权限声明同样 SHALL 是可自证的**:发布产物的 manifest 中 `permissions` MUST 为空,且 MUST NOT 出现 `host_permissions`、`content_scripts`,或**覆写默认 CSP 的 `content_security_policy`** —— 前两项缺席意味着扩展**无任何主机访问能力**,后者缺席意味着它**不向任何网页注入代码**。CSP 那条守的是一个此前**只写在 design 里、没有任何机制看着**的决定:当初排除 tree-sitter WASM 的**决定性理由**就是"不能为它放宽 CSP(`wasm-unsafe-eval`)"。若无此项,谁哪天加一条 CSP 覆写都不会有人发现,而**那条决定仍会以"我们为什么不用 WASM"的形式继续出现在对外说明里** —— 那时它就成了一句已被推翻却还在被引用的话。

这与网络、写入两项构成同一套自证的三条腿:**能力的缺席可被静态检查证实,而"承诺不用"不能。**

检查所依据的产物 SHALL 是**从当前源码构建出来的那一份**。**一份过期但干净的产物,会让检查为"你没问的原因"而通过** —— 那时通过的是历史,不是现状。因此该性质在**两条路径上都要成立**:

- **自动化路径**(验收脚本 / CI):MUST 就地构建后再检查,MUST NOT 检查"碰巧留在目录里的那一份";
- **人工路径**(文档教用户跑的命令):文档虽写"先构建再检查",但**没有任何东西拦住一个人只跑后半句**,因此检查器自身 SHALL 在产物早于源码时**明确告知**。是否因此判失败可自行取舍(误判会耗掉检查器唯一的资产——可信度),但**沉默不可接受**。

**只堵自动化那条,会留下一条看起来已经关上的门。**

上述各项检查的对象 SHALL 是**发布产物**,而非源码仓库:验收脚本为构造测试夹具**可以**、也确实需要写文件(当前 `scripts/e2e.mjs` 用 OPFS 建合成项目,含 `createWritable` 与 `removeEntry`)。**把检查对象钉在仓库上会与验收基建直接冲突**,并在将来测试钩子需要写入能力时把要求逼到墙角。

此要求同样适用于**工具链自动注入的代码**:若构建工具为兼容旧浏览器而注入了包含上述符号的兜底逻辑,MUST 在构建配置中关闭该注入。该做法的前提是 `minimum_chrome_version` 已覆盖对应特性的原生支持 —— **下调 `minimum_chrome_version` 时 MUST 重新评估这些被关闭的兼容兜底是否仍可安全省略**。

#### Scenario: 无网络传输

- **WHEN** 用户浏览任意项目文件
- **THEN** 扩展不发起任何携带文件内容或文件路径的网络请求

#### Scenario: 零网络可被产物检查自证

- **WHEN** 任何人对发布产物中的脚本执行网络 API 符号检查
- **THEN** 检查结果为零命中,无需解释"某处命中是无害的"

#### Scenario: 只读可被产物检查自证

- **WHEN** 任何人对发布产物中的脚本执行文件写入 API 符号检查(`createWritable` / `showSaveFilePicker` / `removeEntry`)
- **THEN** 检查结果为零命中 —— 扩展**没有能力**写入用户磁盘,而不只是承诺不写

#### Scenario: 权限声明可被产物检查自证

- **WHEN** 任何人检查发布产物的 manifest
- **THEN** `permissions` 为空数组,不存在 `host_permissions`、`content_scripts`,也不存在覆写默认 CSP 的 `content_security_policy`

#### Scenario: 产物早于源码时不得沉默通过

- **WHEN** 有人跳过构建,直接对一份早于当前源码的产物运行检查
- **THEN** 检查明确告知该产物可能早于当前源码,**且该告知与结论出现在同一处**,不会因为只读结论行而丢失

#### Scenario: 检查对象是发布产物而非仓库

- **WHEN** 验收脚本为构造测试夹具而使用了文件写入 API
- **THEN** 这不违反本要求 —— 检查针对发布产物,验收基建不在其范围内

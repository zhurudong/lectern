## Context

原提案使用 localhost WS；后续用户要求减少首次与逐项目配置。本次替代其传输、安装、CSP 和 token 验收条款，其余层一终端约束保留。当前分支没有 src/i18n，阅读器现行权限为 storage、declarativeNetRequestWithHostAccess 与 file:///*；不将旧提案的空权限描述当作当前事实。

## Decisions

Chrome runtime.connectNative 在 viewer 持久页面发起，主机名固定 com.lectern.agent。浏览器注册清单与主机内置 allowlist 双重校验精确扩展 origin。stdio 使用 4 字节本机字节序长度加 JSON，输入单帧上限 64 KiB，输出小于 Chrome 1 MiB 限制。先 hello/protocol=1，再 project、start；每个 port 至多一个 PTY。Chrome 启动独立 host，退出/断开销毁 PTY；自然退出不重启，异常断开有限重试。无监听端口，无配对 token。

项目标识使用 IDB 中真实 DirectoryHandle.isSameEntry；每个 origin + UUID 对应独立原子文件。原有全局 preferences 项目映射可读回退；并发 native host 不会覆盖其他项目。首次要求用户在系统选择器确认相同目录，浏览器句柄不能提供可信绝对路径。目录移动/清理浏览器数据可能重新选择。选择器是系统窗口，终端不是弹窗。

安装包固定 /Applications/Lectern Companion.app 与 /Library/Google/Chrome/NativeMessagingHosts；禁止 bundle 重定位。Node 官方归档 SHA-256 固定，按架构打包 node-pty 预编译模块及许可，不依赖用户 Node 或源码。Chrome 按需启动，不使用 launchd。CLI 自行管理安装、认证与模型请求；只检测可执行文件存在，不把存在等同于已登录。

正式构建要求扩展 ID、HTTPS 下载入口、Developer ID Application/Installer 与 notarytool profile。签名、公证、staple/验证失败即构建失败。无凭据只能产出显式 UNSIGNED-DEV 文件，不能宣传可直接发布。更新重新安装同一位置，保留用户关联；卸载显式由用户执行，保留 CLI/登录及关联。

## Risks / Trade-offs

macOS 首版；Apple Silicon 本机测试，Intel 构建可配置但尚需 Intel 机器验收。首次 pkg 安装需要系统管理员授权。开发用户级注册会覆盖系统 host，正式 pkg 验收前必须移除开发注册。签名/公证与干净机器安装需真实发布环境。多 Chrome profile 共用扩展 origin 但独立项目 UUID；不做多 agent 编排。

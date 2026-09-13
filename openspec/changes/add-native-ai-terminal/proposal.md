## Why

首次 Web Store 用户不能依赖源码、Node/npm、手动启动 localhost 服务或复制 token。用户已批准将层一终端升级为安装一次伴随程序、Chrome 按需启动的流程。

## What Changes

- AI 终端保持阅读区右侧 dock，改用 Native Messaging 和 macOS 伴随安装包。
- 增加首次安装、CLI 缺失、协议版本、目录关联及更新/卸载引导。
- AI 独立产物只增加 nativeMessaging 权限；纯净版权限、CSP 和阅读器能力保持现行门禁。
- 将此前 AI 的单 localhost WS 例外替换为唯一精确 native host 调用，新增安全负向控制。
- 不做遥测、hook、自动任务、云端模型接入或对话恢复。

## Impact

- Affected specs: ai-terminal (new)
- Affected code: src/ai, vite.config.ts, lectern-agent/native, scripts/native, invariant/E2E gates
- 旧 WS CLI 保留用于历史兼容测试，不包含在正式伴随安装包，也不再由 AI 扩展连接。

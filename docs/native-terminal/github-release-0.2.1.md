# Lectern Agent 0.2.1 — unsigned preview / 未签名预览版

Local Native Messaging companion for Lectern's optional AI terminal. The app bundle remains named **Lectern Companion**.

**Unsigned and not notarized by Apple.** GitHub hosts these files; it does not replace Developer ID signing or Apple notarization. macOS may block installation or launch. Verify the repository and SHA-256, then decide whether to allow the specific program using [Apple's guidance](https://support.apple.com/102445). Managed Macs may prohibit installation. The installer does not disable system security checks or remove quarantine attributes.

**本次安装包未签名、未公证。** macOS 可能阻止安装或启动，需要用户核对来源和校验和后自行决定是否允许。没有 Lectern Agent 仍可使用代码阅读器。

## Compatibility / 适用范围

- macOS 13.5+, Google Chrome, Lectern **AI build 0.4.0**.
- Bound exclusively to Chrome extension ID: `ahmcjpgaejjfgiihipkjlhmepcnkbddm`.
- A locally installed and authenticated Codex or Claude Code CLI is required separately. CLI/provider accounts, fees and data policies apply independently.
- The official Node runtime is bundled; users do not need to install Node.js for this companion.

| Mac chip | Download |
| --- | --- |
| Apple silicon / M 系列 | `Lectern-Companion-0.2.1-macOS-arm64-UNSIGNED.pkg` |
| Intel | `Lectern-Companion-0.2.1-macOS-x64-UNSIGNED.pkg` |

Download the matching `.pkg` and `.pkg.sha256` into the same directory. In Terminal, run `shasum -a 256 -c` followed by that `.sha256` filename. The result must be `OK`. A matching checksum detects a changed file; it is not an Apple trust/notarization result.

## First installation / 首次安装

1. Download the package for your Mac chip from this Release, verify it, and open it. If macOS blocks it, read the Apple instructions above and make your own decision. Administrator authorization may be requested for installing to Applications and registering the Chrome native host.
2. Install and sign in to your chosen CLI using its official instructions. Existing CLI installations can be reused. Do not send account credentials to the Lectern maintainer.
3. Open a disposable project in Lectern, click **AI terminal → Reconnect**. In the system picker, choose the same project directory.
4. The terminal opens beside your code; drag the divider to resize it. Closing the panel ends that CLI session. Reopening starts a new session.
5. The directory association is reused for the same project. A new project requires one initial directory selection.

首次安装：下载匹配芯片的安装包并核对 SHA-256 → 按 macOS 提示自行确认是否安装 → 准备并登录 AI CLI → 返回 Lectern 点击 AI 终端、重新连接 → 选择同一项目目录。以后同一项目复用关联，新项目只选一次目录。

## Data and permissions / 数据与权限

The reader is local and read-only. The selected CLI runs with your user permissions, may modify files and may send context to its configured model providers. Native Messaging relays terminal input/output locally. There is no Lectern telemetry, model hook or localhost server to configure.

## Update and uninstall / 更新与卸载

Close terminal panels before installing an updated package. The installation path stays fixed; directory associations are retained.

To uninstall, open `/Applications/Lectern Companion.app/Contents/Resources` in Finder and run `Uninstall.command`. Confirm system authorization yourself. This removes the companion and Chrome host registration, retaining CLI installations, sign-in and project associations. Uninstall the extension separately. To erase companion associations, remove `~/.lectern-agent/` after uninstalling.

## Verification limits / 验证范围

The packages pass checksum, version, extension identity and Node/PTY/helper architecture checks. The ARM64 bundled runtime also passes handshake and lifecycle checks. The extension passes isolated Native Messaging tests using a test host.

Clean installation from a quarantined public download, Gatekeeper prompts, Intel runtime behavior and the final Chrome Web Store installation path still need user validation. This is a public preview for that validation, not a claim of Apple approval or completed store review.

Source for this release is the associated Git tag. Support: [Lectern issues](https://github.com/zhurudong/lectern/issues).

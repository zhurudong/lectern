> 当前 AI 扩展已改用 Native Messaging。首次安装、打包与更新请见 [macOS 终端指南](../docs/native-terminal/README.md)。下文 WS CLI 为旧 spike 兼容路径，新用户无需启动它。

# Lectern AI terminal

An opt-in local PTY companion. No telemetry, hooks, model API client or orchestration is included. The installed agent CLI uses its existing login and settings. It runs with **your user privileges**, including the ability to read/write files and contact its configured model provider. The reader and agent have different capabilities.

## First installation — macOS

Requires Node.js 20+, Chrome 122+, and an installed/logged-in `codex` (default) or `claude` executable on PATH.

From the repository, after installing the main project's dependencies:

```sh
npm run setup:ai
```

This builds `dist-ai`, installs the companion dependencies, installs a self-contained companion snapshot under `~/.lectern-agent/`, and starts a per-user macOS LaunchAgent. It runs at login and restarts after a crash. It does not require administrator privileges. Switching branches or closing the development terminal does not affect the installed snapshot. Run the setup command again to update it.

Load `dist-ai/` in `chrome://extensions` using **Load unpacked**. The standard `dist/` build has no AI terminal. If AI is already installed, refresh the Lectern page after building.

1. Open your project in Lectern, then click **AI 终端**.
2. For a new pairing, approve the native **Lectern 本机配对** dialog only if you just opened the panel. It displays the exact extension Origin. The token is exchanged and saved automatically; no manual copy is needed.
3. In the system folder picker, select the **same project directory** you are reading. This selection is remembered for that directory handle. The terminal starts automatically.

The terminal opens as a resizable dock to the right of the code reader, without a modal or backdrop. Drag the divider to adjust its width; the width is remembered.

For subsequent uses, open the project and click **AI 终端**. No terminal command, token or absolute path entry is needed. The companion must have been installed on that Mac. The first connection may trigger macOS's normal file-access prompt; no Full Disk Access setting is required by the installer.

The terminal header shows the selected project and its resolved local path. **更换关联目录** corrects an association through the native folder picker. Same-name directories have separate identities; the browser compares real directory handles rather than trusting names. Deleted/moved paths require selecting the directory again. An independent terminal opened without a project has its own separate association.

## Connections and sessions

- Temporary service/network failures retry automatically with 1/2/4/8/15-second backoff. A server heartbeat detects half-open connections.
- Reconnecting **starts a new CLI session**; it does not restore the previous conversation. Closing the panel ends its PTY. The companion itself stays running.
- Normal CLI exit, rejected credentials, and cancelled pairing/folder selection stop retries. **重新连接** retries explicitly; **重新配对** requests fresh local authorization for an expired token.
- One PTY is allowed at a time. Close the other panel if a second session is rejected.
- Escape/arrows/Enter/Ctrl-C inside xterm go to the CLI. The close button or Escape outside xterm dismisses the panel and restores focus.
- Port (default 8137) and executable can be changed under **安装与高级设置**. The executable is a single executable name/path, not a shell command with arguments. A custom service port must match the panel setting.

## Companion commands

```sh
# Foreground mode, with automatic local pairing
node lectern-agent/cli.mjs

# Start now and at login; optional custom port
node lectern-agent/cli.mjs --install
node lectern-agent/cli.mjs --install --port 8138

# Stop and remove login service; pairing/project associations remain
node lectern-agent/cli.mjs --uninstall
```

`npm install -g ./lectern-agent` also provides the `lectern-agent` command. This package has not been published by this change; do not assume the public npm name is available. Native dependencies may require the platform compiler toolchain when no prebuilt binary exists. The macOS executable-bit fix for node-pty 1.1.0 runs during installation; with install scripts disabled, run `node lectern-agent/install.mjs` explicitly.

Automatic startup and native dialogs currently support **macOS only**. No Linux/Windows startup integration is claimed. Agent tests using `/bin/sh` also target POSIX.

Existing v1 installations can migrate their already-approved token once with `--origin chrome-extension://<id>` when running `--install`. New installations do not need this option. The old global cwd is deliberately not migrated to a project: it had no reliable directory identity.

The launchd service is `com.lectern.agent`; configuration lives in `~/Library/LaunchAgents/com.lectern.agent.plist`. Logs are `~/.lectern-agent/service.log` and `service-error.log`. If Node.js itself is removed or its executable path changes, rerun installation.

## Security boundary

- Bind address is fixed to `127.0.0.1`. Exact loopback Host and `/` path are required. Websites, missing Origin, aliases and query strings cannot handshake.
- A syntactically valid extension Origin may connect without a token **only to request native pairing confirmation**. It cannot resolve project paths or start/write/resize a PTY. There are no automatically trusted new origins.
- Successful native confirmation creates a random token scoped to the exact Origin. Re-pairing requires fresh confirmation. Browser Origin is not a substitute for token authentication.
- Pairing dialogs are serialized and rate-limited; messages while confirmation is pending are rejected. Cancellation/disconnection does not create credentials or project associations. Unauthenticated idle connections time out after five seconds; dialogs have bounded deadlines.
- Origin-specific tokens and origin/project-specific directory associations are persisted in `~/.lectern-agent/preferences.json` (0600, directory 0700). Extension credentials are stored in its localStorage; directory identity is stored as a structured-cloned handle in a separate IndexedDB database. No new write capability is introduced into the reader.
- Frame size, terminal dimensions, connection count and output buffering are bounded. Disconnect kills the PTY; child-process behavior beyond it remains the CLI's responsibility.
- The AI build retains its exact audited local-file CSP plus one numeric-port loopback WebSocket constructor. The standard build removes the entire AI module. Existing build invariants and their negative controls remain enforced.

## Acceptance

```sh
npm run build
npm run check
npm run check:ai
```

The AI suite tests native-confirmation boundaries through injected callbacks, real shell PTY I/O/cwd/resize/exit, denied/abandoned pairing, cross-origin credentials, directory isolation/persistence, self-contained installation, and real Chrome with a loopback mock. Browser coverage includes automatic pairing, reuse, service restart reconnect, stopping after natural exit/auth failure/cancellation, real same-name directory handles, persistence across reload, and no AI socket in the standard build.

Optional real CLI startup (uses the installed agent/login but sends no model task):

```sh
AI_REAL_AGENT=codex node scripts/e2e-ai.mjs
```

# Lectern AI terminal — layer-one spike

Opt-in local terminal companion. No telemetry, hooks, orchestration or cloud API client is included. The agent CLI runs normally with your existing login and configuration, with **your user privileges**, including the ability to modify files and contact its configured model provider. Lectern's reader remains read-only; the terminal's agent does not.

## Run from this repository

Requires Node.js 20+, Chrome 122+, and an installed, logged-in `codex` (default), `claude`, or another executable on PATH. macOS has been exercised; Linux/Windows have not been validated in this spike. Native dependency installation may require the platform's compiler toolchain when a prebuilt binary is unavailable.

```sh
npm ci
npm run build:ai
npm ci --prefix lectern-agent
```

1. In `chrome://extensions`, enable developer mode and load the repository's **`dist-ai/`** directory. This is a separate extension artifact; `dist/` remains the pure edition.
2. Open Lectern → **AI 终端**. Copy the exact `chrome-extension://…` Origin shown in its pairing instructions.
3. Start the companion in a terminal:

   ```sh
   node lectern-agent/cli.mjs --origin chrome-extension://YOUR_EXTENSION_ID
   # Optional: --port 8138
   ```

4. Read `~/.lectern-agent/token`, then enter that token, the port, the **absolute project directory**, and executable name/path in the panel. Press **保存并连接**. The executable field is one executable, not a shell command with arguments.
5. On subsequent panel opens, saved settings connect automatically. If the program is unavailable, the panel shows a startup hint. Reopen the panel or use **保存并连接** after starting it.

The browser's File System Access API does not disclose an absolute filesystem path. Confirm the manually entered path matches the project being read. Settings (including the pairing token) are stored in the extension's localStorage. They are not synced; treat the token as a local credential. To revoke pairing, stop the companion, remove its token file, restart, and pair again.

Close the panel to terminate the PTY; reopening starts a new session. Escape, arrows, Enter and Ctrl-C inside the terminal go to the CLI. Escape outside the terminal or the close button dismisses the panel and restores focus. One authenticated session is supported; a second one is rejected. There is no background session resumption or auto-start installation in v1.

## Installation package

This directory is an independent npm package with a `lectern-agent` executable. It is **not published by this change**. For local global-command installation:

```sh
npm install -g ./lectern-agent
lectern-agent --origin chrome-extension://YOUR_EXTENSION_ID
```

After separately publishing the package, `npm i -g lectern-agent` / `npx lectern-agent --origin …` use the same entry point. Do not assume the public npm name is available or already belongs to this project.

`node-pty` is pinned to 1.1.0. Its macOS prebuilt `spawn-helper` arrives without execution permission; `postinstall` repairs only that dependency helper's executable bits. If install scripts are disabled, run `node lectern-agent/install.mjs` explicitly after installing dependencies. Without the repair, macOS reports `posix_spawnp failed`.

## Security boundary

- Binds only `127.0.0.1`, default port 8137. No configurable bind address.
- Requires an exact configured extension Origin and exact loopback Host before the WebSocket handshake. Missing/foreign origins, DNS host aliases and query-string credentials are rejected.
- Requires a persistent random token in the first `start` frame before starting a process. Token directory/file use 0700/0600. Origin checking does not replace the token; non-browser clients can forge Origin.
- Unauthenticated connections time out after five seconds. Frame size, dimensions and output buffering are bounded. Disconnection kills the PTY. Agent subprocess behavior remains the CLI's responsibility.
- The AI extension CSP permits only `ws://127.0.0.1:*` connections. There are no host permissions or added extension permissions. The single numeric-port WebSocket constructor is checked in the built artifact; every other existing network prohibition still applies.
- The pure build removes the entire AI import, UI, xterm and transport. It retains its default CSP and original zero-network guarantee.

## Reproduce acceptance

```sh
npm run build
npm run check
npm run check:ai
```

`check:ai` builds `dist-ai`, checks the narrow transport/CSP exception, mutates copies of both builds to prove the gates fail, runs companion security and real shell PTY tests, then uses real Chrome with a loopback mock to test the rendered terminal. It requires permission to launch Chrome and bind loopback. Build `dist` first; the pure-artifact tests intentionally inspect that separately built product.

The browser test covers initial pairing, disclosure, stdin/control keys, rendered output, resize, focus return, automatic connection on reopening, failure guidance, and **zero socket creation in the pure build even with saved AI settings**. Agent tests prove rejected requests never call spawn and exercise real `/bin/sh` cwd, input, `stty size` and exit code. The shell test currently targets POSIX systems.

Optional real Codex startup check (launches your authenticated CLI in the repository; sends no model prompt):

```sh
AI_REAL_AGENT=codex node scripts/e2e-ai.mjs
```

This check is separate from the default suite because it uses the locally installed agent and its credentials. Verified on macOS: the real companion starts Codex in the repository directory, its startup screen renders inside the extension, and closing the panel ends the session. No model prompt is sent.

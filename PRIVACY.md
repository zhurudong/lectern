*English · [中文](PRIVACY.zh-CN.md)*

# Lectern Privacy Policy

Last updated: 2026-09-13.

Lectern provides a local code reader and, in the AI build, an optional terminal connected to a separately installed companion. These components have different capabilities. Lectern has no developer-operated data collection service, analytics, telemetry, advertising or account system.

## Local reader

Reading, indexing, search, Markdown preview and file/Git comparisons run on your computer. The reader does not upload project contents, fetch remote resources or modify your project files. Its bundled resources do not require a CDN. Remote Markdown images are not fetched.

You grant access by selecting a file or folder in Chrome. Alternatively, Chrome's **Allow access to file URLs** setting grants access to local file URLs. Lectern's automatic-opening preferences select which suffixes open in Lectern; they do not narrow Chrome's underlying file URL permission. Turn that Chrome setting off to revoke URL access. Manually selecting a file remains available.

The standard build uses `storage` for preferences, `declarativeNetRequestWithHostAccess` for matching local file navigations, and only `file:///*` host access. It has no HTTP(S) host permissions or content scripts.

## Optional AI terminal

Only the AI build requests `nativeMessaging`. Opening its terminal asks Chrome to start the installed Lectern Companion on your computer. The extension passes your selected executable, project identifier/display name, keyboard input and terminal dimensions; the companion returns its selected directory, status and CLI output. This connection uses local native messaging, not a remote Lectern server.

The companion launches the CLI you choose with your user permissions. **That CLI can read and modify files and send prompts, source code or other context to its configured model providers.** These actions follow your commands, CLI configuration and provider policies. The reader's read-only and offline guarantees do not apply to the CLI. Lectern does not manage provider accounts, authentication, billing or retention. Consult the CLI and provider before using sensitive projects. There is no Lectern telemetry or model API integration.

Closing the panel ends its connection and requests termination of the CLI. It is not a promise to undo file edits or erase conversations retained by the CLI/provider. Reconnection starts a new session.

## Local storage and deletion

- Chrome IndexedDB stores recent file/folder handles and AI project identities, not copies of the project source tree.
- Local storage retains theme, interface language, panel widths and selected CLI executable. Chrome local storage also retains automatic-opening preferences and local redirect rules.
- The companion stores project-directory associations in `~/.lectern-agent/` outside the browser. The current native transport does not use a pairing token; older development versions may have left tokens/logs in that directory.
- Terminal output is displayed in the running panel. The companion does not intentionally persist a terminal transcript; the selected CLI may retain its own sessions, logs or credentials.
- Local file URLs may appear in Chrome history/session restoration. Chrome manages those separately.

Removing the extension clears its extension storage and rules, but does not remove the companion, CLI data, provider records or Chrome history. Uninstall the companion separately using its provided uninstall entry. Its default uninstall retains directory associations; remove `~/.lectern-agent/` after uninstalling to erase them. Manage CLI authentication and provider records using their respective tools. Your project files are not deleted by uninstalling Lectern.

## Downloads and external links

Installation/help links open external websites when you choose them. Those sites and download providers process requests under their own policies. Lectern does not silently download or execute remote extension code. Chrome and the operating system manage extension/package updates separately.

## Contact and verification

Source, support and privacy questions: [Lectern repository](https://github.com/zhurudong/lectern/issues).

The standard build is checked with `npm run build && npm run check`; the opt-in native boundary has separate AI checks. These checks do not establish the behavior or privacy practices of third-party CLIs.

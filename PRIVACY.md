*English · [中文](PRIVACY.zh-CN.md)*

# Privacy Policy

**Lectern collects nothing, sends nothing, and stores nothing outside your own
browser.** This document is the privacy policy referenced by the Chrome Web
Store listing.

Last updated: 2026-09-11.

## What is collected

Nothing. There is no analytics, no telemetry, no crash reporting, no usage
statistics, no update check, no license check, and no account.

Under the Chrome Web Store's data disclosure categories, the answer is "not
collected" for every one: personally identifiable information, health
information, financial information, authentication information, personal
communications, location, web history, and user activity.

## What leaves your computer

Nothing. The standard extension does not contact remote services or transmit
file contents or paths. Every asset it needs — the editor, the language
grammars, the fonts — is bundled in the extension package. Local `file://`
reads stay on your machine.

It declares `storage` for saved automatic-opening preferences and
`declarativeNetRequestWithHostAccess` to redirect matching local file
navigations into the viewer. Its only host permission is `file:///*`; it has
no HTTP(S) host permissions or content scripts. Only `viewer.html` is exposed
as a web-accessible resource, and only to `file:///*`.

## What it can read, and how you grant it

Through Chrome's own file picker, you choose a folder or a file and the
extension receives a handle to that selection. This path does not require
Chrome's file URL access setting.

Alternatively, enable **Allow access to file URLs** in Lectern's Chrome
extension details to let it read local file addresses directly. This Chrome
setting grants local URL access beyond the individual items selected through
the picker. The viewer's *自动打开* settings control which file extensions
automatically open in the current tab; they do not narrow the underlying
Chrome grant. HTTP(S), remote file hosts, directories and page subresources
are not handled. Turn off Chrome's setting to revoke URL access.

Automatic opening reads one file, up to 64 MiB, into memory and reads it again
when you refresh the tab. It does not obtain a parent directory handle, index
neighboring files or resolve Markdown relative resources. Larger files can be
selected manually; text previews above 5 MiB display their first 1 MiB.

It **never writes**. Writing a file through the File System Access API requires
`createWritable()`, which does not appear anywhere in this extension's source
or in its built package — a build in which it appears fails the project's CI.

## What is stored, and where

Inside your own Chrome profile, on your machine:

- **IndexedDB** — handles for recent projects, so you can reconnect after a
  restart, and the display name and path shown for them;
- **`localStorage`** — interface preferences: theme, sidebar width, panel
  collapse state;
- **`chrome.storage.local`** — the automatic-opening switch and selected file
  extensions. These preferences are not synced to a remote account.

Chrome also stores the extension's redirect rules locally. They describe the
selected suffixes, not a history of files opened. An automatically opened
file's local address is part of its viewer tab URL and can be retained by
Chrome's own history or session restoration; Lectern does not upload it.

Lectern does not transmit any of it. Removing the extension removes its stored
handles, preferences and rules; Chrome's browsing history is managed
separately. Your project files are never copied into extension storage — it
contains only the handles Chrome gives out, preferences and redirect rules.

## Third parties

There are none. No SDKs, no CDNs, no fonts loaded from a font service, no
remote images (images referenced by remote URLs inside a rendered Markdown file
are deliberately replaced with a placeholder rather than fetched).

## Verifying all of the above

You do not have to take this document's word for it. The extension is open
source under Apache 2.0. Build it yourself and run the invariant checks:

```bash
npm ci && npm run build
node scripts/check-invariants.mjs
```

The checks enforce exact permissions and CSP, a fixed digest for the sole
audited local URL reader, rejection of non-local addresses, and forbidden
transfer APIs in the remaining package. File write APIs remain forbidden
throughout. The same checks run on every commit in CI, and a release that
fails them is never published.

## Contact

Open an issue on the project repository.

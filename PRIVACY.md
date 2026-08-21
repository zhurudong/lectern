*English · [中文](PRIVACY.zh-CN.md)*

# Privacy Policy

**Lectern collects nothing, sends nothing, and stores nothing outside your own
browser.** This document is the privacy policy referenced by the Chrome Web
Store listing.

Last updated: 2026-08-20.

## What is collected

Nothing. There is no analytics, no telemetry, no crash reporting, no usage
statistics, no update check, no license check, and no account.

Under the Chrome Web Store's data disclosure categories, the answer is "not
collected" for every one: personally identifiable information, health
information, financial information, authentication information, personal
communications, location, web history, and user activity.

## What leaves your computer

Nothing. The extension makes no network requests at runtime. It declares no
`host_permissions`, no `permissions` at all, and no content scripts, so it
cannot reach any website or any other tab. Every asset it needs — the editor,
the language grammars, the fonts — is bundled in the extension package.

## What it can read, and how you grant it

You choose a folder or a file through Chrome's own file picker. The extension
receives a handle to exactly what you picked, and can read it. It cannot see
anything you did not pick.

It **never writes**. Writing a file through the File System Access API requires
`createWritable()`, which does not appear anywhere in this extension's source
or in its built package — a build in which it appears fails the project's CI.

## What is stored, and where

Inside your own Chrome profile, on your machine:

- **IndexedDB** — handles for recent projects, so you can reconnect after a
  restart, and the display name and path shown for them;
- **`localStorage`** — interface preferences: theme, sidebar width, panel
  collapse state.

None of it is transmitted anywhere. Removing the extension, or clearing the
extension's site data in Chrome, removes all of it. Your project files are
never copied into this storage — only the handles Chrome gives out and your UI
preferences.

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

The same checks run on every commit in CI, and a release that fails them is
never published.

## Contact

Open an issue on the project repository.

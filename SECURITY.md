*English · [中文](SECURITY.zh-CN.md)*

# Security Policy

## Reporting a vulnerability

Please report security issues privately through GitHub's
[private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
on this repository (Security → Report a vulnerability), not in a public issue.

There is no bounty.

## What counts as a vulnerability here

This extension has an unusually small attack surface, and two of its properties
are load-bearing. Anything that breaks either of them is a security bug, not a
feature request:

1. **Zero network.** The extension makes no network requests at runtime — no
   telemetry, no update checks, no remote fonts, no CDN, no analytics. Every
   asset is bundled. `manifest.json` declares an empty `permissions` array and
   no `host_permissions`.
2. **Read-only.** The extension never writes to the directory you open. It
   holds read access to your files and creates nothing inside your project,
   not even a marker or cache file.

Concrete examples of reportable issues:

- any code path that can cause an outbound request, including an accidental
  remote `@font-face`, `<img src="https://…">`, or `fetch` reachable from
  rendered file content;
- any write to a `FileSystemFileHandle` / `FileSystemDirectoryHandle` obtained
  from the user's project;
- HTML or script injection through rendered file content (Markdown is rendered
  through DOMPurify; a sanitizer bypass is in scope);
- a way to make the extension read a file outside the directory the user
  explicitly granted.

Reports that the extension *could* be modified to do these things are not
vulnerabilities — the source is public and it can be forked. What matters is
what the shipped build does.

## Verifying the claims yourself

You do not have to trust either promise:

```bash
npm ci && npm run build
node scripts/check-invariants.mjs
```

The script prints the symbols it checks for and fails if any appear in the
built bundle. Read it first — it is short and dependency-free, and the point is
that you do not have to take this file's word for anything.

The build is reproducible from source, and the released zip is the plain
output of `npm run build` — it is not obfuscated or minified beyond what Vite
does by default. In Chrome you can also open DevTools → Network on the viewer
page and confirm it stays empty for the whole session.

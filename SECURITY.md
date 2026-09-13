*English · [中文](SECURITY.zh-CN.md)*

# Security Policy

## Reporting a vulnerability

Please report security issues privately through GitHub's
[private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
on this repository (Security → Report a vulnerability), not in a public issue.

There is no bounty.

## What counts as a vulnerability here

The standard reader has an unusually small attack surface, and two of its properties
are load-bearing. Anything that breaks either of them is a security bug, not a
feature request:

1. **No remote traffic.** No telemetry, no update checks, no remote fonts, no
   CDN, no analytics. Every asset is bundled. The standard build can read local
   `file://` URLs after Chrome grants access, but must not contact HTTP(S)
   servers or remote file hosts, or transmit file contents or paths.
2. **Read-only.** The extension never writes to the directory you open. It
   holds read access to your files and creates nothing inside your project,
   not even a marker or cache file.

The standard build declares `storage` and
`declarativeNetRequestWithHostAccess`, with only `file:///*` host access. Its
only web-accessible resource is `viewer.html`, exposed only to `file:///*`.
Its CSP is `script-src 'self'; object-src 'self'; connect-src 'self' file:`.
There are no content scripts or remote host permissions.

There are two ways to authorize reading. The native picker grants handles to
the selected files or directory. Chrome's **Allow access to file URLs** switch
allows the local URL reader to access local files; the extension's suffix
settings control which top-level navigations it automatically opens. These
settings do not narrow Chrome's underlying file-access grant. Automatic
opening does not supply a parent directory handle or enable Markdown relative
resource resolution. Turning off Chrome's switch revokes URL access; the
native picker remains available.

Concrete examples of reportable issues:

- any code path that can cause an outbound request, including an accidental
  remote `@font-face`, `<img src="https://…">`, or `fetch` reachable from
  rendered file content;
- any write to a `FileSystemFileHandle` / `FileSystemDirectoryHandle` obtained
  from the user's project;
- HTML or script injection through rendered file content (Markdown is rendered
  through DOMPurify; a sanitizer bypass is in scope);
- a way to read outside the user's picker grant without the separate Chrome
  file URL authorization, or to make rendered content trigger arbitrary local
  file reads;
- a local URL reader bypass that accepts HTTP(S), remote file hosts or a
  redirect, or bypasses the 64 MiB automatic-read limit.

Reports that the extension *could* be modified to do these things are not
vulnerabilities — the source is public and it can be forked. What matters is
what the shipped build does.

## Verifying the claims yourself

You do not have to trust either promise:

```bash
npm ci && npm run build
node scripts/check-invariants.mjs
```

The script checks exact permission, web-accessible resource and CSP allowlists
in the built package. It rejects write APIs throughout the package and transfer
APIs outside the single audited `local-file-reader.js` module. A fixed digest
guards that module's contents; negative tests verify rejection of non-local
and invalid addresses. Updating the digest requires reviewing the reader's
behavior. Read these checks before relying on the claims.

The build is reproducible from source, and the released zip is the plain
output of `npm run build` — it is not obfuscated or minified beyond what Vite
does by default. In Chrome you can also open DevTools → Network on the viewer
page: local `file://` reads and bundled extension resources are expected;
outbound HTTP(S) requests are not.

## Optional native terminal boundary

The AI build additionally requests nativeMessaging for com.lectern.agent. Chrome and the companion enforce the exact packaged extension origin. The host uses bounded stdio frames, negotiates protocol 1 and starts at most one PTY per connection after project association. No localhost server is shipped in the native installer.

The reader remains read-only; the selected CLI runs with user permissions and can modify files or contact model services. The standard reader's no-remote-traffic/read-only promises do not apply to that CLI. Host origin bypasses, protocol parsing faults, unintended process execution, cross-project association errors and unsafe installer/update behavior are in scope. Third-party CLI vulnerabilities should also be reported to that project. See the privacy policy for local storage and deletion.

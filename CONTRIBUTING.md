*English · [中文](CONTRIBUTING.zh-CN.md)*

# Contributing

Thanks for looking. Before you spend time on a change, please read the three
invariants below — they are the reason this project exists, and a change that
breaks one of them is out of scope no matter how well it is written.

## The three invariants

**1. No remote traffic.** The standard extension does not contact remote
services or transmit file contents or paths. No telemetry, no update checks,
no remote fonts, no CDN, no analytics, no "anonymous usage statistics".
Everything it needs is in the bundle. Local `file://` reads are allowed only
through the audited URL reader after Chrome grants file URL access.

This is checkable, and the check is part of the deal:

```bash
npm ci && npm run build
node scripts/check-invariants.mjs
```

`scripts/check-invariants.mjs` owns the authoritative list of forbidden symbols
and the exact permission and CSP allowlists. CI runs the same checks. Transfer
APIs are forbidden outside the one audited `local-file-reader.js` module,
whose exact contents are checked against a fixed digest. Changing that module
requires reviewing its behavior and updating the audit, including negative
checks for HTTP(S), remote file hosts and malformed input; updating a digest
alone is not a review.

The standard build may declare only `storage` and
`declarativeNetRequestWithHostAccess`, with `file:///*` host access. Only
`viewer.html` may be web-accessible, only to `file:///*`. Its CSP is
`script-src 'self'; object-src 'self'; connect-src 'self' file:`. Keep URL
validation, redirect rejection and the 64 MiB automatic-read limit at the
reader boundary; rendered content must not trigger arbitrary local reads.
The suffix settings govern top-level file navigation, not Chrome's underlying
access grant. Do not add HTTP(S), directory or subresource takeover.

Note what the check inspects: **the built bundle in `dist/`, not the
repository**. The acceptance harness in `scripts/` legitimately writes files
(it builds synthetic projects in OPFS), and that is not a violation — the
invariant is about what ships, not about what the test rig may do. Making the
repository itself symbol-free would mean changing the thing being tested in
order to make the test pass.

**2. Read-only.** The extension never writes to the directory the user opened.
Writing through the File System Access API requires `createWritable()`, which
appears nowhere under `src/`, and CI fails the build if it reaches the bundle.
Not a lock file, not an index cache, not a `.viewer/` folder — nothing. All
persistent state lives in browser-owned storage (IndexedDB, `localStorage`,
`chrome.storage.local`) inside the user's Chrome profile.

These two are a pair, and the pair is the product. Their enforcement now
includes an explicitly audited local-read exception, not an absence of all
read or transfer API symbols. Keep the code, checks and permission disclosures
consistent whenever that boundary changes.

**3. Decisions belong to the user.** Everything this tool knows about your code
is heuristic — go-to-definition does no type inference or import resolution,
the index is name-based, and coverage varies by language. A heuristic tool that
decides on the user's behalf is wrong silently, and the user never finds out.
So:

- when there are several equally plausible answers (two definitions with the
  same name), show the list — do not rank one and jump;
- when a capability degrades (file too large, language not indexed, index
  incomplete), say so in the UI — never degrade silently;
- when state is lost or a project link breaks, offer the user a way to fix it
  rather than presenting an empty panel.

## How changes are made here

This project is spec-driven. Behavioral changes are proposed and reviewed as
specs before implementation, under `openspec/`:

- `openspec/specs/` — current, approved behavior;
- `openspec/changes/` — in-flight proposals (proposal, design, delta specs, tasks).

For a bug fix or a small, obviously-correct change, just open a pull request.
For anything that changes what the extension *promises the user*, open an issue
first describing the behavior change; the spec is the contract and it gets
updated with the code, not after.

A note on documentation style, applied to specs, README, and UI text alike:
**state boundaries, not IOUs.** "Encodings other than UTF-8 are not decoded" is
a boundary. "UTF-8 only for now, other encodings coming later" is an IOU that
someone has to keep paying. And any list of things we do not cover must say it
is illustrative, not exhaustive — otherwise the absence of a language from the
list reads as a promise that it works.

## Development

```bash
npm ci
npm run build       # type-check + production build into dist/
npm run dev         # watch build
npm run typecheck
```

Load the extension: `chrome://extensions` → enable Developer mode → **Load
unpacked** → select `dist/`. Chrome 122+ is required.

To exercise automatic local opening, enable **Allow access to file URLs** in
the extension's Chrome details, then configure *自动打开* in the viewer toolbar.
Test both authorized and unauthorized states; the native picker must work in
either. Automatic opening must preserve single-file behavior and reread the
file when the tab is refreshed, without obtaining a parent directory handle.

End-to-end acceptance run (real Chrome, real extension, synthetic project in
OPFS):

```bash
node scripts/e2e.mjs
```

It is a long run (several hundred assertions, roughly ten minutes) and it drives
a visible Chrome window. Redirect its output to a file and read the file — piping
it through `grep`/`head` buffers the output and makes a healthy run look hung.

To check file and directory drag-and-drop with real local fixtures and a temporary
production build, run `node scripts/e2e-drop.mjs`.

## Adding language coverage

`docs/language-support.md` describes what each coverage tier means and what a
new language has to supply. Two things are easy to get wrong:

- coverage claims are per-capability (highlighting, outline, go-to-definition,
  references), and a language can legitimately land in different tiers for
  different capabilities — do not collapse them into one label;
- every coverage list must be updated together — the README (both languages),
  `docs/language-support.md` and the spec. `node scripts/check-language-coverage.mjs`
  reconciles all of them against the implementation and fails if any disagrees;
- automatic-opening candidates must come from the preview format table. Keep
  unsupported binaries out, HTML and images unselected by default, and exact
  names such as `Dockerfile` separate from suffix rules;
- a grammar that works on synthetic samples routinely mis-collects on real code.
  Test against a real open-source repository in that language before claiming a
  tier, and say what you tested against.

## Licensing of contributions

By contributing you agree that your contribution is licensed under the
[Apache License 2.0](LICENSE), the same license as the project. There is no CLA.

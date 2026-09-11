*English · [中文](CONTRIBUTING.zh-CN.md)*

# Contributing

Thanks for looking. Before you spend time on a change, please read the three
invariants below — they are the reason this project exists, and a change that
breaks one of them is out of scope no matter how well it is written.

## The three invariants

**1. Zero network.** The extension performs no network activity at runtime.
No telemetry, no update checks, no remote fonts, no CDN, no analytics, no
"anonymous usage statistics". Everything it needs is in the bundle.

This is checkable, and the check is part of the deal:

```bash
npm ci && npm run build
node scripts/check-invariants.mjs
```

`scripts/check-invariants.mjs` owns the authoritative list of forbidden symbols
and is the only place that list exists — CI runs the same script, and no
document restates the symbols. If your change makes it fail, that needs to be
justified in the pull request, and the bar is high.

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
OPFS) inside the user's Chrome profile.

These two are a pair, and the pair is the product. A user who cannot let their
code touch the network is not evaluating a promise not to misbehave; they are
evaluating whether the thing is *capable* of misbehaving. Open one hole in
either invariant and both claims collapse to "trust us".

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
- a grammar that works on synthetic samples routinely mis-collects on real code.
  Test against a real open-source repository in that language before claiming a
  tier, and say what you tested against.

## Licensing of contributions

By contributing you agree that your contribution is licensed under the
[Apache License 2.0](LICENSE), the same license as the project. There is no CLA.

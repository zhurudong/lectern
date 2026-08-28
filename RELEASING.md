*English · [中文](RELEASING.zh-CN.md)*

# Releasing

A release is a git tag. Everything else is done by
[`.github/workflows/release.yml`](.github/workflows/release.yml) — deliberately,
so that the published zip is provably the output of the committed source rather
than of somebody's laptop.

```bash
# 1. package.json, package-lock.json and public/manifest.json must match,
#    docs/releases/<version>.md must exist, and all of it must be committed.
# 2. tag and push
git tag v0.3.1
git push origin v0.3.1
```

The workflow then:

1. builds from a clean checkout (`npm ci && npm run build`);
2. runs `npm run check` — **a build that fails the zero-network, read-only,
   permission or language-coverage gates is never published**;
3. fails unless the tag matches `manifest.json`, `package.json` and the lockfile,
   so a mistagged or partially bumped release cannot ship;
4. produces two archives from that same `dist/`: `lectern-<version>.zip` for
   manual installation and `lectern-<version>-web-store.zip` for the Chrome Web
   Store; each gets its own `.sha256`;
5. publishes all four files with `docs/releases/<version>.md` as the release
   notes.

## Rules

- **No obfuscation, ever.** The release artifact is the plain build output.
  Obfuscating an open-source extension protects nothing, and the Chrome Web
  Store forbids obfuscated code outright.
- **No hand-built artifacts.** If a zip did not come out of the workflow, it
  does not get attached to a release. The whole value of the artifact is that
  anyone can rebuild it from the tagged commit and get the same thing.
- **What is reproducible is the build, not the zip's bytes.** The `.sha256`
  identifies *that* file; it lets someone check that the download was not
  altered in transit. It is not a claim that rebuilding produces a
  byte-identical archive — zip metadata (entry order, timestamps, compression
  parameters) differs between machines. Anyone verifying the artifact should
  rebuild from the tag and compare the *contents*, and the invariant checks are
  there to be run on their own build.
- **Screenshots reproduce at the scene level, not the pixel level.** Re-running
  the capture scripts produces different bytes every time — antialiasing and
  render timing see to that. So *which run* a published image came from is
  meaningful. When a release needs new screenshots, regenerate the whole set in
  one run and commit them together. Swapping a single image into a set captured
  earlier leaves a baseline that is a splice of two runs, and nothing will ever
  flag it. The published images are the twelve under `docs/images/` and
  `assets/chrome-web-store/`; `scripts/*.png` are working images and are not
  published. All twelve come from `scripts/shot-readme.mjs`,
  `scripts/shot-store.mjs` and `scripts/render-store-promos.mjs` — if you add a
  published image, add the script that produces it in the same change, or the
  next restyle will silently ship it stale.
- **Do not edit a published release's assets.** Cut a new patch version.

## Chrome Web Store

The store listing is uploaded manually (it needs a Google account and the
store's own review flow).

1. Download `lectern-<version>-web-store.zip` from the corresponding GitHub
   release. **Do not rebuild or re-zip it locally.**
2. Upload that exact file to the existing store listing. It has
   `manifest.json` at the archive root, which the manual-install archive does
   not.
3. After publication, download the public CRX and compare its extension payload
   with the tagged `dist/`. The store adds `_metadata/` and `update_url` while
   signing the CRX; those additions are expected, application-file differences
   are not.

This split is deliberate: `lectern-<version>.zip` optimizes the manual unzip
experience by wrapping files in `lectern/`, while the store upload requires the
extension files at the archive root. Both remain traceable to the same clean CI
build without pretending the two packaging formats are byte-identical.

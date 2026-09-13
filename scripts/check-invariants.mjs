#!/usr/bin/env node
// Invariant gates for the shipped build. Run after `npm run build`:
//
//     node scripts/check-invariants.mjs
//
// This file is the ONLY place the forbidden-symbol lists exist. README,
// SECURITY, CONTRIBUTING, PRIVACY and the CI workflow all point here and none
// of them restates a symbol — two copies of a list drift, and while they drift
// both of them look green.
//
// It is deliberately short, dependency-free and meant to be read before it is
// trusted: a verification script you must trust before you can verify anything
// is worth nothing. That is a functional requirement of this file, not a
// stylistic preference — keep it that way.
//
// WHAT IS CHECKED: the built bundle in `dist/`, not the repository. The
// acceptance harness under `scripts/` legitimately writes files (it builds
// synthetic projects in OPFS). The invariant is about what ships, not about
// what the test rig may do. Making the repository itself symbol-free would
// mean changing the thing being tested so that the test passes.
//
// If this ever fails on a change you believe is legitimate, see the invariants
// section of CONTRIBUTING.md — the bar for an exception is high.
//
// THIS CHECK HAS BEEN SEEN TO FAIL. A checker that has only ever printed OK is
// indistinguishable from `exit 0`, and it will spend most of its life green —
// the one moment that proves it works is the moment we make it red on purpose.
// Reproduce it by pointing DIST at a copy of the build with violations injected:
//
//     cp -R dist /tmp/neg
//     printf '\nawait fetch("https://example.com");\n'      >> /tmp/neg/background.js
//     printf '\nawait handle.createWritable();\n'           >> /tmp/neg/background.js
//     node -e 'const f=require("fs"),p="/tmp/neg/manifest.json";const m=JSON.parse(f.readFileSync(p));m.permissions=["storage"];f.writeFileSync(p,JSON.stringify(m))'
//     DIST=/tmp/neg node scripts/check-invariants.mjs   # must exit 1 and name each hit

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

// Deliberately NOT imported from scripts/paths.mjs, even though seven other
// scripts share that helper. This file must be readable on its own: a skeptic
// has to be able to decide whether to trust it by reading only this file, and
// an import would force them to read paths.mjs too before they could trust
// ROOT. Zero dependencies is a functional requirement here, not a style
// preference — a verifier you must trust before you can verify it is worthless.
// This is a reasoned exception, not an oversight: please do not "unify" it.
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
// DIST is overridable so the check can be pointed at a copy — used by the
// negative test that proves this script can actually fail (see below).
const DIST = resolve(ROOT, process.env.DIST ?? 'dist')
const AI = process.env.AI_TERMINAL === '1'
const PURE_CSP = "script-src 'self'; object-src 'self'; connect-src 'self' file:"
const AI_CSP = PURE_CSP
// Explicitly audited transport; copied unchanged by Vite. Updating the reader
// requires reviewing the code and the negative controls before changing this pin.
const LOCAL_READER_SHA256 = '0ce9b285704b2570ff4f155bc78b1756021d6c2a00575b322487dfc71cbdec83'

/** Paths outside the repo print in full; inside, they print relative. */
const show = (p) => (p.startsWith(ROOT) ? relative(ROOT, p) : p)

/**
 * Transport references outside the exact local reader (and opt-in native
 * native connection) fail. Filesystem writes are forbidden in every shipped script.
 */
const FORBIDDEN = {
  'zero network': [
    /\bfetch\s*\(/,
    /\bXMLHttpRequest\b/,
    /\bWebSocket\b/, // broader than `new WebSocket`: any reference deserves a look
    /\bEventSource\b/,
    /\bsendBeacon\b/,
    /\bconnectNative\b/,
    /\bsendNativeMessage\b/,
  ],
  'read-only': [/\bcreateWritable\b/, /\bshowSaveFilePicker\b/, /\bremoveEntry\b/],
}

// ---------------------------------------------------------------- reporting

let failed = false

function fail(message) {
  failed = true
  console.error(`FAIL  ${message}`)
}

/** Bundles are minified onto very long lines: a line number alone is useless. */
function locate(text, index) {
  const line = text.slice(0, index).split('\n').length
  const lineStart = text.lastIndexOf('\n', index - 1) + 1
  const column = index - lineStart + 1
  const context = text.slice(Math.max(0, index - 40), index + 40).replace(/\s+/g, ' ')
  return { line, column, context }
}

// ------------------------------------------------------------------- checks

function jsFiles(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...jsFiles(path))
    else if (name.endsWith('.js')) out.push(path)
  }
  return out
}

function checkSymbols() {
  const files = jsFiles(DIST)
  if (files.length === 0) fail(`no .js files under ${show(DIST)} — did the build produce anything?`)

  let transports = 0
  let localReaders = 0
  for (const file of files) {
    let text = readFileSync(file, 'utf8')
    const localReader = relative(DIST, file) === 'local-file-reader.js'
    if (localReader) {
      localReaders++
      if (createHash('sha256').update(text).digest('hex') !== LOCAL_READER_SHA256)
        fail('local-file-reader.js differs from the audited local-only transport')
    }
    if (AI) {
      // Only this exact host is permitted in the opt-in build.
      text = text.replace(/chrome\.runtime\.connectNative\(["']com\.lectern\.agent["']\)/g, () => {
        transports++
        return 'LECTERN_NATIVE_TRANSPORT'
      })
    }
    const exemptReadOnly = resolve(DIST) === resolve(ROOT, 'dist-dev') && /(^|\/)devFixture-[^/]*\.js$/.test(file.replace(/\\/g, '/'))
    for (const [invariant, patterns] of Object.entries(FORBIDDEN)) {
      if (invariant === 'read-only' && exemptReadOnly) continue
      if (localReader && invariant === 'zero network') continue
      for (const pattern of patterns) {
        const match = new RegExp(pattern.source, 'g').exec(text)
        if (!match) continue
        const { line, column, context } = locate(text, match.index)
        fail(
          `${invariant}: found ${JSON.stringify(match[0])} in ` +
            `${show(file)}:${line}:${column}\n      …${context}…`,
        )
      }
    }
  }
  if (AI && transports !== 1) fail(`AI transport: expected exactly one native connection, got ${transports}`)
  if (localReaders !== 1) fail('expected exactly one audited local-file-reader.js')
}

function checkManifest() {
  const path = join(DIST, 'manifest.json')
  if (!existsSync(path)) return fail(`${show(path)} is missing`)

  const manifest = JSON.parse(readFileSync(path, 'utf8'))
  const permissions = manifest.permissions ?? []
  if (JSON.stringify([...permissions].sort()) !== JSON.stringify(['declarativeNetRequestWithHostAccess', 'storage', ...(AI ? ['nativeMessaging'] : [])].sort()))
    fail(`unexpected permissions: ${JSON.stringify(permissions)}`)
  if (JSON.stringify(manifest.host_permissions) !== JSON.stringify(['file:///*']))
    fail('host_permissions must contain only file:///*')
  for (const key of ['content_scripts', 'optional_permissions', 'optional_host_permissions', 'externally_connectable', 'sandbox', 'declarative_net_request']) {
    if (manifest[key] !== undefined) fail(`unexpected manifest capability: ${key}`)
  }
  if (JSON.stringify(manifest.web_accessible_resources) !== JSON.stringify([{ resources: ['viewer.html'], matches: ['file:///*'] }]))
    fail('only viewer.html may be exposed to file URLs')
  if (JSON.stringify(manifest.content_security_policy) !== JSON.stringify({ extension_pages: AI ? AI_CSP : PURE_CSP }))
    fail(`CSP must exactly restrict connections to self/file${AI ? '' : ''}`)
}

/**
 * The read-only exemption for devFixture-*.js (see checkSymbols) is only sound
 * because that chunk never reaches the shipped `dist/` — it is dev-only and
 * tree-shaken out of a production build. Enforce that here: if this run is
 * checking the production `dist/` and a devFixture chunk is present, the tree-shake
 * failed and the exemption would be masking a real write path in what ships.
 */
function checkDevFixtureNotShipped() {
  if (resolve(DIST) === resolve(ROOT, 'dist-dev')) return // 只对发货产物 `dist/` 收紧
  const leaked = jsFiles(DIST).filter((f) => /(^|\/)devFixture-[^/]*\.js$/.test(f.replace(/\\/g, '/')))
  for (const f of leaked)
    fail(`dev fixture leaked into shipped build: ${show(f)} — it must be tree-shaken from prod \`dist/\``)
}

/**
 * A clean but stale `dist/` passes every check while the current source is
 * already dirty — the gate would be reporting on an artifact nobody is about to
 * ship. This cannot fail the run (mtimes are not a build system, and a false
 * red would cost this script the credibility it exists to have), but silence
 * would be worse: it is exactly the shape of "green for a reason unrelated to
 * what you asked".
 *
 * Returns whether the build is stale, because the CONCLUSION line has to carry
 * that qualifier too: the last line is the one people quote, screenshot and
 * pipe through `tail -1`, and a warning printed above it on another stream
 * disappears the moment the streams are separated. A line that needs a second
 * line to be true is a line that will be read alone and believed.
 */
function warnIfStale() {
  const newest = (dir) => {
    let latest = 0
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      const info = statSync(path)
      latest = Math.max(latest, info.isDirectory() ? newest(path) : info.mtimeMs)
    }
    return latest
  }
  const sources = ['src', 'public', 'vite.config.ts', 'package.json']
    .map((p) => join(ROOT, p))
    .filter((p) => existsSync(p))
    .map((p) => (statSync(p).isDirectory() ? newest(p) : statSync(p).mtimeMs))
  if (Math.max(...sources) <= newest(DIST)) return false
  console.warn(
    `WARN  ${show(DIST)} is older than the source it was built from — ` +
      `run \`npm run build\` first, or this checks code nobody is shipping.\n`,
  )
  return true
}

// --------------------------------------------------------------------- main

// Printing the list first is part of the promise the documentation makes:
// "it prints the exact symbols it looks for". Do not remove it as debug noise.
console.log(`Checking ${show(DIST)} (${AI ? 'opt-in AI: one native transport' : 'pure'}) for:`)
for (const [invariant, patterns] of Object.entries(FORBIDDEN)) {
  console.log(`  ${invariant.padEnd(13)} ${patterns.map((p) => p.source).join('  ')}`)
}
console.log('  local reader  exactly one unchanged, SHA-256 pinned local-only reader')
console.log(`  permissions   storage + declarativeNetRequestWithHostAccess${AI ? ' + nativeMessaging' : ''}; only file:///*`)
console.log(`                no content scripts; exact ${AI ? 'self/file' : 'self/file'} CSP`)
console.log()

if (!existsSync(DIST)) {
  console.error(`FAIL  ${show(DIST)} does not exist — run \`npm run build\` first.`)
  process.exit(1)
}

const stale = warnIfStale()
checkSymbols()
checkManifest()
checkDevFixtureNotShipped()

if (failed) {
  console.error(`\nThe build breaks an invariant. See CONTRIBUTING.md, "The three invariants".`)
  process.exit(1)
}

const conclusion = AI
  ? 'audited local reader + exactly one native transport, exact permissions/CSP, no filesystem write symbols'
  : 'audited local reader only, exact local permissions/CSP, no filesystem write symbols'
console.log(stale
  ? `OK*  ${conclusion} — *in a build that predates the current sources; rebuild and re-run before quoting this.`
  : `OK  ${conclusion}.`)

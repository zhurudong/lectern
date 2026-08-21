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

/** Paths outside the repo print in full; inside, they print relative. */
const show = (p) => (p.startsWith(ROOT) ? relative(ROOT, p) : p)

/**
 * A Chrome extension cannot reach the network without one of these, and the
 * File System Access API cannot write a file without `createWritable()`.
 * Their absence is not a promise about behavior — it is the absence of the
 * capability, which is what a static check can actually establish.
 */
const FORBIDDEN = {
  'zero network': [
    /\bfetch\s*\(/,
    /\bXMLHttpRequest\b/,
    /\bWebSocket\b/, // broader than `new WebSocket`: any reference deserves a look
    /\bEventSource\b/,
    /\bsendBeacon\b/,
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

  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    for (const [invariant, patterns] of Object.entries(FORBIDDEN)) {
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
}

function checkManifest() {
  const path = join(DIST, 'manifest.json')
  if (!existsSync(path)) return fail(`${show(path)} is missing`)

  const manifest = JSON.parse(readFileSync(path, 'utf8'))
  const permissions = manifest.permissions ?? []
  if (permissions.length) fail(`zero permissions: manifest declares ${JSON.stringify(permissions)}`)
  if (manifest.host_permissions) fail(`zero permissions: manifest declares host_permissions`)
  if (manifest.content_scripts) fail(`zero permissions: manifest declares content_scripts`)
  if (manifest.content_security_policy)
    fail(`zero permissions: manifest overrides the default content_security_policy`)
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
console.log(`Checking ${show(DIST)} for:`)
for (const [invariant, patterns] of Object.entries(FORBIDDEN)) {
  console.log(`  ${invariant.padEnd(13)} ${patterns.map((p) => p.source).join('  ')}`)
}
console.log(`  permissions   manifest.permissions must be empty; no host_permissions,`)
console.log(`                no content_scripts, no content_security_policy override`)
console.log()

if (!existsSync(DIST)) {
  console.error(`FAIL  ${show(DIST)} does not exist — run \`npm run build\` first.`)
  process.exit(1)
}

const stale = warnIfStale()
checkSymbols()
checkManifest()

if (failed) {
  console.error(`\nThe build breaks an invariant. See CONTRIBUTING.md, "The three invariants".`)
  process.exit(1)
}

console.log(
  stale
    ? 'OK*  no network symbols, no filesystem write symbols, no permissions — ' +
        '*in a build that predates the current sources; rebuild and re-run before quoting this.'
    : 'OK  no network symbols, no filesystem write symbols, no permissions.',
)

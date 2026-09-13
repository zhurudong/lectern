#!/usr/bin/env node
// Reconciles the language coverage lists that exist in four documents against
// the implementation, and against each other:
//
//     node scripts/check-language-coverage.mjs
//
// WHY THIS EXISTS. The coverage list is a promise: one extra language in a
// table is one false promise to a user. It currently lives in four documents
// plus the code, and four hand-maintained copies drift — while they drift, all
// four look right.
//
// WHY IT RECONCILES RATHER THAN GENERATES. Generating the tables from the code
// would make them agree by construction, and that is exactly the problem: this
// project's worst spec defect was found by holding the spec next to an
// independently written coverage document and watching them disagree. A
// generated document can never disagree with the code, so it can never catch a
// code-level mistake — and a contract that is generated from the implementation
// is no longer a contract. Divergence is the signal; do not design it away.
//
// WHICH PAIRINGS CARRY INFORMATION (this matters — some pairs are tautologies):
//   spec        ↔ implementation   independently written; the highest-value pair
//   README (en) ↔ implementation   hand-written outward promise
//   README (zh) ↔ implementation   likewise
//   README (en) ↔ README (zh)      a mismatch means different promises to
//                                  different-language users
//   docs/language-support.md ↔ implementation
//                                  Ruled (change `prep-open-source`, 1d.4): this
//                                  document is HUMAN-MAINTAINED and therefore a
//                                  real check. If it is ever regenerated from
//                                  the code instead, this comparison becomes a
//                                  tautology that always passes while reporting
//                                  a reassuring "OK" — and the document's own
//                                  claim to be "the sole basis for outward
//                                  statements" must be deleted at the same time,
//                                  because a build artifact cannot be a basis:
//                                  a basis has to be able to contradict the
//                                  implementation, and an artifact never does.
//
// This script must FAIL LOUDLY if it cannot parse something. A checker that
// quietly passes when it did not actually check is the failure mode it exists
// to prevent.
//
// THIS CHECK HAS BEEN SEEN TO FAIL — verified against four mutations, each
// reverted afterwards:
//   1. an extra language added to README.md      → caught, and also caught as
//                                                  an en/zh disagreement
//   2. a language deleted from README.zh-CN.md   → same, from the other side
//   3. a language moved to the wrong tier in
//      docs/language-support.md                  → caught
//   4. one language dropped from the spec's
//      dedicated-highlight list                  → the totals equation broke
//                                                  first: "the spec lists 25 …
//                                                  but the tiers add up to 26"
// Mutation 4 is the one worth re-running after any change to this file: the
// equation is the part that a row-by-row diff cannot replace, because an eye
// comparing two lists copies straight past a missing entry, and a total does
// not.

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// Deliberately NOT imported from scripts/paths.mjs, even though seven other
// scripts share that helper. This file must be readable on its own: a skeptic
// has to be able to decide whether to trust it by reading only this file, and
// an import would force them to read paths.mjs too before they could trust
// ROOT. Zero dependencies is a functional requirement here, not a style
// preference — a verifier you must trust before you can verify it is worthless.
// This is a reasoned exception, not an oversight: please do not "unify" it.
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

let failed = false
const fail = (msg) => {
  failed = true
  console.error(`FAIL  ${msg}`)
}

/** Table cells carry qualifiers the lists do not: "JavaScript (incl. JSX)". */
const normalize = (name) =>
  name
    .replace(/[（(].*?[)）]/g, '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .trim()

/**
 * Parentheticals are stripped BEFORE splitting: several of them contain commas
 * of their own ("Svelte(借用 HTML 高亮,模板指令不保证准确)"), and splitting first
 * shreds them into fragments that then look like extra languages.
 */
const split = (cell) =>
  cell
    .replace(/[（(][^)）]*[)）]/g, '')
    .split(/[、,，]/)
    .map((name) => normalize(name).replace(/[。.:：]+$/, '').trim())
    .filter(Boolean)

const set = (names) => new Set(names)

function compare(what, actual, expected) {
  const missing = [...expected].filter((x) => !actual.has(x))
  const extra = [...actual].filter((x) => !expected.has(x))
  if (missing.length) fail(`${what}: missing ${missing.join(', ')}`)
  if (extra.length) fail(`${what}: claims ${extra.join(', ')}, which the implementation does not cover`)
}

// ------------------------------------------------- the implementation's truth

function parseImplementation() {
  const src = read('src/lib/filetypes.ts')

  const block = (name, open, close) => {
    const start = src.indexOf(name)
    if (start < 0) throw new Error(`cannot find ${name} in src/lib/filetypes.ts`)
    const from = src.indexOf(open, start)
    const to = src.indexOf(close, from)
    if (from < 0 || to < 0) throw new Error(`cannot delimit ${name} in src/lib/filetypes.ts`)
    return src.slice(from, to)
  }

  const ids = (text) => [...text.matchAll(/'([a-z#+]+)'/g)].map((m) => m[1])

  const codeExt = block('const CODE_EXT', '{', '\n}')
  const wholeName = block('const WHOLE_NAME', '{', '\n}')
  const labels = block('const LANG_LABEL', '{', '\n}')

  const languagesInUse = new Set([
    ...[...codeExt.matchAll(/:\s*'([a-z#+]+)'/g)].map((m) => m[1]),
    ...[...wholeName.matchAll(/language:\s*'([a-z#+]+)'/g)].map((m) => m[1]),
    'markdown', // identified by extension in identifyByName, not through a table
  ])
  languagesInUse.delete('xml') // re-added below; .svg maps to it only as a fallback
  languagesInUse.add('xml')

  const full = new Set(ids(block('const INTEL_FULL', '([', '])')))
  const outline = new Set(ids(block('const INTEL_OUTLINE_ONLY', '([', '])')))
  const approximate = new Set(ids(block('const APPROXIMATE', '([', '])')))

  const label = new Map(
    [...labels.matchAll(/([a-z#+]+):\s*'([^']+)'/g)].map((m) => [m[1], m[2]]),
  )
  for (const id of languagesInUse) {
    if (!label.has(id)) throw new Error(`language id '${id}' has no LANG_LABEL entry`)
  }

  // JSX/TSX are separate parser ids but are not separate languages to a reader.
  const dialects = { jsx: 'javascript', tsx: 'typescript' }
  const display = (id) => label.get(dialects[id] ?? id)

  const navigable = set([...full].map(display))
  const outlineOnly = set([...outline].map(display))
  const highlightOnly = set(
    [...languagesInUse]
      .filter((id) => !full.has(id) && !approximate.has(id) && !outline.has(id))
      .map(display),
  )
  const approximateNames = set([...approximate].map(display))

  // Every tier, not just the big ones. A tier of 1 (outline-only) or 2
  // (approximate) is exactly the size a brittle regex loses whole, and once a
  // tier parses to nothing, "the code covers nothing here" and "the documents
  // list nothing here" produce the same empty set difference — the check goes
  // green for the reason it exists to catch. The claim in the message below
  // needs to hold more strongly for a tier of one than for a tier of eighteen.
  const tiers = { navigable, outlineOnly, highlightOnly, approximate: approximateNames }
  for (const [tier, names] of Object.entries(tiers)) {
    if (names.size === 0) {
      throw new Error(`the ${tier} tier parsed empty — the parser is broken, not the docs`)
    }
  }
  return tiers
}

// ------------------------------------------------------------ document tables

/** Reads a four-tier table keyed by the label in its first column. */
function parseTierTable(path, keys) {
  const text = read(path)
  const out = {}
  for (const [tier, key] of Object.entries(keys)) {
    const row = text.split('\n').find((line) => line.includes(key) && line.startsWith('|'))
    if (!row) throw new Error(`cannot find the "${key}" row in ${path}`)
    const cells = row.split('|').filter((c) => c.trim())
    out[tier] = set(split(cells[cells.length - 1]))
  }
  return out
}

/** docs/language-support.md keeps one table per tier, language in column one. */
function parseCoverageDoc() {
  const text = read('docs/language-support.md')
  const section = (heading, next) => {
    const from = text.indexOf(heading)
    const to = next ? text.indexOf(next) : text.length
    if (from < 0 || to < 0) throw new Error(`cannot find section "${heading}" in docs/language-support.md`)
    const rows = text.slice(from, to).split('\n').filter((l) => l.startsWith('|'))
    return set(
      rows
        .slice(2) // header + separator
        .map((r) => normalize(r.split('|')[1] ?? ''))
        .filter((n) => n && n !== '语言'),
    )
  }
  return {
    navigable: section('## 1. 可跳转', '## 2. 仅大纲'),
    outlineOnly: section('## 2. 仅大纲', '## 3. 仅高亮'),
    highlightOnly: section('## 3. 仅高亮', '## 4. 近似高亮'),
    approximate: section('## 4. 近似高亮', '## 5. 其他处理'),
  }
}

/** The spec splits by highlighting quality, not by code intelligence. */
function parseSpec() {
  const text = read('openspec/specs/file-preview/spec.md')
  const line = (marker) => {
    const found = text.split('\n').find((l) => l.trim().startsWith(`- **${marker}`))
    if (!found) throw new Error(`cannot find the "${marker}" bullet in the file-preview spec`)
    // The bullet reads `- **专用高亮**:A、B、C。` or
    // `- **近似高亮**(qualifier):A、B(qualifier)。` — drop the qualifiers first,
    // then read the list up to the first sentence-ending full stop. A following
    // explanatory sentence may mention languages and contain its own commas.
    const body = found.replace(/[（(][^)）]*[)）]/g, '')
    const colon = body.search(/[:：]/)
    if (colon < 0) throw new Error(`the "${marker}" bullet has no list separator`)
    const names = split(body.slice(colon + 1).split('。', 1)[0])
    if (names.length === 0) throw new Error(`the "${marker}" bullet parsed to an empty list`)
    return set(names)
  }
  return { dedicated: line('专用高亮'), approximate: line('近似高亮') }
}

// --------------------------------------------------------------------- checks

let impl
try {
  impl = parseImplementation()
} catch (err) {
  console.error(`FAIL  cannot read the implementation: ${err.message}`)
  process.exit(1)
}

console.log('Implementation (src/lib/filetypes.ts):')
for (const [tier, names] of Object.entries(impl)) {
  console.log(`  ${tier.padEnd(14)} ${names.size.toString().padStart(2)}  ${[...names].join(', ')}`)
}
console.log()

try {
  const en = parseTierTable('README.md', {
    navigable: '**Navigable**',
    outlineOnly: '**Outline only**',
    highlightOnly: '**Highlight only**',
    approximate: '**Approximate highlight**',
  })
  const zh = parseTierTable('README.zh-CN.md', {
    navigable: '**可跳转**',
    outlineOnly: '**仅大纲**',
    highlightOnly: '**仅高亮**',
    approximate: '**近似高亮**',
  })
  const doc = parseCoverageDoc()
  const spec = parseSpec()

  for (const tier of Object.keys(impl)) {
    compare(`README.md / ${tier}`, en[tier], impl[tier])
    compare(`README.zh-CN.md / ${tier}`, zh[tier], impl[tier])
    compare(`docs/language-support.md / ${tier}`, doc[tier], impl[tier])
    const zhExtra = [...zh[tier]].filter((x) => !en[tier].has(x))
    const enExtra = [...en[tier]].filter((x) => !zh[tier].has(x))
    if (zhExtra.length || enExtra.length) {
      fail(
        `README.md and README.zh-CN.md disagree on ${tier} ` +
          `(en only: ${enExtra.join(', ') || '—'}; zh only: ${zhExtra.join(', ') || '—'}) — ` +
          `that is two different promises to two audiences`,
      )
    }
  }

  // The spec cuts the same set along a different axis: highlighting quality
  // rather than code intelligence. Two documents sliced differently that still
  // add up to the same total is a genuine cross-check — drop one language from
  // either side and the equation stops holding. It is also harder to fool than
  // a row-by-row diff, which the eye happily copies straight past.
  const dedicated = impl.navigable.size + impl.outlineOnly.size + impl.highlightOnly.size
  if (spec.dedicated.size !== dedicated) {
    fail(
      `the spec lists ${spec.dedicated.size} dedicated-highlight languages, ` +
        `but the tiers add up to ${dedicated} ` +
        `(${impl.navigable.size} navigable + ${impl.outlineOnly.size} outline-only + ${impl.highlightOnly.size} highlight-only)`,
    )
  }
  compare('file-preview spec / dedicated highlight', spec.dedicated, new Set([
    ...impl.navigable, ...impl.outlineOnly, ...impl.highlightOnly,
  ]))
  compare('file-preview spec / approximate highlight', spec.approximate, impl.approximate)
} catch (err) {
  console.error(`FAIL  cannot read a coverage list: ${err.message}`)
  process.exit(1)
}

if (failed) {
  console.error(
    `\nA coverage list disagrees with the implementation. Fix the list, or fix the code —` +
      `\nbut do not "fix" the check. See CONTRIBUTING.md, "Adding language coverage".`,
  )
  process.exit(1)
}

console.log('OK  every coverage list agrees with the implementation and with the others.')

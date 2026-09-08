#!/usr/bin/env node
// Internal session-role vocabulary must not appear in published files.
//
//     node scripts/check-role-vocabulary.mjs
//
// This project was built by several AI sessions with different roles. That is
// documented on purpose in HOW_THIS_WAS_BUILT, but the private vocabulary of
// those sessions does not belong in specs, docs or code comments, which are
// read as the project speaking to its users.
//
// WHY THIS IS A SCRIPT AND NOT A `git grep` IN ci.yml — it used to be one, and
// the shell version was broken in both directions at once:
//
//   * `git grep -E "\bPM\b"` matches nothing at all on macOS, because git's
//     regex engine there does not implement `\b`. The gate was dead on every
//     contributor's machine while looking green, so nobody could have caught
//     the next problem locally:
//   * on Linux the same pattern matched *inside tracked PNGs* — a screenshot
//     whose bytes happen to contain "+PM/" — and `git grep` reports
//     "Binary file … matches". The published release commit failed CI for that
//     reason, with zero actual violations in any text file.
//
// A gate whose verdict depends on which machine runs it is worse than no gate:
// it produces a green nobody earned and a red nobody can reproduce. Node's
// regex engine behaves identically on both platforms, so the answer here is
// the same answer everywhere.
//
// THIS CHECK HAS BEEN SEEN TO FAIL — and it proves that to you on every run.
// selfTest() below feeds the matcher a string that must match and two that
// must not, and refuses to report on the repository if the matcher is not
// behaving. That is the specific defect that shipped: a matcher that silently
// stopped matching. It cannot recur silently now.

import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/**
 * `(?:^|[^A-Za-z])PM(?![A-Za-z])` rather than `\bPM\b`: the ASCII-only word
 * boundary is what made the shell version unportable, and being explicit about
 * the boundary costs one line and removes an entire class of surprise.
 * The Chinese terms need no boundary — they cannot occur inside another word.
 */
const FORBIDDEN = [
  /开源会话/,
  /方案会话/,
  /开发会话/,
  /评审会话/,
  /review 会话/,
  /方案探索会话/,
  /(?:^|[^A-Za-z])PM(?![A-Za-z])/,
]

// Two exclusions, both deliberate — a gate that flagged them would push the
// next person into "cleaning up" things we decided twice not to touch:
//   openspec/changes/archive/**  historical records; editing one after the fact
//                                would make it a fabricated record
//   HOW_THIS_WAS_BUILT*          its subject IS the multi-session process, so
//                                that vocabulary is its legitimate topic
//   this file                    it has to name the words to forbid them;
//                                a rule cannot be its own violation
const EXCLUDED = [
  /^openspec\/changes\/archive\//,
  /^HOW_THIS_WAS_BUILT/,
  /^scripts\/check-role-vocabulary\.mjs$/,
]

/**
 * Tracked binary files are skipped. This is not a convenience: a PNG is not a
 * published *file* in the sense this rule is about — nobody reads a screenshot
 * for its vocabulary — and its bytes are effectively random, so including it
 * makes the gate a lottery that a new screenshot can lose. Detected by content
 * (a NUL byte in the first 8 KiB), not by extension, so a binary with an
 * unexpected suffix is still skipped rather than silently mis-scanned.
 */
const isBinary = (buf) => buf.subarray(0, 8192).includes(0)

/**
 * Proves the matcher still matches before any conclusion is drawn about the
 * repository. A checker that has only ever printed OK is indistinguishable
 * from `exit 0`.
 */
function selfTest() {
  const must = ['PM 裁定', '方案会话', 'sha512+PM/abc']
  const mustNot = ['SPM', 'PMX', 'upstream', 'compare']
  const hit = (s) => FORBIDDEN.some((p) => p.test(s))

  for (const s of must) {
    if (!hit(s)) {
      console.error(`FAIL  self-test: ${JSON.stringify(s)} should match and did not.`)
      console.error(`      The matcher is broken; this run says nothing about the repository.`)
      process.exit(1)
    }
  }
  for (const s of mustNot) {
    if (hit(s)) {
      console.error(`FAIL  self-test: ${JSON.stringify(s)} should NOT match and did.`)
      console.error(`      The matcher is too broad; this run says nothing about the repository.`)
      process.exit(1)
    }
  }
}

// Include new, non-ignored files so local checks catch violations before staging.
const files = [...new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 })
  .toString('utf8')
  .split('\0')
  .filter(Boolean))]
  .filter((f) => !EXCLUDED.some((p) => p.test(f)))

console.log('Checking repository text files for internal session-role vocabulary:')
console.log(`  ${FORBIDDEN.map((p) => p.source).join('  ')}`)
console.log(`  excluded: ${EXCLUDED.map((p) => p.source).join('  ')}\n`)

selfTest()

let failed = false
let scanned = 0
let skipped = 0

for (const file of files) {
  let buf
  try {
    buf = readFileSync(`${ROOT}/${file}`)
  } catch {
    continue // a tracked file that is not on disk (sparse checkout, broken link)
  }
  if (isBinary(buf)) {
    skipped++
    continue
  }
  scanned++
  const lines = buf.toString('utf8').split('\n')
  for (const [i, line] of lines.entries()) {
    for (const pattern of FORBIDDEN) {
      const match = pattern.exec(line)
      if (!match) continue
      failed = true
      console.error(`FAIL  ${file}:${i + 1}: ${JSON.stringify(match[0].trim())}\n      ${line.trim().slice(0, 120)}`)
    }
  }
}

if (failed) {
  console.error(
    `\nInternal session-role vocabulary in a published file — use the neutral ` +
      `function names (product / spec / implementation / review).`,
  )
  process.exit(1)
}

console.log(`OK  ${scanned} text files scanned, ${skipped} binary files skipped, no internal role vocabulary.`)

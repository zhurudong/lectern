#!/usr/bin/env node
// Repository gates shared by local checks, CI and Release through npm run check.
// Keep these rules here rather than duplicating shell/regex behavior in workflows.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { lstatSync, readFileSync, readlinkSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

// Windows paths may use forward slashes or escaped backslashes in source files.
// Git emits repository paths with forward slashes on every platform.
const MACHINE_LOCAL_PATH = /\/(?:Users|home)\/[A-Za-z][A-Za-z0-9_-]*|[A-Za-z]:[\\/]+Users[\\/]+/
const PATH_EXCLUDED = new Set([
  'package-lock.json',
  'THIRD-PARTY-NOTICES.md',
  'scripts/check-repository.mjs', // Must contain examples to verify its matcher.
])
const KEY_MUTATION = 'Mod-Alt-Enter'

// A gate must prove it can reject violations on every supported Node platform.
for (const value of ['/Users/alice/project', '/home/runner/work', String.raw`C:\Users\alice`, String.raw`C:\\Users\\alice`, 'D:/Users/alice']) {
  assert.ok(MACHINE_LOCAL_PATH.test(value), `Machine-local path was missed: ${value}`)
}
for (const value of ['src/home.ts', '/usr/local/bin', 'process.env.HOME', '/Users/<username>/project']) {
  assert.ok(!MACHINE_LOCAL_PATH.test(value), `Portable path was rejected: ${value}`)
}

// Include new, non-ignored files so running the gate before git add gives the
// same verdict as CI. Read working-tree contents, including unstaged edits.
const files = [...new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
  cwd: ROOT,
  maxBuffer: 64 * 1024 * 1024,
}).toString('utf8').split('\0').filter(Boolean))]

let failed = false
let pathFailed = false
let mutationFailed = false

function fail(message) {
  failed = true
  console.error(`FAIL  ${message}`)
}

for (const file of files) {
  let content
  try {
    const path = join(ROOT, file)
    const stat = lstatSync(path)
    // Scan a symlink's stored target, never external files it happens to point to.
    if (stat.isSymbolicLink()) content = readlinkSync(path)
    else if (stat.isFile()) content = readFileSync(path, 'utf8')
    else continue // Git submodule directories are not files in this repository.
  } catch (error) {
    if (error.code === 'ENOENT') continue // An unstaged deletion or sparse checkout.
    fail(`${file}: could not read file: ${error.message}`)
    continue
  }

  // Preserve the original path gate's binary-file coverage: embedded absolute
  // paths can disclose a machine directory even when the file is not text.
  for (const [index, line] of content.split('\n').entries()) {
    if (!PATH_EXCLUDED.has(file) && MACHINE_LOCAL_PATH.test(line)) {
      pathFailed = true
      fail(`${file}:${index + 1}: machine-local path — derive it instead (see scripts/e2e.mjs).`)
    }
    // The keybinding test injects this token under scripts/; only src/ ships it.
    if (file.startsWith('src/') && line.includes(KEY_MUTATION)) {
      mutationFailed = true
      fail(`${file}:${index + 1}: leftover key mutation — restore the intended keybinding.`)
    }
  }
}

if (!pathFailed) console.log('OK  no machine-local paths in repository files.')
if (!mutationFailed) console.log('OK  no leftover key mutation in src/.')

// Catch missing notes when the version changes, before a release tag is pushed.
const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const notes = `docs/releases/${version}.md`
try {
  if (statSync(join(ROOT, notes)).isFile()) console.log(`OK  ${notes} exists.`)
  else fail(`${notes} is not a file — Release cannot publish v${version}.`)
} catch (error) {
  if (error.code === 'ENOENT') fail(`${notes} is missing — Release cannot publish v${version}.`)
  else fail(`${notes}: could not inspect release notes: ${error.message}`)
}

if (failed) process.exitCode = 1

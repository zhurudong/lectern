import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const SPEC = 'openspec/specs/file-preview/spec.md'
const FIXTURES = [
  'scripts/check-language-coverage.mjs',
  'src/lib/filetypes.ts',
  'README.md',
  'README.zh-CN.md',
  'docs/language-support.md',
  SPEC,
]

// Exercise the real CLI and its independently maintained documents. Mutations
// stay in disposable fixtures; checks must never rewrite the working tree.
function check(t, editBullet) {
  const root = mkdtempSync(join(tmpdir(), 'lectern-coverage-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const file of FIXTURES) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    copyFileSync(join(ROOT, file), join(root, file))
  }
  const spec = readFileSync(join(root, SPEC), 'utf8')
  assert.match(spec, /^- \*\*专用高亮\*\*:/m)
  writeFileSync(join(root, SPEC), spec.replace(/^- \*\*专用高亮\*\*:[^\n]*/m, editBullet))
  const result = spawnSync(process.execPath, [join(root, FIXTURES[0])], { encoding: 'utf8' })
  assert.ifError(result.error)
  return { status: result.status, output: result.stdout + result.stderr }
}

test('explanatory prose after the list is not counted as languages', (t) => {
  const result = check(t, (line) => `${line.split('。')[0]}。其中 Rust、PHP 使用专用语法,而非近似高亮。`)
  assert.equal(result.status, 0, result.output)
})

test('a language list without trailing prose remains valid', (t) => {
  const result = check(t, (line) => `${line.split('。')[0]}。`)
  assert.equal(result.status, 0, result.output)
})

test('a missing language still fails even if mentioned in the explanation', (t) => {
  const result = check(t, (line) => `${line.split('。')[0].replace('、CMake', '')}。说明中提到 CMake。`)
  assert.equal(result.status, 1, result.output)
  assert.match(result.output, /dedicated highlight: missing CMake/)
})

test('an unsupported language in the list still fails', (t) => {
  const result = check(t, (line) => `${line.split('。')[0]}、ImaginaryLanguage。`)
  assert.equal(result.status, 1, result.output)
  assert.match(result.output, /dedicated highlight: claims ImaginaryLanguage/)
})

test('an empty language list fails instead of accepting its explanation', (t) => {
  const result = check(t, () => '- **专用高亮**:。说明中提到 Rust、PHP。')
  assert.equal(result.status, 1, result.output)
  assert.match(result.output, /bullet parsed to an empty list/)
})

import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const temp = mkdtempSync(join(tmpdir(), 'lectern-i18n-'))
try {
  const outfile = join(temp, 'messages.mjs')
  await build({ entryPoints: ['src/i18n/messages.ts'], outfile, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' })
  const { messages } = await import(outfile)
  assert.deepEqual(Object.keys(messages.en).sort(), Object.keys(messages.zh).sort())
  for (const [key, value] of Object.entries(messages.en)) {
    const params = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    assert.deepEqual(params(value), params(messages.zh[key]), `Placeholder mismatch: ${key}`)
    assert.ok(value.trim(), `Empty translation: ${key}`)
    assert.ok(!/[\u4e00-\u9fff]/.test(value), `Chinese leaked into English: ${key}`)
  }
  console.log(`PASS ${Object.keys(messages.en).length} paired UI messages and interpolation placeholders`)
} finally { rmSync(temp, { recursive: true, force: true }) }

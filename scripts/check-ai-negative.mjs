import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, rmSync, appendFileSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { PROJECT } from './paths.mjs'
const temp = mkdtempSync(join(tmpdir(), 'lectern-ai-gates-'))
const gate = (dir, ai) => spawnSync(process.execPath, ['scripts/check-invariants.mjs'], {
  cwd: PROJECT, env: { ...process.env, DIST: dir, AI_TERMINAL: ai ? '1' : '0' }, encoding: 'utf8',
})
try {
  assert.equal(gate('dist', false).status, 0, 'Build pure dist first')
  assert.equal(gate('dist-ai', true).status, 0, 'Build AI dist first')
  for (const [name, ai, mutate] of [
    ['pure socket', false, (dir) => appendFileSync(join(dir, 'background.js'), '\nnew WebSocket("ws://127.0.0.1:8137")')],
    ['AI extra socket', true, (dir) => appendFileSync(join(dir, 'background.js'), '\nnew WebSocket(`ws://127.0.0.1:${s.port}`)')],
    ['pure native', false, (dir) => appendFileSync(join(dir, 'background.js'), '\nchrome.runtime.connectNative("com.lectern.agent")')],
    ['AI extra native', true, (dir) => appendFileSync(join(dir, 'background.js'), '\nchrome.runtime.connectNative("com.lectern.agent")')],
    ['AI cloud fetch', true, (dir) => appendFileSync(join(dir, 'background.js'), '\nfetch("https://example.com")')],
    ['AI wrong native host', true, (dir) => {
      for (const file of readdirSync(join(dir, 'assets')).filter((f) => f.endsWith('.js'))) {
        const path = join(dir, 'assets', file)
        writeFileSync(path, readFileSync(path, 'utf8').replaceAll('com.lectern.agent', 'com.other.agent'))
      }
    }],
    ['AI wide CSP', true, (dir) => {
      const path = join(dir, 'manifest.json'), m = JSON.parse(readFileSync(path))
      m.content_security_policy.extension_pages += ' https:'
      writeFileSync(path, JSON.stringify(m))
    }],
    ['pure AI artifact', false, () => {}],
  ]) {
    const dir = join(temp, name)
    cpSync(join(PROJECT, ai || name === 'pure AI artifact' ? 'dist-ai' : 'dist'), dir, { recursive: true })
    mutate(dir)
    assert.equal(gate(dir, ai).status, 1, `${name} must fail`)
    console.log(`PASS negative control: ${name}`)
  }
} finally { rmSync(temp, { recursive: true, force: true }) }

import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { PROJECT } from './paths.mjs'
import { readLocalFile } from '../public/local-file-reader.js'

const bundle = await build({
  stdin: {
    contents: 'export * from "./src/local-files/config"; export * from "./src/local-files/rules";',
    resolveDir: PROJECT,
  }, bundle: true, write: false, format: 'esm', platform: 'node',
})
globalThis.chrome = { declarativeNetRequest: { RuleActionType: { REDIRECT: 'redirect', ALLOW: 'allow' }, ResourceType: { MAIN_FRAME: 'main_frame' }, isRegexSupported: async () => ({ isSupported: true }) } }
const { DEFAULT_CONFIG, FILE_EXTENSION_OPTIONS, normalizeConfig, takeoverRules } =
  await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)
const rules = await takeoverRules(DEFAULT_CONFIG, 'chrome-extension://test/viewer.html')
const matches = (url) => rules.filter((rule) => new RegExp(rule.condition.regexFilter, rule.condition.isUrlFilterCaseSensitive ? '' : 'i').test(url))
  .sort((a, b) => b.priority - a.priority)[0]?.action.type === 'redirect'
for (const url of ['file:///tmp/readme.md', 'file:///tmp/Main.JAVA?x=y#L5', 'file:///tmp/a%20%26%23%25.sql', 'file:///tmp/a.%6d%64', 'file:///tmp/a.%4D%44', 'file:///tmp/a%2emd']) {
  assert.ok(matches(url), url)
}
for (const url of ['https://example.com/a.md', 'file://server/share/a.md', 'file:////server/a.md', 'file:///tmp/a.md/', 'file:///tmp/a.md/file', 'file:///tmp/a.exe?x=a.md', 'file:///tmp/page.html', 'file:///tmp/a.png', 'file:///tmp/.md']) {
  assert.ok(!matches(url), url)
}
assert.deepEqual(await takeoverRules({ enabled: false, extensions: ['md'] }, ''), [])
assert.deepEqual(await takeoverRules({ enabled: true, extensions: [] }, ''), [])
assert.deepEqual(normalizeConfig({ enabled: false, extensions: ['.SQL', 'sql', 'exe', null, 'md|.*'] }), { enabled: false, extensions: ['sql'] })
assert.ok(FILE_EXTENSION_OPTIONS.some((option) => option.extension === 'png'))
assert.ok(!FILE_EXTENSION_OPTIONS.some((option) => option.extension === 'pdf'))
assert.ok(rules.every((rule) => JSON.stringify(rule.condition.resourceTypes) === '["main_frame"]'))
console.log('PASS local suffix rules: encoded names, boundaries, defaults and configuration')

const originalFetch = globalThis.fetch
let requests = 0
try {
  globalThis.fetch = async () => { requests++; throw new Error('unexpected transport') }
  for (const url of ['https://example.com/a.md', 'http://127.0.0.1/a.sql', 'file://server/share/a.md', 'file:////server/a.md', 'file:///tmp/', 'file:///tmp/%zz.md', 'file:///tmp/a%2f.md', 'not a URL', 'data:text/plain,test']) {
    await assert.rejects(readLocalFile(url), undefined, url)
  }
  assert.equal(requests, 0, 'invalid sources must be rejected before transport')
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'file:///tmp/a%20%23.md')
    assert.equal(options.cache, 'no-store')
    assert.equal(options.redirect, 'manual')
    return new Response('# Content\n', { headers: { 'content-type': 'text/markdown' } })
  }
  const file = await readLocalFile('file:///tmp/a%20%23.md?download=1#heading')
  assert.equal(file.name, 'a #.md')
  assert.equal(await file.text(), '# Content\n')
  globalThis.fetch = async () => ({ status: 0, type: 'basic', body: null })
  assert.deepEqual(await readLocalFile('file:///tmp/folder.md?x=1#anchor'), { directoryUrl: 'file:///tmp/folder.md/' })
  let cancelled = false
  globalThis.fetch = async () => new Response(new ReadableStream({ cancel() { cancelled = true } }), { headers: { 'content-length': String(65 * 1024 * 1024) } })
  await assert.rejects(readLocalFile('file:///tmp/large.md'), /64 MiB/)
  assert.ok(cancelled, 'oversized body is cancelled without reading')
  let chunks = 0
  globalThis.fetch = async () => new Response(new ReadableStream({
    pull(controller) { chunks++; controller.enqueue(new Uint8Array(1024 * 1024)) },
    cancel() { cancelled = true },
  }))
  cancelled = false
  await assert.rejects(readLocalFile('file:///tmp/no-length.md'), /64 MiB/)
  assert.ok(cancelled && chunks <= 66, 'unknown-size stream is bounded')
} finally { globalThis.fetch = originalFetch; delete globalThis.chrome }
console.log('PASS local reader: zero transport on invalid URLs, cache/redirect guard and bounded reads')

const temporary = mkdtempSync(join(tmpdir(), 'lectern-local-gates-'))
const gate = (dir) => spawnSync(process.execPath, ['scripts/check-invariants.mjs'], {
  cwd: PROJECT, env: { ...process.env, DIST: dir, AI_TERMINAL: '0' }, encoding: 'utf8',
})
try {
  const original = gate('dist')
  assert.equal(original.status, 0, original.stdout + original.stderr)
  for (const [name, mutate] of [
    ['new fetch', (dir) => appendFileSync(join(dir, 'background.js'), '\nfetch("https://example.com")')],
    ['changed local reader', (dir) => appendFileSync(join(dir, 'local-file-reader.js'), '\n// changed')],
    ['local reader removed', (dir) => rmSync(join(dir, 'local-file-reader.js'))],
    ['broad host', (dir) => {
      const path = join(dir, 'manifest.json'), m = JSON.parse(readFileSync(path))
      m.host_permissions.push('https://*/*'); writeFileSync(path, JSON.stringify(m))
    }],
    ['extra permission', (dir) => {
      const path = join(dir, 'manifest.json'), m = JSON.parse(readFileSync(path))
      m.permissions.push('tabs'); writeFileSync(path, JSON.stringify(m))
    }],
    ['wide CSP', (dir) => {
      const path = join(dir, 'manifest.json'), m = JSON.parse(readFileSync(path))
      m.content_security_policy.extension_pages += ' https:'; writeFileSync(path, JSON.stringify(m))
    }],
  ]) {
    const dir = join(temporary, name)
    cpSync(join(PROJECT, 'dist'), dir, { recursive: true })
    mutate(dir)
    assert.equal(gate(dir).status, 1, `${name} must fail`)
    console.log(`PASS negative control: ${name}`)
  }
} finally { rmSync(temporary, { recursive: true, force: true }) }

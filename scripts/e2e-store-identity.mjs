// Real Chrome -> unchanged packaged native host. No installer or model request.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import puppeteer from 'puppeteer-core'
import { PROJECT, resolveChrome } from './paths.mjs'
import { verifyArtifact } from './native/verify-artifact.mjs'

const cfg = JSON.parse(readFileSync(join(PROJECT, 'docs/store-release/release-config.json')))
const output = join(PROJECT, 'release-artifacts', `store-test-${cfg.candidateVersion}`)
const extension = join(output, 'extension')
const selected = cfg.companionPackages.find(p => p.arch === process.arch)
assert.ok(selected, `No companion for this machine: ${process.arch}`)
const metadata = verifyArtifact(join(PROJECT, selected.path), {
  extensionId: cfg.observedStoreId, distribution: cfg.companionDistribution, arch: process.arch,
})
const digest = file => createHash('sha256').update(readFileSync(file)).digest('hex')
const pureManifest = join(PROJECT, 'dist/manifest.json'), aiManifest = join(PROJECT, 'dist-ai/manifest.json')
const before = [digest(pureManifest), digest(aiManifest)]
const manifest = JSON.parse(readFileSync(join(extension, 'manifest.json')))
const { key, ...withoutKey } = manifest
assert.ok(key)
assert.deepEqual(withoutKey, JSON.parse(readFileSync(aiManifest)))
const temp = mkdtempSync(join(tmpdir(), 'lectern-store-identity-'))
let browser
try {
  const expanded = join(temp, 'package')
  execFileSync('/usr/sbin/pkgutil', ['--expand-full', join(PROJECT, selected.path), expanded])
  const files = []
  const walk = dir => { for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name); if (ent.isDirectory()) walk(p); else files.push(p)
  } }
  walk(expanded)
  const findOne = suffix => {
    const found = files.filter(p => p.endsWith(suffix)); assert.equal(found.length, 1, suffix); return found[0]
  }
  const launcher = findOne('/Contents/MacOS/lectern-agent')
  const host = JSON.parse(readFileSync(findOne('/NativeMessagingHosts/com.lectern.agent.json')))
  assert.deepEqual(host.allowed_origins, [`chrome-extension://${cfg.observedStoreId}/`])
  // Only relocate the Chrome registration into this disposable profile. The
  // packaged host, its independent allowlist and its bundled runtime stay intact.
  const profile = join(temp, 'chrome'), hosts = join(profile, 'NativeMessagingHosts')
  mkdirSync(hosts, { recursive: true })
  writeFileSync(join(hosts, 'com.lectern.agent.json'), JSON.stringify({ ...host, path: launcher }))
  browser = await puppeteer.launch({ executablePath: resolveChrome(), userDataDir: profile,
    headless: false, pipe: true, enableExtensions: true,
    args: ['--no-first-run', '--no-default-browser-check'],
    defaultViewport: { width: 1400, height: 900 } })
  const id = await browser.installExtension(extension)
  assert.equal(id, cfg.observedStoreId)
  console.log(`PASS Chrome loaded public-key test build with store ID ${id}`)
  const page = await browser.newPage()
  await page.goto(`chrome-extension://${id}/viewer.html`)
  await page.waitForSelector('.ai-toggle')
  // Send only hello: no project binding, picker, PTY, CLI or model invocation.
  const hello = page => page.evaluate(() => new Promise(resolve => {
    const port = chrome.runtime.connectNative('com.lectern.agent')
    let done = false
    const finish = result => { if (done) return; done = true; clearTimeout(timer); port.disconnect(); resolve(result) }
    const timer = setTimeout(() => finish({ error: 'Native handshake timed out' }), 10000)
    port.onMessage.addListener(message => finish({ message }))
    port.onDisconnect.addListener(() => { const error = chrome.runtime.lastError?.message; finish({ error: error ?? 'Disconnected without a message' }) })
    port.postMessage({ type: 'hello', protocol: 1 })
  }))
  const accepted = await hello(page)
  assert.equal(accepted.error, undefined, accepted.error)
  assert.equal(accepted.message.type, 'hello')
  assert.equal(accepted.message.protocol, 1)
  assert.equal(accepted.message.version, cfg.companionVersion)
  assert.equal(accepted.message.arch, process.arch)
  console.log(`PASS unchanged packaged host returned protocol 1, companion ${accepted.message.version}, ${accepted.message.arch}`)
  const otherId = await browser.installExtension(join(PROJECT, 'dist-ai'))
  assert.notEqual(otherId, id)
  const other = await browser.newPage()
  await other.goto(`chrome-extension://${otherId}/viewer.html`)
  const rejected = await hello(other)
  assert.equal(rejected.message, undefined)
  assert.match(rejected.error, /forbidden/i)
  console.log('PASS Chrome rejects the development ID against the same packaged allowlist')
  assert.deepEqual([digest(pureManifest), digest(aiManifest)], before)
  const report = { checkedAt: new Date().toISOString(), extensionId: id,
    extensionVersion: cfg.candidateVersion, companion: metadata,
    checks: ['actual Chrome extension ID', 'unchanged packaged native host handshake', 'development ID rejected', 'production manifests unchanged'],
    cleanInstallVerified: false,
    limitations: ['Package payload extracted for test; not a system installation', 'No Gatekeeper, directory picker, CLI or model test', 'Only the current machine architecture was executed'] }
  writeFileSync(join(output, 'connection-check.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(`Saved ${join(output, 'connection-check.json')}`)
} finally {
  if (browser) await browser.close()
  rmSync(temp, { recursive: true, force: true })
}

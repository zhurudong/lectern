// Real Chrome -> packaged host, or explicitly --installed system host. No model request.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir, homedir } from 'node:os'
import puppeteer from 'puppeteer-core'
import { PROJECT, resolveChrome } from './paths.mjs'
import { verifyArtifact } from './native/verify-artifact.mjs'

const cfg = JSON.parse(readFileSync(join(PROJECT, 'docs/store-release/release-config.json')))
const installed = process.argv.includes('--installed')
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
let association
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
  let launcher = findOne('/Contents/MacOS/lectern-agent')
  let host = JSON.parse(readFileSync(findOne('/NativeMessagingHosts/com.lectern.agent.json')))
  assert.deepEqual(host.allowed_origins, [`chrome-extension://${cfg.observedStoreId}/`])
  const profile = join(temp, 'chrome'), hosts = join(profile, 'NativeMessagingHosts')
  if (installed) {
    const installedManifest = '/Library/Google/Chrome/NativeMessagingHosts/com.lectern.agent.json'
    assert.equal(digest(installedManifest), digest(findOne('/NativeMessagingHosts/com.lectern.agent.json')))
    host = JSON.parse(readFileSync(installedManifest))
    assert.equal(host.path, '/Applications/Lectern Companion.app/Contents/MacOS/lectern-agent')
    for (const file of files.filter(p => p.includes('/Applications/Lectern Companion.app/'))) {
      const target = file.slice(file.indexOf('/Applications/Lectern Companion.app/'))
      assert.equal(digest(target), digest(file), `Installed file differs from package: ${target}`)
    }
    launcher = host.path
    // Intentionally no profile host override: Chrome must discover the system registration.
    console.log('PASS installed registration and app files match the verified release package')
  } else {
    // Only relocate registration; the packaged host and its allowlist stay intact.
    mkdirSync(hosts, { recursive: true })
    writeFileSync(join(hosts, 'com.lectern.agent.json'), JSON.stringify({ ...host, path: launcher }))
  }
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
  console.log(`PASS ${installed ? 'system-installed' : 'packaged'} host returned protocol 1, companion ${accepted.message.version}, ${accepted.message.arch}`)
  if (installed) {
    // A unique disposable association avoids presenting a picker during this
    // automated transport test. It does not count as first-use picker validation.
    const projectId = `release-check-${randomUUID()}`, cwd = join(temp, 'project')
    mkdirSync(cwd)
    const command = join(cwd, 'terminal-probe')
    writeFileSync(command, '#!/bin/sh\nprintf "LECTERN_PROBE_READY\\n"\nwhile IFS= read -r probe_line; do\n  case "$probe_line" in\n    size) /bin/stty size ;;\n    exit) exit 0 ;;\n    *) printf "LECTERN_PROBE_ECHO:%s\\n" "$probe_line" ;;\n  esac\ndone\n', { mode: 0o755 })
    const hash = createHash('sha256').update(`chrome-extension://${id}:${projectId}`).digest('hex')
    const associationPath = join(homedir(), '.lectern-agent', `project-${hash}.json`)
    writeFileSync(associationPath, JSON.stringify({ cwd }) + '\n', { flag: 'wx', mode: 0o600 })
    association = associationPath // Only clean up the file successfully created by this run.
    const terminal = await page.evaluate(({ projectId, command }) => new Promise(resolve => {
      const port = chrome.runtime.connectNative('com.lectern.agent')
      let done = false, output = '', stage = 'ready'
      const finish = result => { if (done) return; done = true; clearTimeout(timer); port.disconnect(); resolve(result) }
      const timer = setTimeout(() => finish({ error: 'Terminal test timed out', stage }), 15000)
      port.onDisconnect.addListener(() => { const error = chrome.runtime.lastError?.message; finish({ error: error ?? 'Disconnected before exit', stage }) })
      port.onMessage.addListener(message => {
        if (message.type === 'error') return finish({ error: message.code, stage })
        if (message.type === 'hello') port.postMessage({ type: 'project', id: projectId, name: 'Lectern release transport test', locale: 'en' })
        if (message.type === 'project') port.postMessage({ type: 'start', projectId, cmd: command, cols: 80, rows: 24 })
        if (message.type === 'data') {
          output += message.data
          if (stage === 'ready' && output.includes('LECTERN_PROBE_READY')) {
            stage = 'echo'; port.postMessage({ type: 'stdin', data: 'hello\r' })
          } else if (stage === 'echo' && output.includes('LECTERN_PROBE_ECHO:hello')) {
            stage = 'resize'; port.postMessage({ type: 'resize', cols: 96, rows: 37 }); port.postMessage({ type: 'stdin', data: 'size\r' })
          } else if (stage === 'resize' && /(?:^|[\r\n])\s*37\s+96\s*(?:[\r\n]|$)/.test(output)) {
            stage = 'exit'; port.postMessage({ type: 'stdin', data: 'exit\r' })
          }
        }
        if (message.type === 'exit') finish({ exitCode: message.code, stage })
      })
      port.postMessage({ type: 'hello', protocol: 1 })
    }), { projectId, command })
    assert.deepEqual(terminal, { exitCode: 0, stage: 'exit' })
    console.log('PASS installed Node/PTY/helper: real terminal input/output, 37x96 resize and natural exit')
  }
  const otherId = await browser.installExtension(join(PROJECT, 'dist-ai'))
  assert.notEqual(otherId, id)
  const other = await browser.newPage()
  await other.goto(`chrome-extension://${otherId}/viewer.html`)
  const rejected = await hello(other)
  assert.equal(rejected.message, undefined)
  assert.match(rejected.error, /forbidden/i)
  console.log('PASS Chrome rejects the development ID against the same packaged allowlist')
  assert.deepEqual([digest(pureManifest), digest(aiManifest)], before)
  const report = { checkedAt: new Date().toISOString(), extensionId: id, hostMode: installed ? 'installed' : 'extracted', chromeVersion: await browser.version(),
    extensionVersion: cfg.candidateVersion, companion: metadata,
    checks: ['actual Chrome extension ID', `${installed ? 'system-installed' : 'unchanged packaged'} native host handshake`, 'development ID rejected', 'production manifests unchanged',
      ...(installed ? ['installed files match release payload', 'system registration discovered without a profile override', 'real PTY input/output, resize and natural exit'] : [])],
    cleanInstallVerified: false,
    limitations: [installed ? 'Existing macOS user and companion upgrade; not a clean OS account' : 'Package payload extracted for test; not a system installation',
      'No Gatekeeper, directory picker, AI CLI or model test in this script', 'Only the current machine architecture was executed'] }
  const reportPath = join(output, installed ? 'installed-connection-check.json' : 'connection-check.json')
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n')
  console.log(`Saved ${reportPath}`)
} finally {
  try { if (browser) await browser.close() }
  finally { if (association) rmSync(association, { force: true }); rmSync(temp, { recursive: true, force: true }) }
}

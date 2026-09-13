// Launch this repository's local candidate in a separate QA profile for human testing.
// It does not operate the user's existing browser or the Chrome Web Store.
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import puppeteer from 'puppeteer-core'
import { PROJECT, resolveChrome } from './paths.mjs'

const cfg = JSON.parse(readFileSync(join(PROJECT, 'docs/store-release/release-config.json')))
const output = join(PROJECT, 'release-artifacts', `store-test-${cfg.candidateVersion}`)
const extension = join(output, 'extension')
const installed = JSON.parse(readFileSync('/Applications/Lectern Companion.app/Contents/Resources/agent/distribution.json'))
assert.equal(installed.extensionId, cfg.observedStoreId)
assert.equal(installed.version, cfg.companionVersion)
const sample = join(output, 'sample-project')
mkdirSync(sample, { recursive: true })
if (!existsSync(join(sample, 'README.md'))) writeFileSync(join(sample, 'README.md'), '# Lectern installation test\n\nThis disposable project checks the optional AI terminal.\n\nThe add function in hello.js returns the sum of two numbers.\n')
if (!existsSync(join(sample, 'hello.js'))) writeFileSync(join(sample, 'hello.js'), 'export const add = (a, b) => a + b\n')
const browser = await puppeteer.launch({ executablePath: resolveChrome(),
  userDataDir: join(output, 'manual-chrome-profile'), headless: false, pipe: true, enableExtensions: true,
  args: ['--no-first-run', '--no-default-browser-check'], defaultViewport: null })
process.once('SIGINT', () => { void browser.close() })
process.once('SIGTERM', () => { void browser.close() })
try {
  const id = await browser.installExtension(extension)
  assert.equal(id, cfg.observedStoreId)
  const page = await browser.newPage()
  await page.evaluateOnNewDocument(() => { if (!localStorage.getItem('cv-lang')) localStorage.setItem('cv-lang', 'zh') })
  await page.goto(`chrome-extension://${id}/viewer.html`)
  await page.waitForSelector('.ai-toggle')
  for (const initial of await browser.pages()) if (initial !== page && initial.url() === 'about:blank') await initial.close()
  console.log(JSON.stringify({ status: 'manual-check-ready', extensionId: id, version: cfg.candidateVersion, sampleProject: sample,
    instructions: 'Open Folder: select sample-project. Open AI terminal: select that same folder once. This window uses the installed system host; no mock host or model request is injected.' }, null, 2))
  await new Promise(resolve => browser.once('disconnected', resolve))
} finally { await browser.close() }

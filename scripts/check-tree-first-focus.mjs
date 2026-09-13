import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'
import { PROJECT, resolveChrome } from './paths.mjs'
import { join } from 'node:path'
const browser = await puppeteer.launch({ executablePath: resolveChrome(), headless: false, pipe: true, enableExtensions: true })
try {
  const id = await browser.installExtension(join(PROJECT, 'dist-dev'))
  for (let run = 0; run < 3; run++) {
    const page = await browser.newPage()
    await page.evaluateOnNewDocument(() => localStorage.setItem('cv-lang', 'zh'))
    await page.goto(`chrome-extension://${id}/viewer.html`)
    await page.waitForSelector('.welcome')
    await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory()
      await root.getFileHandle('first.txt', { create: true })
      window.focusEvents = []
      document.addEventListener('focusin', (e) => window.focusEvents.push({ target: e.target.className, text: e.target.textContent?.slice(0, 30) }))
      const obs = new MutationObserver(() => {
        const tree = document.querySelector('.tree')
        if (!tree) return
        obs.disconnect(); tree.focus()
        window.premise = { focus: document.activeElement === tree, rows: tree.querySelectorAll('[role=treeitem]').length }
      })
      obs.observe(document.documentElement, { childList: true, subtree: true })
      window.__cv.enterProject({ kind: 'directory', name: 'test', async *entries() {
        await new Promise((resolve) => setTimeout(resolve, 300))
        yield* root.entries()
      } })
    })
    await page.waitForSelector('[role=treeitem]')
    await page.waitForFunction(() => document.querySelector('.tree')?.getAttribute('aria-activedescendant'), { timeout: 2000 }).catch(() => {})
    const state = await page.evaluate(() => ({ premise: window.premise, tree: window.__cvTreeState(), events: window.focusEvents }))
    console.log(JSON.stringify(state))
    assert.ok(state.premise.focus && state.premise.rows === 0)
    assert.ok(state.tree.strictFocus && state.tree.activePath?.[0] === 'first.txt' && state.tree.attr, 'Focused loading tree must initialize its first active row')
    await page.close()
  }
  console.log('PASS loading tree retains explicit focus and initializes first row (3 runs)')
} finally { await browser.close() }

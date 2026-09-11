// Drag-and-drop regression against the production extension and real local files.
// Run: node scripts/e2e-drop.mjs [--dist /path/to/fresh/production/bundle]
// The default build lives in a unique temporary directory so parallel tasks
// cannot overwrite the extension under test by rebuilding the shared dist/.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import puppeteer from 'puppeteer-core'
import { PROJECT, resolveChrome } from './paths.mjs'

const args = process.argv.slice(2)
assert(args.length === 0 || (args.length === 2 && args[0] === '--dist'),
  'Usage: node scripts/e2e-drop.mjs [--dist /path/to/fresh/production/bundle]')
const chrome = resolveChrome()
const buildRoot = args.length === 0 ? mkdtempSync(join(tmpdir(), 'lectern-drop-build-')) : null
const dist = buildRoot ? join(buildRoot, 'dist') : resolve(PROJECT, args[1])
if (buildRoot) {
  try {
    for (const command of [['tsc', '--noEmit'], ['vite', 'build', '--outDir', dist]]) {
      const build = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', command, {
        cwd: PROJECT,
        stdio: 'inherit',
      })
      if (build.error) throw build.error
      assert.equal(build.status, 0, `Production build failed: ${command.join(' ')}`)
    }
  } catch (error) {
    rmSync(buildRoot, { recursive: true, force: true })
    throw error
  }
}

const fixtureRoot = mkdtempSync(join(tmpdir(), 'lectern-drop-files-'))
const profile = mkdtempSync(join(tmpdir(), 'lectern-drop-profile-'))
const projectName = 'dropped-project'
const projectPath = join(fixtureRoot, projectName)
const homeFile = join(fixtureRoot, 'home-drop.ts')
const editorFile = join(fixtureRoot, 'editor-drop.ts')
const homeMarker = 'HOME_DROP_REAL_FILESYSTEM'
const treeMarker = 'TREE_DROP_REAL_FILESYSTEM'
const editorMarker = 'EDITOR_DROP_REAL_FILESYSTEM'
mkdirSync(join(projectPath, 'src'), { recursive: true })
writeFileSync(join(projectPath, 'root.txt'), 'A real directory dropped into the extension.\n')
writeFileSync(join(projectPath, 'src', 'nested.ts'), `export const treeDrop = '${treeMarker}';\n`)
writeFileSync(homeFile, `export const homeDrop = '${homeMarker}';\n`)
writeFileSync(editorFile, `export const editorDrop = '${editorMarker}';\n`)

let browser
let page
let passed = 0
let overlayScreenshot
const errors = []
const network = []
function pass(name) {
  passed += 1
  console.log(`PASS  ${name}`)
}

try {
  browser = await puppeteer.launch({
    executablePath: chrome,
    dumpio: process.env.CV_DROP_DEBUG === '1',
    headless: false,
    pipe: true,
    enableExtensions: true,
    args: [
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1440,900',
    ],
    defaultViewport: { width: 1400, height: 850 },
  })
  const extensionId = await browser.installExtension(dist)
  assert(extensionId, 'Production extension was not installed')
  page = await browser.newPage()
  page.setDefaultTimeout(10000)
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('request', (request) => {
    if (/^https?:/i.test(request.url())) network.push(request.url())
  })
  await page.goto(`chrome-extension://${extensionId}/viewer.html`, { waitUntil: 'load' })
  await page.waitForSelector('.welcome')
  assert.equal(await page.evaluate(() => typeof window.__cv), 'undefined', 'Production must not expose dev hooks')
  pass('Production extension loads without dev hooks')

  const cdp = await page.createCDPSession()
  const pointInside = async (selector) => {
    const element = await page.waitForSelector(selector, { visible: true })
    const bounds = await element.boundingBox()
    assert(bounds && bounds.width > 0 && bounds.height > 0, `No visible drag target: ${selector}`)
    // Clamp to the viewport: CodeMirror content can be taller than its scroller.
    const viewport = page.viewport()
    return {
      x: Math.min(viewport.width - 2, Math.max(2, bounds.x + Math.min(bounds.width / 2, 100))),
      y: Math.min(viewport.height - 2, Math.max(2, bounds.y + Math.min(bounds.height / 2, 20))),
    }
  }
  const dispatch = (type, point, data) => cdp.send('Input.dispatchDragEvent', { type, ...point, data })
  const beginFiles = async (files, selector = '.welcome') => {
    const point = await pointInside(selector)
    const data = { items: [], files, dragOperationsMask: 1 }
    await dispatch('dragEnter', point, data)
    await dispatch('dragOver', point, data)
    await page.waitForSelector('.file-drop-overlay', { visible: true })
    if (!overlayScreenshot) {
      overlayScreenshot = join(mkdtempSync(join(tmpdir(), 'lectern-drop-overlay-')), 'overlay.png')
      await page.screenshot({ path: overlayScreenshot })
      console.log(`Overlay screenshot: ${overlayScreenshot}`)
    }
    return { point, data }
  }
  const dropFiles = async (files, selector = '.welcome') => {
    const { point, data } = await beginFiles(files, selector)
    // files contains actual host paths. Chrome creates the native DataTransfer
    // items and filesystem handles; no application state or handle is injected.
    await dispatch('drop', point, data)
    await page.waitForSelector('.file-drop-overlay', { hidden: true })
  }
  const waitContent = (marker) => page.waitForFunction(
    (text) => document.querySelector('.cm-content')?.textContent?.includes(text), {}, marker,
  )
  const home = async () => {
    await page.click('.topbar button[title="回到入口页"]')
    await page.waitForSelector('.welcome')
    await page.waitForFunction(() => document.querySelector('.recent-empty')?.textContent !== '加载中…')
  }
  const recentNames = () => page.$$eval('.recent-item .name', (elements) => elements.map((element) => element.textContent))
  const clickTreeRow = (path) => page.locator(`.tree-row[role="treeitem"][title=${JSON.stringify(path)}]`).click()
  const expectCurrentProject = async () => {
    await waitContent(treeMarker)
    assert.equal(await page.$eval('.project-name', (element) => element.textContent), projectName)
    assert.equal(await page.$eval('.file-path', (element) => element.textContent), 'src/nested.ts')
  }
  const dismissDropError = async () => {
    await page.waitForSelector('.file-drop-error[role="alert"]', { visible: true })
    assert((await page.$eval('.file-drop-error', (element) => element.textContent)).trim(), 'Drop failure must explain the error')
    await page.click('.file-drop-error button')
    await page.waitForSelector('.file-drop-error', { hidden: true })
  }
  const delayNextHandle = () => page.evaluate(() => {
    window.__staleDropReads = 0
    const descriptor = Object.getOwnPropertyDescriptor(DataTransferItem.prototype, 'getAsFileSystemHandle')
    Object.defineProperty(DataTransferItem.prototype, 'getAsFileSystemHandle', {
      configurable: true,
      value() {
        // Acquire the real handle during the drop event, but hold its result to
        // reproduce an older operation completing after a newer user action.
        const result = descriptor.value.call(this).then(async (handle) => {
          if (!(handle instanceof FileSystemFileHandle)) throw new Error('Delayed drop did not acquire a real file handle')
          const file = await handle.getFile()
          // Only this race fixture fixes the downstream I/O timing. A stale
          // request must be discarded before it tries to read this handle.
          Object.defineProperty(handle, 'getFile', { value: () => {
            window.__staleDropReads += 1
            return Promise.resolve(file)
          } })
          return handle
        }).then(
          (handle) => ({ handle }),
          (error) => ({ error }),
        )
        Object.defineProperty(DataTransferItem.prototype, 'getAsFileSystemHandle', descriptor)
        return new Promise((resolve, reject) => {
          window.__releasePendingDrop = async () => {
            const outcome = await result
            if (outcome.error) {
              reject(outcome.error)
              throw outcome.error
            }
            resolve(outcome.handle)
          }
        })
      },
    })
  })
  const releaseDelayedHandle = () => page.evaluate(async () => {
    await window.__releasePendingDrop()
    delete window.__releasePendingDrop
    // Let the application's await continuation and render complete before
    // asserting it did not reopen the stale dropped file.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    if (window.__staleDropReads !== 0) throw new Error('A stale dropped handle was read after a newer user action')
    delete window.__staleDropReads
  })
  const beginDelayedDrop = async () => {
    await delayNextHandle()
    const pending = await beginFiles([homeFile], '.cm-content')
    await dispatch('drop', pending.point, pending.data)
    await page.waitForFunction(() => typeof window.__releasePendingDrop === 'function')
  }

  await dropFiles([homeFile])
  await waitContent(homeMarker)
  assert.equal(await page.$eval('.file-path', (element) => element.textContent), 'home-drop.ts')
  assert.equal(await page.$('.tree'), null, 'Single-file drop must not create a project tree')
  pass('Dropping a real file on the welcome page opens its content')
  await home()
  assert.deepEqual(await recentNames(), [], 'Single files must not enter recent projects')
  pass('Single-file drop does not create a recent project')

  await dropFiles([projectPath])
  await page.waitForSelector('.tree-row')
  assert.equal(await page.$eval('.project-name', (element) => element.textContent), projectName)
  await clickTreeRow('src')
  await clickTreeRow('src/nested.ts')
  await expectCurrentProject()
  pass('Dropping a real directory opens its tree and a nested file is readable')

  const cancelled = await beginFiles([homeFile], '.cm-content')
  // CDP dragCancel ends the source drag without notifying the drop target.
  // Moving outside the viewport triggers Chrome's real target dragleave; the
  // following dragCancel only cleans up CDP state. This does not test Escape.
  await dispatch('dragOver', { x: -10, y: -10 }, cancelled.data)
  await dispatch('dragCancel', cancelled.point, cancelled.data)
  await page.waitForSelector('.file-drop-overlay', { hidden: true })
  await expectCurrentProject()
  pass('Dragging outside the page hides the overlay and preserves the open file')

  await dropFiles([homeFile, editorFile], '.cm-content')
  await page.waitForSelector('.file-drop-error[role="alert"]', { visible: true })
  await expectCurrentProject()
  await dismissDropError()
  pass('Multiple files are rejected with a dismissible error and preserve the project')

  await dropFiles([projectPath, homeFile], '.cm-content')
  await page.waitForSelector('.file-drop-error[role="alert"]', { visible: true })
  await expectCurrentProject()
  await dismissDropError()
  pass('A mixed directory/file drop is rejected without changing the project')

  // Only failure cases replace the browser API; every successful opening above
  // and below uses an unmodified native FileSystemHandle from a host path.
  for (const failure of ['null', 'rejection']) {
    await page.evaluate((kind) => {
      window.__dropHandleDescriptor = Object.getOwnPropertyDescriptor(DataTransferItem.prototype, 'getAsFileSystemHandle')
      Object.defineProperty(DataTransferItem.prototype, 'getAsFileSystemHandle', {
        configurable: true,
        value() {
          return kind === 'null'
            ? Promise.resolve(null)
            : Promise.reject(new DOMException('Regression fixture: denied handle', 'NotAllowedError'))
        },
      })
    }, failure)
    try {
      await dropFiles([homeFile], '.cm-content')
      await page.waitForSelector('.file-drop-error[role="alert"]', { visible: true })
      await expectCurrentProject()
      await dismissDropError()
      pass(`A ${failure} handle result reports an error and preserves the project`)
    } finally {
      await page.evaluate(() => {
        Object.defineProperty(DataTransferItem.prototype, 'getAsFileSystemHandle', window.__dropHandleDescriptor)
        delete window.__dropHandleDescriptor
      })
    }
  }

  // Observe default prevention on a normal, non-editor target. CodeMirror is
  // entitled to handle text in its own content area independently of FileDrop.
  await page.evaluate(() => {
    window.__textDragEvents = []
    window.__observeTextDrag = (event) => {
      queueMicrotask(() => window.__textDragEvents.push({ type: event.type, prevented: event.defaultPrevented }))
    }
    for (const type of ['dragenter', 'dragover', 'drop']) {
      document.addEventListener(type, window.__observeTextDrag)
    }
  })
  try {
    const point = await pointInside('.project-name')
    const data = { items: [{ mimeType: 'text/plain', data: 'ordinary dragged text' }], dragOperationsMask: 1 }
    await dispatch('dragEnter', point, data)
    await dispatch('dragOver', point, data)
    assert.equal(await page.$('.file-drop-overlay'), null, 'Text drag must not show a file overlay')
    await dispatch('drop', point, data)
    const observations = await page.evaluate(() => window.__textDragEvents)
    assert(observations.some((event) => event.type === 'dragover'), 'Text drag must reach the actual document')
    assert(observations.every((event) => !event.prevented), JSON.stringify(observations))
    assert.equal(await page.$('.file-drop-error'), null, 'Text drag must not produce a file error')
    await expectCurrentProject()
    pass('Plain-text dragging is not intercepted by the file-drop handler')
  } finally {
    await page.evaluate(() => {
      for (const type of ['dragenter', 'dragover', 'drop']) {
        document.removeEventListener(type, window.__observeTextDrag)
      }
      delete window.__observeTextDrag
      delete window.__textDragEvents
    })
  }

  await beginDelayedDrop()
  await home()
  await releaseDelayedHandle()
  assert(await page.$('.welcome'), 'Returning home must invalidate an older unfinished drop')
  assert.equal(await page.$('.cm-content'), null, 'The stale file must not reopen after returning home')
  assert.equal(await page.$('.file-drop-overlay'), null, 'A stale drop must not leave an overlay')
  pass('An unfinished drop cannot reopen a file after returning home')

  await dropFiles([projectPath])
  await clickTreeRow('src')
  await clickTreeRow('src/nested.ts')
  await expectCurrentProject()
  await beginDelayedDrop()
  await dropFiles([editorFile], '.cm-content')
  await waitContent(editorMarker)
  assert.equal(await page.$eval('.file-path', (element) => element.textContent), 'editor-drop.ts')
  assert.equal(await page.$('.tree'), null, 'File dropped onto CodeMirror must enter single-file mode')
  pass('Dropping a real file directly on CodeMirror opens the new file')
  await releaseDelayedHandle()
  assert.equal(await page.$eval('.file-path', (element) => element.textContent), 'editor-drop.ts')
  await waitContent(editorMarker)
  pass('An older unfinished drop cannot replace a newer dropped file')

  await home()
  await page.waitForFunction(
    (name) => [...document.querySelectorAll('.recent-item .name')].some((element) => element.textContent === name),
    {}, projectName,
  )
  assert.deepEqual(await recentNames(), [projectName], 'Recent projects must contain only the dropped directory')
  pass('The directory is persisted in recent projects; dropped files are excluded')

  assert.deepEqual(network, [], 'Drag-and-drop must not make HTTP requests')
  assert.deepEqual(errors, [], 'No uncaught browser or console errors')
  pass('No HTTP requests or browser errors')
} catch (error) {
  console.error(`FAIL  ${error?.stack ?? error}`)
  if (page) {
    // Keep failure evidence outside the temporary fixture directory that is removed below.
    const evidence = mkdtempSync(join(tmpdir(), 'lectern-drop-failure-'))
    await page.screenshot({ path: join(evidence, 'page.png') }).catch(() => {})
    console.error(`Failure screenshot: ${join(evidence, 'page.png')}`)
  }
  process.exitCode = 1
} finally {
  await browser?.close()
  rmSync(profile, { recursive: true, force: true })
  rmSync(fixtureRoot, { recursive: true, force: true })
  if (buildRoot) rmSync(buildRoot, { recursive: true, force: true })
  console.log(`\n${passed} drag-and-drop checks passed${process.exitCode ? '; suite failed' : ''}.`)
}

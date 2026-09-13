import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { verifyArtifact } from './native/verify-artifact.mjs'
import { PROJECT } from './paths.mjs'
const release = process.argv.includes('--release')
const pkg = JSON.parse(readFileSync(join(PROJECT, 'package.json')))
const lock = JSON.parse(readFileSync(join(PROJECT, 'package-lock.json')))
assert.equal(pkg.version, lock.version); assert.equal(pkg.version, lock.packages[''].version)
for (const dir of ['dist', 'dist-ai']) {
  const root = join(PROJECT, dir), m = JSON.parse(readFileSync(join(root, 'manifest.json')))
  assert.equal(m.version, pkg.version); assert.equal(m.default_locale, 'en')
  assert.equal(m.name, '__MSG_extensionName__'); assert.equal(m.description, '__MSG_extensionDescription__')
  for (const file of ['LICENSE', 'THIRD-PARTY-NOTICES.md']) assert.ok(existsSync(join(root, file)), `${dir}: missing ${file}`)
  const localeKeys = []
  for (const locale of ['en', 'zh_CN']) {
    const messages = JSON.parse(readFileSync(join(root, '_locales', locale, 'messages.json')))
    localeKeys.push(Object.keys(messages).sort())
    assert.ok(messages.extensionName.message.length <= 75)
    assert.ok(messages.extensionDescription.message.length <= 132)
    assert.ok(!/spike|opt-in/i.test(messages.extensionName.message))
    for (const value of Object.values(messages)) assert.ok(value.message.trim())
  }
  assert.deepEqual(...localeKeys)
  assert.equal(m.permissions.includes('nativeMessaging'), dir === 'dist-ai')
}
const ai = join(PROJECT, 'dist-ai')
for (const file of ['native-setup.html', 'native-setup.en.html']) {
  const html = readFileSync(join(ai, file), 'utf8')
  assert.ok(!/__DOWNLOAD__|__SIGNING__/.test(html))
  if (release) assert.ok(!/尚未配置|No public download/.test(html), 'Release download is not configured')
}
if (release) {
  assert.match(process.env.LECTERN_EXTENSION_ID ?? '', /^[a-p]{32}$/, 'Set the confirmed store extension ID')
  assert.equal(new URL(process.env.LECTERN_DOWNLOAD_URL).protocol, 'https:')
  assert.ok(process.env.LECTERN_COMPANION_PKG, 'Set the exact companion package path')
  const distribution = process.env.LECTERN_COMPANION_DISTRIBUTION ?? 'signed'
  verifyArtifact(process.env.LECTERN_COMPANION_PKG, { extensionId: process.env.LECTERN_EXTENSION_ID, distribution, arch: process.env.LECTERN_COMPANION_ARCH })
  if (distribution === 'unsigned') {
    for (const file of ['native-setup.html', 'native-setup.en.html']) assert.match(readFileSync(join(ai, file), 'utf8'), /not notarized|未公证/, 'Disclose unsigned installation before release')
  }
}
console.log(`PASS release metadata, locales, license files, build separation and setup pages${release ? ' (release mode)' : ' (candidate only; no publication implied)'}`)

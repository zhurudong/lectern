import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { VERSION } from '../lectern-agent/native/session.mjs'
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
  assert.ok(!html.includes('__DOWNLOAD__'))
  if (release) assert.ok(!/尚未配置|No public download/.test(html), 'Release download is not configured')
}
if (release) {
  assert.match(process.env.LECTERN_EXTENSION_ID ?? '', /^[a-p]{32}$/, 'Set the confirmed store extension ID')
  assert.equal(new URL(process.env.LECTERN_DOWNLOAD_URL).protocol, 'https:')
  assert.equal(process.platform, 'darwin', 'Formal companion verification requires macOS')
  assert.ok(process.env.LECTERN_COMPANION_PKG, 'Set the exact signed package path')
  const companion = resolve(process.env.LECTERN_COMPANION_PKG)
  assert.ok(companion.endsWith('.pkg') && !companion.includes('UNSIGNED') && existsSync(companion))
  assert.ok(companion.includes(`-${VERSION}-`), 'Companion version must match source')
  execFileSync('/usr/sbin/pkgutil', ['--check-signature', companion], { stdio: 'inherit' })
  execFileSync('/usr/bin/xcrun', ['stapler', 'validate', companion], { stdio: 'inherit' })
  execFileSync('/usr/sbin/spctl', ['--assess', '--type', 'install', '--verbose', companion], { stdio: 'inherit' })
}
console.log(`PASS release metadata, locales, license files, build separation and setup pages${release ? ' (release mode)' : ' (candidate only; no publication implied)'}`)

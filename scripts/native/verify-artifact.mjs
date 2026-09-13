import assert from 'node:assert/strict'
import { readFileSync, readdirSync, mkdtempSync, rmSync, existsSync } from 'node:fs'
import { join, basename, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { VERSION } from '../../lectern-agent/native/session.mjs'

// Both distribution modes require identical identity, payload and integrity checks.
export function verifyArtifact(file, { extensionId, distribution, arch } = {}) {
  assert.equal(process.platform, 'darwin', 'Package payload verification requires macOS')
  assert.match(extensionId ?? '', /^[a-p]{32}$/)
  assert.ok(['signed', 'unsigned'].includes(distribution), 'Choose an explicit distribution mode')
  const pkg = resolve(file)
  assert.ok(existsSync(pkg) && pkg.endsWith('.pkg') && !pkg.includes('UNSIGNED-DEV'))
  assert.ok(basename(pkg).startsWith(`Lectern-Companion-${VERSION}-macOS-`))
  assert.equal(basename(pkg).endsWith('-UNSIGNED.pkg'), distribution === 'unsigned')
  const sum = createHash('sha256').update(readFileSync(pkg)).digest('hex')
  assert.equal(readFileSync(`${pkg}.sha256`, 'utf8').trim(), `${sum}  ${basename(pkg)}`, 'Package checksum mismatch')
  const signature = spawnSync('/usr/sbin/pkgutil', ['--check-signature', pkg], { encoding: 'utf8' })
  if (distribution === 'signed') {
    assert.equal(signature.status, 0, signature.stdout + signature.stderr)
    execFileSync('/usr/bin/xcrun', ['stapler', 'validate', pkg], { stdio: 'inherit' })
    execFileSync('/usr/sbin/spctl', ['--assess', '--type', 'install', '--verbose', pkg], { stdio: 'inherit' })
  } else {
    assert.match(signature.stdout + signature.stderr, /no signature|not signed|unsigned/i, 'Unsigned package must be accurately labelled')
  }
  const temp = mkdtempSync(join(tmpdir(), 'lectern-artifact-'))
  try {
    const expanded = join(temp, 'payload')
    execFileSync('/usr/sbin/pkgutil', ['--expand-full', pkg, expanded])
    const all = []
    const walk = dir => { for (const entry of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, entry.name); if (entry.isDirectory()) walk(p); else all.push(p) } }
    walk(expanded)
    const one = name => { const files = all.filter(p => basename(p) === name); assert.equal(files.length, 1, `Expected exactly one ${name}`); return files[0] }
    const metadata = JSON.parse(readFileSync(one('distribution.json')))
    assert.equal(metadata.version, VERSION); assert.equal(metadata.distribution, distribution)
    assert.equal(metadata.extensionId, extensionId)
    assert.ok(['arm64', 'x64'].includes(metadata.arch)); if (arch) assert.equal(metadata.arch, arch)
    for (const name of ['native-release.json', 'com.lectern.agent.json'])
      assert.deepEqual(JSON.parse(readFileSync(one(name))).allowed_origins, [`chrome-extension://${extensionId}/`])
    for (const suffix of ['/Contents/Resources/node', `/prebuilds/darwin-${metadata.arch}/pty.node`, `/prebuilds/darwin-${metadata.arch}/spawn-helper`]) {
      const file = all.find(p => p.endsWith(suffix)); assert.ok(file, `Missing ${suffix}`)
      assert.equal(execFileSync('/usr/bin/lipo', ['-archs', file], { encoding: 'utf8' }).trim(), metadata.arch === 'x64' ? 'x86_64' : 'arm64')
    }
    assert.ok(!all.some(p => /\/agent\/(server\.mjs|node_modules\/ws\/)/.test(p)), 'Do not ship the legacy WebSocket server')
    return { ...metadata, sha256: sum }
  } finally { rmSync(temp, { recursive: true, force: true }) }
}

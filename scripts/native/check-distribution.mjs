import assert from 'node:assert/strict'
import { mkdtempSync, cpSync, writeFileSync, rmSync } from 'node:fs'
import { join, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { verifyArtifact } from './verify-artifact.mjs'
import { PROJECT } from '../paths.mjs'
import { VERSION } from '../../lectern-agent/native/session.mjs'
const id = process.env.LECTERN_EXTENSION_ID
assert.match(id ?? '', /^[a-p]{32}$/, 'Set the expected store extension ID')
for (const arch of ['arm64','x64']) {
  const file = join(PROJECT, 'release-artifacts', `Lectern-Companion-${VERSION}-macOS-${arch}-UNSIGNED.pkg`)
  const result = verifyArtifact(file, { extensionId: id, distribution: 'unsigned', arch })
  assert.equal(result.arch, arch)
  console.log(`PASS ${arch}: unsigned status, origin, version, Node/PTY/helper architectures and SHA-256`)
  if (arch === 'arm64') {
    assert.throws(() => verifyArtifact(file, { extensionId: id === 'p'.repeat(32) ? 'a'.repeat(32) : 'p'.repeat(32), distribution: 'unsigned', arch }))
    assert.throws(() => verifyArtifact(file, { extensionId: id, distribution: 'signed', arch }))
    const temp = mkdtempSync(join(tmpdir(), 'lectern-corrupt-checksum-'))
    try {
      const copy = join(temp, basename(file)); cpSync(file, copy)
      writeFileSync(`${copy}.sha256`, `${'0'.repeat(64)}  ${basename(file)}\n`)
      assert.throws(() => verifyArtifact(copy, { extensionId: id, distribution: 'unsigned', arch }), /checksum mismatch/)
    } finally { rmSync(temp, { recursive: true, force: true }) }
    console.log('PASS rejects wrong extension identity, signed-mode mislabelling and corrupt checksum')
  }
}

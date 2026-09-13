// Keep the store identity in a separate unpacked test copy of the AI build.
import assert from 'node:assert/strict'
import { createHash, createPublicKey } from 'node:crypto'
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PROJECT } from './paths.mjs'

const cfg = JSON.parse(readFileSync(join(PROJECT, 'docs/store-release/release-config.json')))
const der = createPublicKey(readFileSync(join(PROJECT, 'docs/store-release/extension-public-key.pem')))
  .export({ format: 'der', type: 'spki' })
const id = createHash('sha256').update(der).digest('hex').slice(0, 32)
  .replace(/[0-9a-f]/g, c => String.fromCharCode(97 + parseInt(c, 16)))
assert.ok(cfg.storeIdConfirmed, 'Confirm the store item before preparing its test build')
assert.equal(id, cfg.observedStoreId, 'The public key belongs to another store item')
const input = join(PROJECT, 'dist-ai')
const manifest = JSON.parse(readFileSync(join(input, 'manifest.json')))
assert.equal(manifest.version, cfg.candidateVersion)
assert.ok(manifest.permissions.includes('nativeMessaging'))
assert.equal(new URL(cfg.downloadUrl).protocol, 'https:')
for (const page of ['native-setup.html', 'native-setup.en.html']) {
  assert.ok(readFileSync(join(input, page), 'utf8').includes(cfg.downloadUrl.replaceAll('&', '&amp;')),
    'Rebuild the AI candidate with the public companion download URL')
}
// This output is never the input to the store ZIP or pure-reader build.
const out = join(PROJECT, 'release-artifacts', `store-test-${manifest.version}`, 'extension')
rmSync(out, { recursive: true, force: true })
cpSync(input, out, { recursive: true })
writeFileSync(join(out, 'manifest.json'), JSON.stringify({ ...manifest, key: der.toString('base64') }, null, 2) + '\n')
console.log(`Prepared local store-identity test extension: ${out}\nExtension ID: ${id}\nOnly manifest.key differs from dist-ai; no system companion installation changed.`)

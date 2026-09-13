// Prepare exactly the public companion files; never upload or publish.
import { readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs'
import { join, basename } from 'node:path'
import { verifyArtifact } from './verify-artifact.mjs'
import { PROJECT } from '../paths.mjs'
import { VERSION } from '../../lectern-agent/native/session.mjs'
const cfg = JSON.parse(readFileSync(join(PROJECT,'docs/store-release/release-config.json')))
if (!cfg.storeIdConfirmed || cfg.companionDistribution !== 'unsigned') throw new Error('Confirm store identity and unsigned GitHub distribution')
const out = join(PROJECT, 'release-artifacts', `github-companion-v${VERSION}`)
mkdirSync(out, { recursive: true })
const assets = []
for (const arch of ['arm64','x64']) {
  const file = join(PROJECT,'release-artifacts',`Lectern-Companion-${VERSION}-macOS-${arch}-UNSIGNED.pkg`)
  const verified = verifyArtifact(file, { extensionId: cfg.observedStoreId, distribution: 'unsigned', arch })
  for (const path of [file, `${file}.sha256`]) cpSync(path, join(out, basename(path)))
  assets.push({ name: basename(file), ...verified })
}
cpSync(join(PROJECT,`docs/native-terminal/github-release-${VERSION}.md`),join(out,'RELEASE-NOTES.md'))
writeFileSync(join(out,'release-assets.json'),JSON.stringify({tag:`companion-v${VERSION}`,prerelease:true,extensionId:cfg.observedStoreId,assets},null,2)+'\n')
console.log(`Prepared GitHub upload files: ${out}\nNot uploaded or published.`)

// Developer-only user registration; end users install the .pkg instead.
import { cpSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { PROJECT } from '../paths.mjs'
const base = join(homedir(), '.lectern-agent/native-dev')
const manifestPath = join(homedir(), 'Library/Application Support/Google/Chrome/NativeMessagingHosts/com.lectern.agent.json')
if (process.argv.includes('--uninstall')) {
  let manifest
  try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (manifest?.path.startsWith(base + '/')) rmSync(manifestPath)
  rmSync(base, { recursive: true, force: true })
  console.log('Removed developer registration; production installation and preferences retained.')
} else {
  const source = join(PROJECT, 'release-artifacts/Lectern Companion.app')
  const config = JSON.parse(readFileSync(join(source, 'Contents/Resources/agent/native-release.json'), 'utf8'))
  mkdirSync(base, { recursive: true })
  const target = join(base, 'Lectern Companion.app')
  rmSync(target, { recursive: true, force: true }); cpSync(source, target, { recursive: true })
  mkdirSync(join(manifestPath, '..'), { recursive: true })
  writeFileSync(manifestPath, JSON.stringify({ name: 'com.lectern.agent', description: 'Lectern development companion', path: join(target, 'Contents/MacOS/lectern-agent'), type: 'stdio', allowed_origins: config.allowed_origins }, null, 2))
  console.log(`Registered ${config.allowed_origins.join(', ')}. Reload dist-ai in Chrome.\nBefore testing a production .pkg, run: node scripts/native/register-dev.mjs --uninstall`)
}

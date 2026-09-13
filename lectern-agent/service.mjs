import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync, readFileSync, cpSync, mkdtempSync, readdirSync, chmodSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
const LABEL = 'com.lectern.agent'
const xml = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;')
export function servicePlist({ node, cli, dir, port, envPath }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${LABEL}</string>
<key>ProgramArguments</key><array>${[node, cli, '--port', String(port)].map((arg) => `<string>${xml(arg)}</string>`).join('')}</array>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>10</integer>
<key>WorkingDirectory</key><string>${xml(dir)}</string>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(envPath)}</string></dict>
<key>StandardOutPath</key><string>${xml(join(dir, 'service.log'))}</string>
<key>StandardErrorPath</key><string>${xml(join(dir, 'service-error.log'))}</string>
</dict></plist>\n`
}
// Install a self-contained snapshot. A daemon must not depend on the current
// git checkout: switching branches or removing the source must not break login.
export function stageRuntime(dir) {
  const source = dirname(fileURLToPath(import.meta.url))
  const target = mkdtempSync(join(dir, 'runtime-'))
  try {
    const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
    for (const file of new Set(['package.json', ...manifest.files])) cpSync(join(source, file), join(target, file), { recursive: true })
    const installed = new Set()
    const copyDependencies = (root) => {
      const require = createRequire(join(root, 'package.json'))
      const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
      for (const name of Object.keys(pkg.dependencies ?? {})) {
        if (installed.has(name)) continue
        installed.add(name)
        const dependency = dirname(require.resolve(`${name}/package.json`))
        cpSync(dependency, join(target, 'node_modules', name), { recursive: true, dereference: true })
        copyDependencies(dependency)
      }
    }
    copyDependencies(source)
    return target
  } catch (error) { rmSync(target, { recursive: true, force: true }); throw error }
}
export async function manageService({ uninstall = false, port = 8137, dir }) {
  if (process.platform !== 'darwin') throw new Error('Login service currently supports macOS only')
  const folder = join(homedir(), 'Library', 'LaunchAgents')
  const path = join(folder, `${LABEL}.plist`)
  const domain = `gui/${process.getuid()}`
  const staged = uninstall ? null : stageRuntime(dir)
  let previous
  try { previous = readFileSync(path, 'utf8') } catch (error) { if (error.code !== 'ENOENT') throw error }
  try {
    try { execFileSync('/bin/launchctl', ['bootout', `${domain}/${LABEL}`], { stdio: 'pipe' }) }
    catch (error) { if (!/Could not find service|No such process/.test(String(error.stderr))) throw error }
    // bootout initiates teardown; wait until the old registration disappears
    // before replacing it. Otherwise bootstrap can race it and return EIO.
    for (let attempt = 0; ; attempt++) {
      try { execFileSync('/bin/launchctl', ['print', `${domain}/${LABEL}`], { stdio: 'pipe' }) }
      catch (error) {
        if (/Could not find service|No such process/.test(String(error.stderr))) break
        throw error
      }
      if (attempt >= 100) throw new Error('Timed out waiting for previous Lectern service to stop')
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    if (uninstall) { rmSync(path, { force: true }); return }
    mkdirSync(folder, { recursive: true })
    for (const file of ['service.log', 'service-error.log']) {
      writeFileSync(join(dir, file), '', { mode: 0o600 })
      chmodSync(join(dir, file), 0o600)
    }
    writeFileSync(path, servicePlist({ node: process.execPath, cli: join(staged, 'cli.mjs'),
      dir, port, envPath: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin' }), { mode: 0o600 })
    execFileSync('/bin/launchctl', ['bootstrap', domain, path], { stdio: 'pipe' })
  } catch (error) {
    if (staged) rmSync(staged, { recursive: true, force: true })
    if (previous) {
      writeFileSync(path, previous, { mode: 0o600 })
      try { execFileSync('/bin/launchctl', ['bootstrap', domain, path], { stdio: 'pipe' }) } catch { /* original error below */ }
    }
    throw error
  }
  for (const name of readdirSync(dir)) {
    if (/^runtime-[a-zA-Z0-9]{6}$/.test(name) && join(dir, name) !== staged) rmSync(join(dir, name), { recursive: true, force: true })
  }
}

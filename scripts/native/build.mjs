// macOS release builder. All subprocesses use argv, never interpolated shell commands.
import { cpSync, mkdirSync, readFileSync, writeFileSync, chmodSync, mkdtempSync, rmSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { VERSION } from '../../lectern-agent/native/session.mjs'
import { PROJECT } from '../paths.mjs'
const args = process.argv.slice(2)
const option = (key) => args.includes(key) ? args[args.indexOf(key) + 1] : undefined
const id = option('--extension-id'), archive = option('--node-archive'), release = args.includes('--release')
const unsignedRelease = args.includes('--unsigned-release')
if (release && unsignedRelease) throw new Error('Choose either signed --release or --unsigned-release')
const distribution = release ? 'signed' : unsignedRelease ? 'unsigned' : 'development'
const arch = option('--arch') ?? process.arch
const version = VERSION, nodeVersion = '24.13.0'
const hashes = { arm64: 'd595961e563fcae057d4a0fb992f175a54d97fcc4a14dc2d474d92ddeea3b9f8', x64: '6f03c1b48ddbe1b129a6f8038be08e0899f05f17185b4d3e4350180ab669a7f3' }
if (process.platform !== 'darwin' || !hashes[arch] || !/^[a-p]{32}$/.test(id ?? '') || !archive)
  throw new Error('Usage (macOS): node scripts/native/build.mjs --extension-id <32-letter ID> --node-archive <official Node v24.13.0 darwin tar.gz> [--arch arm64|x64] [--release|--unsigned-release]')
const appIdentity = process.env.LECTERN_APP_IDENTITY, installerIdentity = process.env.LECTERN_INSTALLER_IDENTITY, notaryProfile = process.env.LECTERN_NOTARY_PROFILE
if (release && (!appIdentity || !installerIdentity || !notaryProfile || !/^https:\/\//.test(process.env.LECTERN_DOWNLOAD_URL ?? '')))
  throw new Error('Release requires LECTERN_APP_IDENTITY, LECTERN_INSTALLER_IDENTITY, LECTERN_NOTARY_PROFILE and HTTPS LECTERN_DOWNLOAD_URL')
if (createHash('sha256').update(readFileSync(archive)).digest('hex') !== hashes[arch]) throw new Error('Node archive SHA-256 mismatch')
const out = resolve(PROJECT, 'release-artifacts'), work = mkdtempSync(join(tmpdir(), 'lectern-package-'))
const run = (cmd, argv) => execFileSync(cmd, argv, { stdio: 'inherit' })
const put = (path, data, mode = 0o644) => { mkdirSync(resolve(path, '..'), { recursive: true }); writeFileSync(path, data, { mode }); chmodSync(path, mode) }
try {
  mkdirSync(out, { recursive: true })
  run('/usr/bin/tar', ['-xzf', resolve(archive), '-C', work])
  const payload = join(work, 'payload'), app = join(payload, 'Applications/Lectern Companion.app'), contents = join(app, 'Contents')
  const resources = join(contents, 'Resources'), agent = join(resources, 'agent')
  mkdirSync(agent, { recursive: true })
  cpSync(join(work, `node-v${nodeVersion}-darwin-${arch}/bin/node`), join(resources, 'node'))
  cpSync(join(work, `node-v${nodeVersion}-darwin-${arch}/LICENSE`), join(resources, 'NODE-LICENSE'))
  for (const name of ['native', 'preferences.mjs', 'dialogs.mjs', 'LICENSE', 'THIRD-PARTY-NOTICES.md'])
    cpSync(join(PROJECT, 'lectern-agent', name), join(agent, name), { recursive: true })
  // Native Messaging does not ship the old HTTP/WebSocket server.
  for (const name of ['node-pty', 'node-addon-api']) {
    const source = join(PROJECT, 'lectern-agent/node_modules', name), dest = join(agent, 'node_modules', name)
    cpSync(source, dest, { recursive: true, filter: (path) => !path.includes('/prebuilds/') || path.includes(`/prebuilds/darwin-${arch}`) })
  }
  const helper = join(agent, `node_modules/node-pty/prebuilds/darwin-${arch}/spawn-helper`)
  chmodSync(helper, 0o755)
  const origin = `chrome-extension://${id}/`
  put(join(agent, 'native-release.json'), JSON.stringify({ allowed_origins: [origin] }))
  put(join(agent, 'distribution.json'), JSON.stringify({ version, arch, extensionId: id, distribution, nodeVersion }, null, 2) + '\n')
  put(join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.lectern.companion</string><key>CFBundleName</key><string>Lectern Companion</string><key>CFBundleExecutable</key><string>lectern-agent</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>${version}</string><key>CFBundleVersion</key><string>${version}</string><key>LSUIElement</key><true/><key>LSMinimumSystemVersion</key><string>13.5</string></dict></plist>`)
  put(join(contents, 'MacOS/lectern-agent'), '#!/bin/sh\nbase="$(CDPATH= cd -- "$(dirname -- "$0")/../Resources" && pwd)"\nexec "$base/node" "$base/agent/native/host.mjs" "$@"\n', 0o755)
  const manifest = { name: 'com.lectern.agent', description: 'Lectern local terminal', path: '/Applications/Lectern Companion.app/Contents/MacOS/lectern-agent', type: 'stdio', allowed_origins: [origin] }
  put(join(payload, 'Library/Google/Chrome/NativeMessagingHosts/com.lectern.agent.json'), JSON.stringify(manifest, null, 2))
  // Explicit uninstall entry, invoked by the user; keeps CLI installations and preferences.
  put(join(resources, 'Uninstall.command'), '#!/bin/sh\n/usr/bin/osascript <<\'APPLESCRIPT\'\ndisplay dialog "卸载 Lectern 伴随程序？项目关联与 AI CLI 将保留。请先关闭终端面板。" buttons {"取消", "卸载"} default button "取消" cancel button "取消"\ndo shell script "/bin/rm -f /Library/Google/Chrome/NativeMessagingHosts/com.lectern.agent.json && /bin/rm -rf \\"/Applications/Lectern Companion.app\\" && /usr/sbin/pkgutil --forget com.lectern.companion" with administrator privileges\nAPPLESCRIPT\n', 0o755)
  // Reject accidental Homebrew linkage in the shipped runtime.
  const linkage = execFileSync('/usr/bin/otool', ['-L', join(resources, 'node')], { encoding: 'utf8' })
  if (/homebrew|\/usr\/local\/opt\//i.test(linkage)) throw new Error('Runtime is not portable')
  if (release) {
    const entitlements = join(work, 'entitlements.plist')
    put(entitlements, '<?xml version="1.0"?><plist version="1.0"><dict><key>com.apple.security.cs.allow-jit</key><true/><key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/></dict></plist>')
    const sign = (path) => run('/usr/bin/codesign', ['--force', '--timestamp', '--options', 'runtime', '--entitlements', entitlements, '--sign', appIdentity, path])
    const walk = (path) => { for (const file of readdirSync(path)) { const child = join(path, file); if (statSync(child).isDirectory()) walk(child); else if (file.endsWith('.node') || file === 'spawn-helper') sign(child) } }
    walk(agent); sign(join(resources, 'node')); sign(app)
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app])
  }
  const pkg = join(out, `Lectern-Companion-${version}-macOS-${arch}${release ? '' : unsignedRelease ? '-UNSIGNED' : '-UNSIGNED-DEV'}.pkg`)
  const components = join(work, 'components.plist')
  put(components, '<?xml version="1.0"?><plist version="1.0"><array><dict><key>RootRelativeBundlePath</key><string>Applications/Lectern Companion.app</string><key>BundleIsRelocatable</key><false/><key>BundleIsVersionChecked</key><true/><key>BundleHasStrictIdentifier</key><true/><key>BundleOverwriteAction</key><string>upgrade</string></dict></array></plist>')
  run('/usr/bin/pkgbuild', ['--root', payload, '--component-plist', components, '--identifier', 'com.lectern.companion', '--version', version, '--install-location', '/', ...(release ? ['--sign', installerIdentity] : []), pkg])
  if (release) {
    run('/usr/bin/xcrun', ['notarytool', 'submit', pkg, '--keychain-profile', notaryProfile, '--wait'])
    run('/usr/bin/xcrun', ['stapler', 'staple', pkg])
    run('/usr/bin/xcrun', ['stapler', 'validate', pkg])
    run('/usr/sbin/spctl', ['--assess', '--type', 'install', '--verbose', pkg])
  }
  const appOut = join(out, 'Lectern Companion.app')
  rmSync(appOut, { recursive: true, force: true }); cpSync(app, appOut, { recursive: true })
  writeFileSync(`${pkg}.sha256`, `${createHash('sha256').update(readFileSync(pkg)).digest('hex')}  ${pkg.split('/').pop()}\n`)
  console.log(`Built ${pkg}\nBound extension: ${id}\n${release ? 'Signed, notarized and stapled' : unsignedRelease ? 'UNSIGNED: no Developer ID signature or Apple notarization; GitHub download requires user-managed macOS approval' : 'DEVELOPMENT ONLY: unsigned, not a Web Store release'}`)
} finally { rmSync(work, { recursive: true, force: true }) }

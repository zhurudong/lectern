// node-pty 1.1.0's macOS prebuilt spawn-helper arrives without an executable
// bit. Fix the installed dependency at installation time, not every spawn.
// Keep node-pty pinned until this packaging workaround can be removed.
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { chmodSync, existsSync, statSync } from 'node:fs'
if (process.platform === 'darwin') {
  const require = createRequire(import.meta.url)
  const root = dirname(require.resolve('node-pty/package.json'))
  for (const dir of ['build/Release', 'build/Debug', `prebuilds/darwin-${process.arch}`]) {
    const helper = join(root, dir, 'spawn-helper')
    if (existsSync(helper)) chmodSync(helper, statSync(helper).mode | 0o111)
  }
}

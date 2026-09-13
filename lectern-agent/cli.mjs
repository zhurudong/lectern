#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { startServer } from './server.mjs'
import { preferences } from './preferences.mjs'
import { confirmPairing, chooseProject } from './dialogs.mjs'
import { manageService } from './service.mjs'

try {
  const { values } = parseArgs({ options: { origin: { type: 'string' }, port: { type: 'string', default: '8137' },
    install: { type: 'boolean' }, uninstall: { type: 'boolean' }, help: { type: 'boolean' } } })
  if (values.help) {
    console.log('lectern-agent [--install | --uninstall] [--port 8137]\nmacOS: --install starts the companion now and at login. Open the AI panel to pair via local confirmation.\n--origin chrome-extension://<id> optionally migrates an existing v1 token.')
  } else {
    const port = Number(values.port)
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port')
    if (values.install && values.uninstall) throw new Error('Choose --install or --uninstall')
    const dir = join(homedir(), '.lectern-agent')
    const prefs = preferences(dir)
    if (values.origin) {
      if (!/^chrome-extension:\/\/[a-p]{32}$/.test(values.origin)) throw new Error('Invalid extension Origin')
      if (!prefs.token(values.origin)) {
        const token = readFileSync(join(dir, 'token'), 'utf8').trim()
        if (token.length < 32) throw new Error('Invalid v1 token')
        prefs.pair(values.origin, token)
      }
    }
    if (values.install || values.uninstall) {
      await manageService({ uninstall: !!values.uninstall, port, dir })
      console.log(values.uninstall ? 'Lectern login service removed. Pairing and project associations are retained.' : 'Lectern installed and started; it will restart at login. Open the AI terminal panel to connect.')
    } else {
      const server = await startServer({ port, preferences: prefs, confirmPairing, chooseProject })
      console.log(`Lectern companion listening on 127.0.0.1:${server.port}\nOpen the AI terminal panel. Pairing and project selection use local confirmation dialogs.\nAgent runs with your user privileges and can modify files.`)
      for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void server.close().then(() => process.exit(0)) })
    }
  }
} catch (error) { console.error(error.message); process.exitCode = 1 }

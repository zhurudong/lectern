import { mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync, realpathSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'

export function preferences(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  chmodSync(dir, 0o700)
  const path = join(dir, 'preferences.json')
  let state = { version: 1, origins: {}, projects: {} }
  try {
    state = JSON.parse(readFileSync(path, 'utf8'))
    if (state.version !== 1 || !state.origins || !state.projects) throw new Error('Invalid companion preferences')
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  const save = () => {
    const temp = `${path}.tmp`
    writeFileSync(temp, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 })
    chmodSync(temp, 0o600)
    renameSync(temp, path)
  }
  const projectPath = (origin, id) => join(dir, `project-${createHash('sha256').update(`${origin}:${id}`).digest('hex')}.json`)
  return {
    token(origin) { return state.origins[origin] },
    pair(origin, token = randomBytes(32).toString('hex')) { state.origins[origin] = token; save(); return token },
    project(origin, id) {
      try { return JSON.parse(readFileSync(projectPath(origin, id), 'utf8')).cwd }
      catch (error) { if (error.code !== 'ENOENT') throw error }
      return state.projects[`${origin}:${id}`]
    },
    bind(origin, id, cwd) {
      const path = realpathSync(cwd)
      if (!statSync(path).isDirectory()) throw new Error('Not a directory')
      // One atomic file per association: independent native hosts cannot
      // overwrite another project's updates with a stale global snapshot.
      const target = projectPath(origin, id), temp = `${target}.${randomBytes(8).toString('hex')}.tmp`
      writeFileSync(temp, JSON.stringify({ cwd: path }) + '\n', { mode: 0o600 })
      renameSync(temp, target)
      return path
    },
  }
}

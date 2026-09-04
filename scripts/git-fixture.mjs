import { spawnSync } from 'node:child_process'
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'

const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_AUTHOR_NAME: 'Lectern Fixture',
  GIT_AUTHOR_EMAIL: 'fixture@lectern.invalid',
  GIT_COMMITTER_NAME: 'Lectern Fixture',
  GIT_COMMITTER_EMAIL: 'fixture@lectern.invalid',
  LC_ALL: 'C',
  TZ: 'UTC',
}

function inside(root, path) {
  const full = resolve(root, path)
  if (full !== root && !full.startsWith(root + sep)) {
    throw new Error(`Fixture path escapes repository: ${path}`)
  }
  return full
}

export function runGit(cwd, args, { env = {}, encoding = 'utf8', input } = {}) {
  const result = spawnSync('git', args, {
    cwd,
    env: { ...GIT_ENV, ...env },
    encoding,
    input,
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.status !== 0) {
    const stderr = Buffer.isBuffer(result.stderr) ? result.stderr.toString('utf8') : result.stderr
    throw new Error(`git ${args.join(' ')} failed (${result.status}): ${stderr}`)
  }
  return result.stdout
}

/** Read exact object bodies through Git's binary `cat-file --batch` protocol. */
export function catFileBatch(cwd, oids) {
  const output = runGit(cwd, ['cat-file', '--batch'], {
    encoding: null,
    input: Buffer.from(`${oids.join('\n')}\n`),
  })
  const objects = new Map()
  let offset = 0
  for (const requestedOid of oids) {
    const headerEnd = output.indexOf(0x0a, offset)
    if (headerEnd < 0) throw new Error('git cat-file --batch returned a truncated header')
    const header = output.subarray(offset, headerEnd).toString('ascii')
    const match = /^([0-9a-f]{40}) (commit|tree|blob|tag) ([0-9]+)$/.exec(header)
    if (!match || match[1] !== requestedOid) throw new Error(`Unexpected cat-file batch header: ${header}`)
    const size = Number(match[3])
    const bodyStart = headerEnd + 1
    const bodyEnd = bodyStart + size
    if (bodyEnd >= output.length || output[bodyEnd] !== 0x0a) {
      throw new Error(`git cat-file --batch returned a truncated ${match[2]} body`)
    }
    objects.set(requestedOid, { oid: match[1], type: match[2], size, body: output.subarray(bodyStart, bodyEnd) })
    offset = bodyEnd + 1
  }
  if (offset !== output.length) throw new Error('git cat-file --batch returned trailing bytes')
  return objects
}

/**
 * Create a deterministic, isolated Git repository for oracle comparisons.
 * No global/system config participates, and commit identities/dates are fixed.
 */
export function createGitOracleRepo(prefix = 'lectern-git-oracle-') {
  const fixtureRoot = mkdtempSync(join(tmpdir(), prefix))
  const repo = join(fixtureRoot, 'repo')
  mkdirSync(repo)
  runGit(repo, ['init', '--initial-branch=main'])

  let commitSequence = 0
  return {
    path: repo,
    git: (args, options) => runGit(repo, args, options),
    write(path, contents) {
      const full = inside(repo, path)
      mkdirSync(dirname(full), { recursive: true })
      writeFileSync(full, contents)
    },
    commit(message) {
      commitSequence++
      const seconds = String(commitSequence).padStart(2, '0')
      const date = `2000-01-01T00:00:${seconds}Z`
      runGit(repo, ['add', '-A'])
      runGit(repo, ['commit', '-m', message], {
        env: { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
      })
      return runGit(repo, ['rev-parse', 'HEAD']).trim()
    },
  }
}

/** Serialize every regular file, including `.git`, without interpreting bytes. */
export function snapshotDirectory(root) {
  const files = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      const info = lstatSync(full)
      if (info.isDirectory()) {
        walk(full)
      } else if (info.isFile()) {
        files.push({
          path: relative(root, full).split(sep).join('/'),
          base64: readFileSync(full).toString('base64'),
        })
      }
    }
  }
  walk(root)
  files.sort((a, b) => a.path.localeCompare(b.path))
  return files
}

/**
 * Copy a Node-created Git fixture into a Chrome page's OPFS root.
 * The test harness can then pass the returned directory handle to `__cv.enterProject`.
 */
export async function installGitFixtureInOpfs(page, sourceDir, directoryName = 'git-project') {
  const files = snapshotDirectory(sourceDir)
  await page.evaluate(
    async ({ entries, targetName }) => {
      const opfs = await navigator.storage.getDirectory()
      try {
        await opfs.removeEntry(targetName, { recursive: true })
      } catch (error) {
        if (!(error instanceof DOMException) || error.name !== 'NotFoundError') throw error
      }
      const target = await opfs.getDirectoryHandle(targetName, { create: true })
      for (const entry of entries) {
        const parts = entry.path.split('/')
        const name = parts.pop()
        if (!name) throw new Error(`Invalid fixture path: ${entry.path}`)
        let dir = target
        for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true })
        const handle = await dir.getFileHandle(name, { create: true })
        const writable = await handle.createWritable()
        const raw = atob(entry.base64)
        const bytes = new Uint8Array(raw.length)
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
        await writable.write(bytes)
        await writable.close()
      }
    },
    { entries: files, targetName: directoryName },
  )
  return directoryName
}

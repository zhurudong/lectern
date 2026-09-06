import { gitError } from './errors'
import { isAbsoluteFsPath, tryNormalizeRelativePath, type ReadOnlyFsa } from './fsa'

async function readOptionalText(git: ReadOnlyFsa, path: string, maxBytes = 64 * 1024): Promise<string | null> {
  try {
    return await git.readText(path, maxBytes)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return null
    throw error
  }
}

function configValue(config: string, section: string, key: string): string | null {
  let current = ''
  for (const rawLine of config.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || line.startsWith(';')) continue
    const header = /^\[([^\] "\t]+)(?:\s+"[^"]*")?\]$/.exec(line)
    if (header) {
      current = header[1].toLowerCase()
      continue
    }
    if (current !== section.toLowerCase()) continue
    const assignment = /^([^=\s]+)\s*(?:=\s*(.*))?$/.exec(line)
    if (assignment?.[1].toLowerCase() === key.toLowerCase()) return (assignment[2] ?? 'true').trim().toLowerCase()
  }
  return null
}

export async function assertSupportedRepositoryShape(git: ReadOnlyFsa): Promise<void> {
  const config = await readOptionalText(git, 'config')
  if (config && configValue(config, 'extensions', 'objectformat') === 'sha256') {
    throw gitError('unsupported-object-format', {}, 'SHA-256 repositories are not supported')
  }
  const alternates = await readOptionalText(git, 'objects/info/alternates')
  if (alternates) {
    for (const raw of alternates.split(/\r?\n/)) {
      const path = raw.trim()
      if (!path) continue
      if (isAbsoluteFsPath(path) || tryNormalizeRelativePath(`objects/${path}`) == null) {
        throw gitError('external-alternates', {}, 'Object alternates escape the authorized Git directory')
      }
    }
  }
}

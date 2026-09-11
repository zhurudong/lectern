import { KIND, type RawSymbol } from './symbols'

type Token = { text: string; word?: string; kind: 'word' | 'name' | 'literal' | 'punct' | 'end' | 'boundary'; line: number }

const OBJECTS = new Set(['TABLE', 'VIEW', 'INDEX', 'FUNCTION', 'PROCEDURE', 'PROC', 'TRIGGER', 'SCHEMA', 'DATABASE', 'SEQUENCE', 'TYPE'])
const CREATE_MODIFIERS = new Set(['TEMP', 'TEMPORARY', 'GLOBAL', 'LOCAL', 'UNLOGGED', 'UNIQUE', 'CLUSTERED', 'NONCLUSTERED', 'RECURSIVE', 'FORCE', 'NOFORCE', 'EDITIONABLE', 'NONEDITIONABLE'])
const OPERATIONS = new Set(['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'ALTER', 'DROP', 'TRUNCATE'])

/** A small lexical boundary scanner, not a SQL validator. Quoted bodies remain opaque. */
function tokenize(text: string): Token[] {
  const out: Token[] = []
  let i = 0, line = 1, lineStart = 0, delimiter = ';'
  const move = (end: number) => {
    while (i < end) {
      if (text[i++] === '\n') { line++; lineStart = i }
    }
  }
  while (i < text.length) {
    if (/\s/.test(text[i])) { move(i + 1); continue }
    const start = i, tokenLine = line
    if (/^\s*$/.test(text.slice(lineStart, i))) {
      const end = text.indexOf('\n', i)
      const lineEnd = end < 0 ? text.length : end
      const rest = text.slice(i, lineEnd).trim()
      const directive = /^DELIMITER\s+(\S+)$/i.exec(rest)
      if (directive || /^(?:GO(?:\s+\d+)?|\/)\s*(?:--.*)?$/i.test(rest)) {
        out.push({ text: '', kind: 'boundary', line })
        if (directive) delimiter = directive[1]
        move(lineEnd)
        continue
      }
    }
    if (text.startsWith('--', i) || (text[i] === '#' && (/^\s*$/.test(text.slice(lineStart, i)) || /\s/.test(text[i + 1] ?? '')))) {
      const end = text.indexOf('\n', i)
      move(end < 0 ? text.length : end)
      continue
    }
    // psql commands are client-side syntax; \g/\gexec also terminate an SQL query.
    if (text[i] === '\\' && /[A-Za-z.]/.test(text[i + 1] ?? '')) {
      out.push({ text: '', kind: 'boundary', line })
      const end = text.indexOf('\n', i)
      move(end < 0 ? text.length : end)
      continue
    }
    if (text.startsWith('/*', i)) {
      let end = i + 2, depth = 1
      while (end < text.length && depth) {
        if (text.startsWith('/*', end)) { depth++; end += 2 }
        else if (text.startsWith('*/', end)) { depth--; end += 2 }
        else end++
      }
      move(end)
      continue
    }
    if (text.startsWith(delimiter, i)) {
      out.push({ text: delimiter, kind: delimiter === ';' ? 'end' : 'boundary', line })
      move(i + delimiter.length)
      continue
    }
    const quote = text[i]
    if (quote === "'" || quote === '"' || quote === '`' || quote === '[') {
      const close = quote === '[' ? ']' : quote
      // Use standard SQL quoting by default. Only PostgreSQL E'...' explicitly
      // enables backslash escapes; MySQL's session-dependent mode is ambiguous.
      const escapes = quote === "'" && /[eE]/.test(text[i - 1] ?? '') &&
        (i < 2 || !/[\w#$\u0080-\uffff]/.test(text[i - 2]))
      let end = i + 1
      while (end < text.length) {
        if (text[end] === close) {
          if (text[end + 1] === close) { end += 2; continue }
          end++; break
        }
        if (text[end] === '\\' && escapes) end += 2
        else end++
      }
      end = Math.min(end, text.length)
      out.push({ text: quote === "'" ? '' : text.slice(i, end), kind: quote === "'" ? 'literal' : 'name', line })
      move(end)
      continue
    }
    if (quote === '$') {
      const tag = /^\$(?:[A-Za-z_][\w]*)?\$/.exec(text.slice(i))?.[0]
      if (tag) {
        const close = text.indexOf(tag, i + tag.length)
        out.push({ text: '', kind: 'literal', line })
        move(close < 0 ? text.length : close + tag.length)
        continue
      }
    }
    if (/[A-Za-z_#$\u0080-\uffff]/.test(quote)) {
      let end = i + 1
      while (end < text.length && /[\w#$\u0080-\uffff]/.test(text[end]) &&
        !(delimiter !== ';' && text.startsWith(delimiter, end))) end++
      const value = text.slice(i, end)
      out.push({ text: value, word: value.toUpperCase(), kind: 'word', line })
      move(end)
      continue
    }
    if (/\d/.test(quote) || (quote === '.' && /\d/.test(text[i + 1] ?? ''))) {
      const number = /^(?:0[xX][0-9a-fA-F]+|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)/.exec(text.slice(i))![0]
      out.push({ text: '', kind: 'literal', line })
      move(i + number.length)
      continue
    }
    out.push({ text: text[start], kind: 'punct', line: tokenLine })
    move(i + 1)
  }
  return out
}

function createHeader(tokens: Token[]): { type: string; next: number } | null {
  if (tokens[0]?.word !== 'CREATE') return null
  let i = 1
  if (tokens[i]?.word === 'OR' && ['REPLACE', 'ALTER'].includes(tokens[i + 1]?.word ?? '')) i += 2
  while (CREATE_MODIFIERS.has(tokens[i]?.word ?? '')) i++
  let type = tokens[i]?.word ?? ''
  if (type === 'MATERIALIZED' && tokens[i + 1]?.word === 'VIEW') { type = 'MATERIALIZED VIEW'; i++ }
  else if (!OBJECTS.has(type)) return null
  return { type: type === 'PROC' ? 'PROCEDURE' : type, next: i + 1 }
}

function skipNameModifiers(tokens: Token[], start: number): number {
  let i = start
  if (tokens[i]?.word === 'CONCURRENTLY') i++
  if (tokens[i]?.word === 'IF') {
    i++
    if (tokens[i]?.word === 'NOT') i++
    if (tokens[i]?.word === 'EXISTS') i++
  }
  if (tokens[i]?.word === 'ONLY') i++
  return i
}

function objectName(tokens: Token[], start: number): string | null {
  let i = skipNameModifiers(tokens, start)
  const isName = (token: Token | undefined) => token?.kind === 'word' || token?.kind === 'name'
  if (!isName(tokens[i])) return null
  let name = tokens[i++].text
  while (tokens[i]?.text === '.') {
    // SQL Server permits database..table as well as schema.table.
    const next = tokens[i + 1]?.text === '.' ? i + 2 : i + 1
    if (!isName(tokens[next])) break
    name += (next === i + 2 ? '..' : '.') + tokens[next].text
    i = next + 1
  }
  return name
}

function topLevelWord(tokens: Token[], word: string, from: number): number {
  let depth = 0
  for (let i = from; i < tokens.length; i++) {
    if (tokens[i].text === '(') depth++
    else if (tokens[i].text === ')') depth--
    else if (depth === 0 && tokens[i].word === word) return i
  }
  return -1
}

function describe(tokens: Token[]): string | null {
  const definition = createHeader(tokens)
  if (definition) {
    const name = objectName(tokens, definition.next)
    return name ? `${definition.type} ${name}` : null
  }
  let command = 0
  if (tokens[0]?.word === 'WITH') {
    // CTE definitions (including data-modifying CTEs) live inside parentheses.
    let depth = 0
    command = -1
    for (let i = 1; i < tokens.length; i++) {
      if (tokens[i].text === '(') depth++
      else if (tokens[i].text === ')') depth--
      else if (depth === 0 && OPERATIONS.has(tokens[i].word ?? '')) { command = i; break }
    }
  }
  const operation = tokens[command]?.word ?? ''
  if (!OPERATIONS.has(operation)) return null
  let label = operation, target = command + 1
  if (operation === 'SELECT' || operation === 'DELETE') {
    const from = topLevelWord(tokens, 'FROM', command + 1)
    target = from < 0 ? tokens.length : from + 1
  } else if (operation === 'INSERT' || operation === 'MERGE') {
    const into = topLevelWord(tokens, 'INTO', command + 1)
    if (into >= 0) target = into + 1
  } else if (operation === 'ALTER' || operation === 'DROP' || operation === 'TRUNCATE') {
    if (tokens[target]?.word === 'MATERIALIZED' && tokens[target + 1]?.word === 'VIEW') {
      label += ' MATERIALIZED VIEW'; target += 2
    } else if (OBJECTS.has(tokens[target]?.word ?? '')) label += ` ${tokens[target++].word}`
  }
  const name = objectName(tokens, target)
  return name ? `${label} ${name}` : label
}

/** File navigation only: one entry per top-level definition or query, no SQL name resolution. */
export function extractSqlOutline(text: string): RawSymbol[] {
  const tokens = tokenize(text)
  const out: RawSymbol[] = []
  let statement: Token[] = [], depth = 0, blocks = 0, routine = false
  let unquotedBody = false, blockSeen = false
  const finish = () => {
    const name = describe(statement)
    if (name) out.push({ name, kind: KIND.sql, line: statement[0].line, container: null })
    statement = []; depth = 0; blocks = 0; routine = false
    unquotedBody = false; blockSeen = false
  }
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token.kind === 'boundary') { finish(); continue }
    if (token.kind === 'end' && depth === 0 && blocks === 0 && (!unquotedBody || blockSeen)) { finish(); continue }
    statement.push(token)
    if (statement.length <= 16) {
      const header = createHeader(statement)
      routine = !!header && ['FUNCTION', 'PROCEDURE', 'TRIGGER'].includes(header.type)
    }
    if (token.text === '(') depth++
    else if (token.text === ')') depth = Math.max(0, depth - 1)
    // BEGIN/CASE own END. END IF/LOOP/WHILE/REPEAT close control flow, not BEGIN.
    // Do not count BEGIN TRANSACTION, which is closed by COMMIT/ROLLBACK.
    if (routine && depth === 0) {
      const next = tokens[i + 1]?.word ?? ''
      // AS/IS followed by unquoted code can contain declarations before BEGIN,
      // or a SQL Server procedure body extending to the next GO batch boundary.
      if (token.word === 'AS' || token.word === 'IS' || token.word === 'DECLARE') {
        const body = next === 'E' || next === 'N' ? tokens[i + 2] : tokens[i + 1]
        if (body?.kind !== 'literal') unquotedBody = true
      }
      if (token.word === 'BEGIN' && !['TRANSACTION', 'TRAN', 'WORK'].includes(next)) { blocks++; blockSeen = true }
      else if (token.word === 'CASE' && tokens[i - 1]?.word !== 'END') blocks++
      else if (token.word === 'END' && !['IF', 'LOOP', 'WHILE', 'REPEAT'].includes(next)) blocks = Math.max(0, blocks - 1)
    }
  }
  finish()
  return out
}

import type { Extension } from '@codemirror/state'
import type { Parser } from '@lezer/common'
import { StreamLanguage } from '@codemirror/language'
import { python } from '@codemirror/lang-python'
import { java } from '@codemirror/lang-java'
import { cpp } from '@codemirror/lang-cpp'
import { go } from '@codemirror/lang-go'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { sql } from '@codemirror/lang-sql'
import { yaml } from '@codemirror/lang-yaml'
import { xml } from '@codemirror/lang-xml'
import { markdown } from '@codemirror/lang-markdown'
import { shell } from '@codemirror/legacy-modes/mode/shell'
// CSS 家族用 legacy-modes 的**专用**模式,不是拿 css 近似顶替 ——
// 既然有一等模式,就不必制造一个需要向用户解释的"近似高亮"。零新增依赖。
import { sCSS, less } from '@codemirror/legacy-modes/mode/css'
import { sass } from '@codemirror/legacy-modes/mode/sass'
// Rust / PHP 有官方 Lezer 语法包,走一等语法树通道(与 Go/TS 同),而非 legacy-modes 近似。
import { rust } from '@codemirror/lang-rust'
import { php } from '@codemirror/lang-php'
import { ruby } from '@codemirror/legacy-modes/mode/ruby'
import { kotlin, csharp } from '@codemirror/legacy-modes/mode/clike'
import { groovy } from '@codemirror/legacy-modes/mode/groovy'
import { toml } from '@codemirror/legacy-modes/mode/toml'
// 注意导出名是 dockerFile(大写 F),不是 dockerfile
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile'
import { cmake } from '@codemirror/legacy-modes/mode/cmake'

// 语言 id → CodeMirror 语言扩展(design.md D2):
// 目标语言均用官方 Lezer 包;Shell 无一等 Lezer 包,经 legacy-modes 的 stream 解析器接入。

export function languageExtension(id?: string): Extension {
  switch (id) {
    case 'python':
      return python()
    case 'java':
      return java()
    case 'c':
    case 'cpp':
      return cpp()
    case 'go':
      return go()
    case 'javascript':
      return javascript()
    case 'jsx':
      return javascript({ jsx: true })
    case 'typescript':
      return javascript({ typescript: true })
    case 'tsx':
      return javascript({ typescript: true, jsx: true })
    case 'json':
      return json()
    case 'html':
      return html()
    case 'css':
      return css()
    case 'scss':
      return StreamLanguage.define(sCSS)
    case 'sass':
      return StreamLanguage.define(sass)
    case 'less':
      return StreamLanguage.define(less)
    case 'sql':
      return sql()
    case 'yaml':
      return yaml()
    case 'xml':
      return xml()
    case 'markdown':
      return markdown()
    case 'shell':
      return StreamLanguage.define(shell)
    case 'rust':
      return rust()
    case 'php':
      // 顶层无需 <?php 包裹也能高亮:多数 .php 文件确实以 <?php 开头,plain 模式两者兼容
      return php()
    case 'ruby':
      return StreamLanguage.define(ruby)
    case 'kotlin':
      return StreamLanguage.define(kotlin)
    case 'csharp':
      return StreamLanguage.define(csharp)
    case 'groovy':
      return StreamLanguage.define(groovy)
    case 'toml':
      return StreamLanguage.define(toml)
    case 'docker':
      return StreamLanguage.define(dockerFile)
    case 'cmake':
      return StreamLanguage.define(cmake)
    // Vue / Svelte 是 HTML 超集的单文件组件:走 html 通道的**近似**高亮,
    // UI 上由「近似高亮」徽标明示(见 lib/filetypes.ts 的 APPROXIMATE)
    case 'vue':
    case 'svelte':
      return html()
    default:
      return []
  }
}

// —— 供 Markdown 代码块静态高亮使用(design.md D3):按语言取 Lezer parser ——

const parserCache = new Map<string, Parser | null>()

export function languageParser(id: string): Parser | null {
  let cached = parserCache.get(id)
  if (cached === undefined) {
    switch (id) {
      case 'python': cached = python().language.parser; break
      case 'java': cached = java().language.parser; break
      case 'c':
      case 'cpp': cached = cpp().language.parser; break
      case 'go': cached = go().language.parser; break
      case 'javascript': cached = javascript().language.parser; break
      case 'jsx': cached = javascript({ jsx: true }).language.parser; break
      case 'typescript': cached = javascript({ typescript: true }).language.parser; break
      case 'tsx': cached = javascript({ typescript: true, jsx: true }).language.parser; break
      case 'json': cached = json().language.parser; break
      case 'html': cached = html().language.parser; break
      case 'css': cached = css().language.parser; break
      case 'scss': cached = StreamLanguage.define(sCSS).parser; break
      case 'sass': cached = StreamLanguage.define(sass).parser; break
      case 'less': cached = StreamLanguage.define(less).parser; break
      case 'sql': cached = sql().language.parser; break
      case 'yaml': cached = yaml().language.parser; break
      case 'xml': cached = xml().language.parser; break
      case 'markdown': cached = markdown().language.parser; break
      case 'shell': cached = StreamLanguage.define(shell).parser; break
      case 'rust': cached = rust().language.parser; break
      case 'php': cached = php().language.parser; break
      case 'ruby': cached = StreamLanguage.define(ruby).parser; break
      case 'kotlin': cached = StreamLanguage.define(kotlin).parser; break
      case 'csharp': cached = StreamLanguage.define(csharp).parser; break
      case 'groovy': cached = StreamLanguage.define(groovy).parser; break
      case 'toml': cached = StreamLanguage.define(toml).parser; break
      case 'docker': cached = StreamLanguage.define(dockerFile).parser; break
      case 'cmake': cached = StreamLanguage.define(cmake).parser; break
      case 'vue':
      case 'svelte': cached = html().language.parser; break
      default: cached = null
    }
    parserCache.set(id, cached)
  }
  return cached
}

/** Markdown 代码块围栏语言名 → 语言 id(常见别名归一) */
export function normalizeFenceLang(lang: string): string | null {
  const l = lang.trim().toLowerCase()
  if (!l) return null
  const alias: Record<string, string> = {
    py: 'python', python: 'python', python3: 'python',
    java: 'java',
    c: 'c', 'c++': 'cpp', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', h: 'c', hpp: 'cpp',
    go: 'go', golang: 'go',
    js: 'javascript', javascript: 'javascript', mjs: 'javascript', cjs: 'javascript', node: 'javascript',
    jsx: 'jsx',
    ts: 'typescript', typescript: 'typescript',
    tsx: 'tsx',
    json: 'json', jsonc: 'json',
    html: 'html', htm: 'html',
    css: 'css',
    scss: 'scss', sass: 'sass', less: 'less',
    rust: 'rust', rs: 'rust',
    php: 'php', php3: 'php', php4: 'php', php5: 'php', phtml: 'php',
    ruby: 'ruby', rb: 'ruby',
    kotlin: 'kotlin', kt: 'kotlin', kts: 'kotlin',
    csharp: 'csharp', cs: 'csharp', 'c#': 'csharp',
    groovy: 'groovy', gradle: 'groovy',
    toml: 'toml',
    docker: 'docker', dockerfile: 'docker',
    cmake: 'cmake',
    vue: 'vue', svelte: 'svelte',
    sql: 'sql',
    yaml: 'yaml', yml: 'yaml',
    xml: 'xml', svg: 'xml',
    md: 'markdown', markdown: 'markdown',
    sh: 'shell', bash: 'shell', zsh: 'shell', shell: 'shell', console: 'shell',
  }
  return alias[l] ?? null
}

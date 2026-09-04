// 文件类型识别(file-preview spec):扩展名 → 渲染通道/语言;
// 无扩展名或未知扩展名时由内容嗅探决定(NUL/不可打印字符比例、shebang)。

export type Channel = 'code' | 'markdown' | 'image' | 'binary' | 'text'

export interface FileTypeInfo {
  channel: Channel
  /** CodeMirror 语言 id(见 preview/languages.ts) */
  language?: string
}

/** 代码扩展名 → 语言 id */
const CODE_EXT: Record<string, string> = {
  py: 'python',
  pyi: 'python',
  java: 'java',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  hh: 'cpp',
  hxx: 'cpp',
  go: 'go',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  json: 'json',
  jsonc: 'json',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  sass: 'sass',
  less: 'less',
  sql: 'sql',
  yaml: 'yaml',
  yml: 'yaml',
  xml: 'xml',
  svg: 'xml', // 注意:.svg 走图片通道,此行仅用于"以文本方式识别语言"的兜底(不会命中)
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  // Rust / PHP 有官方 Lezer 语法(@lezer/rust、@lezer/php),已升到"可跳转"档 ——
  // 与 Go/TS 同一条通道(真语法树 + 符号抽取),不是 StreamLanguage 的近似。
  rs: 'rust',
  php: 'php',
  php3: 'php',
  php4: 'php',
  php5: 'php',
  phtml: 'php',
  // 以下仍是"仅高亮"档:legacy-modes 的 StreamLanguage 只产扁平树,无法抽符号。
  // Ruby / Kotlin / C# 目前 npm 上没有一等 Lezer 语法,升不到可跳转(见 docs/language-support.md)。
  rb: 'ruby',
  kt: 'kotlin',
  kts: 'kotlin',
  cs: 'csharp',
  // .gradle 用的就是 groovy 模式,所以 .groovy 一并加 ——
  // 同一个模式不能一半算加、一半算不加
  gradle: 'groovy',
  groovy: 'groovy',
  toml: 'toml',
  // 单文件组件:走 html 通道的**近似**高亮,UI 上必须明示是近似
  vue: 'vue',
  svelte: 'svelte',
}

/**
 * 整文件名 → 类型(**先于**扩展名匹配)。
 *
 * 这是机制升级而不只是加条目:`Dockerfile` 根本没有扩展名,靠扩展名表永远匹配不到;
 * `CMakeLists.txt` 的 `.txt` 还会被误判成纯文本。机制有了以后,再加整名文件就只是加数据。
 * 键统一小写;`Dockerfile.dev` 这类变体按"第一个点之前"归一。
 */
const WHOLE_NAME: Record<string, { channel: Channel; language?: string }> = {
  dockerfile: { channel: 'code', language: 'docker' },
  'cmakelists.txt': { channel: 'code', language: 'cmake' },
  // Makefile 没有可用的专用模式:按纯文本展示,但给确定的文件类型(图标不再靠嗅探)。
  // **MUST NOT 借 shell 之类假装有 makefile 高亮** —— target、.PHONY、变量展开都会错,
  // 那是把"缺失"换成"含糊"。
  makefile: { channel: 'text' },
  gnumakefile: { channel: 'text' },
}

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'])

/** 明确的二进制扩展名(不做嗅探,直接降级) */
const BINARY_EXT = new Set([
  'exe', 'dll', 'so', 'dylib', 'bin', 'o', 'a', 'class', 'jar', 'war',
  'zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst', '7z', 'rar',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'ico', 'icns', 'bmp', 'tiff', 'heic', 'avif',
  'mp3', 'mp4', 'mov', 'avi', 'mkv', 'wav', 'flac', 'ogg',
  'ttf', 'otf', 'woff', 'woff2', 'eot',
  'db', 'sqlite', 'wasm', 'pyc', 'node',
])

/** 常见纯文本扩展名(无语言高亮,按纯文本展示) */
const TEXT_EXT = new Set([
  'txt', 'log', 'text', 'csv', 'tsv', 'ini', 'cfg', 'conf', 'toml', 'lock',
  'env', 'properties', 'gitignore', 'gitattributes', 'editorconfig', 'npmrc', 'nvmrc',
  'license', 'authors', 'changelog',
])

function extOf(name: string): string {
  const idx = name.lastIndexOf('.')
  if (idx <= 0 || idx === name.length - 1) return ''
  return name.slice(idx + 1).toLowerCase()
}

/**
 * 按扩展名识别;返回 null 表示无法判断(无/未知扩展名),需内容嗅探。
 */
export function identifyByName(name: string): FileTypeInfo | null {
  // 整文件名优先:Dockerfile 无扩展名匹配不到,CMakeLists.txt 的 .txt 会被误判为纯文本
  const lower = name.toLowerCase()
  const whole = WHOLE_NAME[lower] ?? WHOLE_NAME[lower.split('.')[0]]
  if (whole) return { channel: whole.channel, language: whole.language }

  const ext = extOf(name)
  if (ext === 'md' || ext === 'markdown') return { channel: 'markdown', language: 'markdown' }
  if (IMAGE_EXT.has(ext)) return { channel: 'image' }
  if (BINARY_EXT.has(ext)) return { channel: 'binary' }
  if (ext in CODE_EXT && ext !== 'svg') return { channel: 'code', language: CODE_EXT[ext] }
  if (TEXT_EXT.has(ext)) return { channel: 'text' }
  return null
}

/** 嗅探:前 8 KB 中含 NUL 或不可打印字符比例过高 → 二进制 */
export function looksBinary(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false
  let suspicious = 0
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]
    if (b === 0) return true
    // 允许 \t \n \r \f \x1b(终端转义常见于日志);其余 C0 控制字符视为可疑
    if (b < 32 && b !== 9 && b !== 10 && b !== 13 && b !== 12 && b !== 27) {
      suspicious++
    }
  }
  return suspicious / bytes.length > 0.1
}

/** shebang → 语言 id(仅用于无扩展名的脚本) */
export function languageFromShebang(text: string): string | undefined {
  if (!text.startsWith('#!')) return undefined
  const firstLine = text.slice(0, text.indexOf('\n') === -1 ? text.length : text.indexOf('\n'))
  if (/python/.test(firstLine)) return 'python'
  if (/\b(bash|sh|zsh|ksh|dash)\b/.test(firstLine)) return 'shell'
  if (/\bnode\b/.test(firstLine)) return 'javascript'
  return 'shell' // 有 shebang 但解释器未知,按 shell 展示比纯文本略好
}

// —— 代码理解(code-intelligence spec)的语言支持范围标注 ——
// full        = 参与符号抽取,支持大纲 / 跳转 / 查找引用 / 符号搜索
// outline-only= 仅提供大纲(Markdown 标题层级),不参与跳转与引用
// none        = 不参与代码理解(语法高亮与预览不受影响)
export type IntelLevel = 'full' | 'outline-only' | 'none'

/** 参与符号抽取的语言 id(与 preview/languages.ts 的 id 对齐) */
const INTEL_FULL = new Set([
  'python', 'java', 'c', 'cpp', 'go',
  'javascript', 'jsx', 'typescript', 'tsx',
  'rust', 'php',
])

/**
 * 高亮为**近似**的语言:Vue / Svelte 单文件组件走 html 通道 ——
 * `<script>` / `<style>` 块能正确高亮,但模板指令(`v-if` / `{#if}`)不保证准确。
 * MUST 在 UI 上明示为近似,MUST NOT 让用户以为是专用高亮。
 */
const APPROXIMATE = new Set(['vue', 'svelte'])

export function isApproximateHighlight(language?: string): boolean {
  return language != null && APPROXIMATE.has(language)
}

export function intelLevel(language?: string): IntelLevel {
  if (!language) return 'none'
  if (INTEL_FULL.has(language)) return 'full'
  if (language === 'markdown') return 'outline-only'
  return 'none'
}

/** 按文件名判定代码理解级别(Worker 侧派发用:不读内容,只看扩展名) */
export function intelLevelByName(name: string): IntelLevel {
  const info = identifyByName(name)
  return intelLevel(info?.language)
}

/** 语言 id → 展示名(预览区能力标识用) */
const LANG_LABEL: Record<string, string> = {
  python: 'Python', java: 'Java', c: 'C', cpp: 'C++', go: 'Go',
  javascript: 'JavaScript', jsx: 'JSX', typescript: 'TypeScript', tsx: 'TSX',
  json: 'JSON', html: 'HTML', css: 'CSS', scss: 'SCSS', sass: 'Sass', less: 'Less',
  sql: 'SQL', yaml: 'YAML',
  rust: 'Rust', php: 'PHP', ruby: 'Ruby', kotlin: 'Kotlin', csharp: 'C#', groovy: 'Groovy', toml: 'TOML',
  docker: 'Dockerfile', cmake: 'CMake', vue: 'Vue', svelte: 'Svelte',
  xml: 'XML', markdown: 'Markdown', shell: 'Shell',
}

export function languageLabel(language?: string): string {
  if (!language) return '纯文本'
  return LANG_LABEL[language] ?? language
}

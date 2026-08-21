import { identifyByName } from '../lib/filetypes'

// 目录树文件类型图标(file-tree spec「目录树排序与展示」)。
//
// 三条口径:
// 1. **不用 emoji**:emoji 在不同系统字体下渲染不一致、饱和度高,与界面的克制风格打架 ——
//    这才是"难看"的主要来源。这里用内置的极简单色 SVG 字形。
// 2. **不用图标字体、不用图标主题包**:字体的字形同样随渲染差异变化(等于换个形式再犯一次),
//    主题包则是体积问题。内联 SVG + `currentColor`,着色交给 CSS 变量,两主题各一套。
// 3. **不新建扩展名映射表**:语言归类直接复用 `lib/filetypes.ts` 的 `identifyByName`,
//    本文件只做 `language → 色类` 的收敛。两张表必然漂移。

/** 字形种类:刻意做少,靠颜色分组而不是靠画更多形状 */
type Glyph = 'folder' | 'code' | 'data' | 'text' | 'image' | 'binary'

/**
 * 色类:**按大类分色系,不按语言分色**(判据 2026-08-20 随覆盖类型增至 30+ 升级)。
 * 30 多种类型收敛到 10 个色类、5 个可眯眼识别的色块:
 * 冷色 = 编译/后端(go / c·cpp·rust / java·kotlin·c#·groovy / python·ruby)、
 * 暖色 = 前端与标记、绿 = 数据配置、中性 = 构建脚本与纯文本、粉 = 图片二进制。
 * **扫得快 > 分得清**:颜色负责粗分,字形负责细分。
 */
type Tone = 'dir' | 'go' | 'js' | 'py' | 'jvm' | 'csys' | 'markup' | 'data' | 'asset' | 'text'

function classify(name: string, isDir: boolean): { glyph: Glyph; tone: Tone } {
  if (isDir) return { glyph: 'folder', tone: 'dir' }

  const info = identifyByName(name)
  if (!info) return { glyph: 'text', tone: 'text' } // 未知/无扩展名 → 通用文件字形

  if (info.channel === 'image') return { glyph: 'image', tone: 'asset' }
  if (info.channel === 'binary') return { glyph: 'binary', tone: 'asset' }
  if (info.channel === 'markdown') return { glyph: 'text', tone: 'markup' }

  switch (info.language) {
    case 'go':
      return { glyph: 'code', tone: 'go' }
    case 'javascript':
    case 'jsx':
    case 'typescript':
    case 'tsx':
      return { glyph: 'code', tone: 'js' }
    case 'python':
    case 'ruby':
      return { glyph: 'code', tone: 'py' }
    case 'java':
    case 'kotlin':
    case 'csharp':
    case 'groovy':
      return { glyph: 'code', tone: 'jvm' }
    case 'c':
    case 'cpp':
    case 'rust':
      return { glyph: 'code', tone: 'csys' }
    case 'json':
    case 'yaml':
    case 'sql':
    case 'toml':
      return { glyph: 'data', tone: 'data' }
    case 'html':
    case 'css':
    case 'scss':
    case 'sass':
    case 'less':
    case 'xml':
    case 'vue':
    case 'svelte':
      return { glyph: 'code', tone: 'markup' }
    // 构建/脚本类:中性色成一块(Makefile 无 language,落到下面的 default 同样是中性)
    case 'shell':
    case 'docker':
    case 'cmake':
      return { glyph: 'code', tone: 'text' }
    default:
      return { glyph: 'text', tone: 'text' }
  }
}

// 统一的"纸张"轮廓:各类文件共用,靠内部标记与颜色区分,视觉上保持一族
const PAGE = 'M4 1.9h4.8l3.3 3.3v8.5a.6.6 0 0 1-.6.6H4a.6.6 0 0 1-.6-.6V2.5a.6.6 0 0 1 .6-.6Z'
const FOLD = 'M8.7 2v3.3h3.3'

function GlyphPaths({ glyph }: { glyph: Glyph }) {
  switch (glyph) {
    case 'folder':
      return (
        <path d="M1.7 4.3c0-.4.3-.7.7-.7h3.3l1.4 1.6h6.2c.4 0 .7.3.7.7v7.2c0 .4-.3.7-.7.7H2.4a.7.7 0 0 1-.7-.7V4.3Z" />
      )
    case 'image':
      return (
        <>
          <path d="M2.4 3.5h11.2v9h-11.2Z" />
          <path d="M5.4 7.2a1.05 1.05 0 1 0 0-.01" />
          <path d="m2.9 11.9 3.3-3.2 2 2 2.4-2.5 2.9 3.3" />
        </>
      )
    case 'binary':
      return (
        <>
          <path d={PAGE} />
          <path d={FOLD} />
          <path d="M5.3 8.5h1.9v1.9H5.3Zm3.5 2.7h1.9v1.9H8.8Z" class="icon-fill" />
        </>
      )
    case 'code':
      return (
        <>
          <path d={PAGE} />
          <path d={FOLD} />
          <path d="m6.7 8.6-1.5 1.5 1.5 1.5m2.6-3 1.5 1.5-1.5 1.5" />
        </>
      )
    case 'data':
      return (
        <>
          <path d={PAGE} />
          <path d={FOLD} />
          <path d="M5.4 8.7h2.1v2.1H5.4Zm3.1 2.4h2.1v2.1H8.5Z" />
        </>
      )
    case 'text':
    default:
      return (
        <>
          <path d={PAGE} />
          <path d={FOLD} />
          <path d="M5.5 8.7h5m-5 2h5m-5 2h3" />
        </>
      )
  }
}

export function FileIcon({ name, isDir }: { name: string; isDir: boolean }) {
  const { glyph, tone } = classify(name, isDir)
  return (
    <span class="icon" data-tone={tone}>
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <GlyphPaths glyph={glyph} />
      </svg>
    </span>
  )
}

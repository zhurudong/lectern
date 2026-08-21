import type { SyntaxNode } from '@lezer/common'
import { parser as pythonParser } from '@lezer/python'
import { parser as javaParser } from '@lezer/java'
import { parser as cppParser } from '@lezer/cpp'
import { parser as goParser } from '@lezer/go'
import { parser as jsParser } from '@lezer/javascript'
import { KIND, type KindId, type RawSymbol } from './symbols'

// 定义符号抽取(design.md D1):复用项目已打包的 Lezer 语法,不引入 tree-sitter WASM。
//
// **精度的关键是"按直接父节点白名单过滤",不是"祖先集合命中"。**
// 实测(2026-08-17)确认:Java 局部变量的祖先链是
//   Definition < VariableDeclarator < LocalVariableDeclaration < Block < MethodDeclaration < ClassBody < ClassDeclaration
// 其中 MethodDeclaration 与 ClassDeclaration 都在"允许的祖先"里 —— 用祖先集合判定会把
// 每一个局部变量都收成符号(Go 的形参同理:与真定义共用 DefName 节点名)。
// 因此下面每条规则都只看**直接父节点**(必要时再看祖父),并要求该节点确实是父节点
// 指定的"名字位"(isNameChild),而不是碰巧同类型的兄弟节点。

const TS_DIALECT = jsParser.configure({ dialect: 'ts' })
const TSX_DIALECT = jsParser.configure({ dialect: 'ts jsx' })
const JSX_DIALECT = jsParser.configure({ dialect: 'jsx' })

type Lang = 'python' | 'java' | 'cpp' | 'go' | 'js'

function parserFor(langId: string): { parser: typeof pythonParser; lang: Lang } | null {
  switch (langId) {
    case 'python': return { parser: pythonParser, lang: 'python' }
    case 'java': return { parser: javaParser, lang: 'java' }
    case 'c':
    case 'cpp': return { parser: cppParser, lang: 'cpp' }
    case 'go': return { parser: goParser, lang: 'go' }
    case 'javascript': return { parser: jsParser, lang: 'js' }
    case 'jsx': return { parser: JSX_DIALECT, lang: 'js' }
    case 'typescript': return { parser: TS_DIALECT, lang: 'js' }
    case 'tsx': return { parser: TSX_DIALECT, lang: 'js' }
    default: return null
  }
}

/** node 是否为 parent 指定类型的"第一个"该类子节点(即名字位),排除同类型兄弟 */
function isFirstChildOfType(parent: SyntaxNode, node: SyntaxNode, type: string): boolean {
  const first = parent.getChild(type)
  return first != null && first.from === node.from && first.to === node.to
}

/** node 是否为 parent 的"最后一个"该类子节点(C 的 typedef 别名位) */
function isLastChildOfType(parent: SyntaxNode, node: SyntaxNode, type: string): boolean {
  const all = parent.getChildren(type)
  const last = all[all.length - 1]
  return last != null && last.from === node.from && last.to === node.to
}

/** 向上跳过透明包装节点(如 TS 的 ExportDeclaration、Python 的 DecoratedStatement) */
function skipWrappers(node: SyntaxNode | null, wrappers: string[]): SyntaxNode | null {
  let cur = node
  while (cur && wrappers.includes(cur.name)) cur = cur.parent
  return cur
}

/** 任一祖先命中给定名称(仅用于"是否在函数体内"这类否定判定) */
function hasAncestor(node: SyntaxNode, names: string[]): boolean {
  let p = node.parent
  while (p) {
    if (names.includes(p.name)) return true
    p = p.parent
  }
  return false
}

// —— 各语言:直接父节点白名单 ——

function classifyPython(node: SyntaxNode, nodeText: string): KindId | null {
  if (node.name !== 'VariableName') return null
  const p = node.parent
  if (!p) return null
  if (p.name === 'ClassDefinition') {
    return isFirstChildOfType(p, node, 'VariableName') ? KIND.class : null
  }
  if (p.name === 'FunctionDefinition') {
    if (!isFirstChildOfType(p, node, 'VariableName')) return null
    // 类体内的函数是方法(ClassDefinition 可能被 DecoratedStatement 包一层)
    const body = p.parent
    const owner = body?.name === 'Body' ? body.parent : null
    return owner?.name === 'ClassDefinition' ? KIND.method : KIND.func
  }
  if (p.name === 'AssignStatement') {
    // 只收赋值语句的左值第一位:排除 RHS(RHS 的标识符在 CallExpression/BinaryExpression 之下)
    if (!isFirstChildOfType(p, node, 'VariableName')) return null
    const scope = skipWrappers(p.parent, ['DecoratedStatement'])
    if (scope?.name === 'Script') {
      // 全大写视为常量,其余为模块级变量
      return /^[A-Z_][A-Z0-9_]*$/.test(nodeText) ? KIND.constant : KIND.variable
    }
    // 类体内的赋值是字段;函数体内的赋值(局部变量)一律不收
    if (scope?.name === 'Body' && scope.parent?.name === 'ClassDefinition') return KIND.field
    return null
  }
  // ParamList(形参)、ImportStatement、ForStatement、WithStatement、表达式内的引用:全部排除
  return null
}

function classifyJava(node: SyntaxNode): KindId | null {
  if (node.name !== 'Definition') return null
  const p = node.parent
  if (!p) return null
  switch (p.name) {
    case 'ClassDeclaration':
    case 'RecordDeclaration':
      return isFirstChildOfType(p, node, 'Definition') ? KIND.class : null
    case 'InterfaceDeclaration':
    case 'AnnotationTypeDeclaration':
      return isFirstChildOfType(p, node, 'Definition') ? KIND.interface : null
    case 'EnumDeclaration':
      return isFirstChildOfType(p, node, 'Definition') ? KIND.enum : null
    case 'EnumConstant':
      return KIND.constant
    case 'MethodDeclaration':
      return isFirstChildOfType(p, node, 'Definition') ? KIND.method : null
    case 'ConstructorDeclaration':
      return isFirstChildOfType(p, node, 'Definition') ? KIND.ctor : null
    case 'VariableDeclarator':
      // 字段 vs 局部变量的唯一区别就在这一层:FieldDeclaration / LocalVariableDeclaration
      return p.parent?.name === 'FieldDeclaration' ? KIND.field : null
    default:
      // FormalParameter(形参)、CatchFormalParameter、TypeParameter 等一律排除
      return null
  }
}

function classifyGo(node: SyntaxNode): KindId | null {
  const p = node.parent
  if (!p) return null
  // 顶层声明不会有 Block / FunctionLiteral 祖先;有则是函数体内的局部声明
  const local = hasAncestor(node, ['Block', 'FunctionLiteral'])
  if (node.name === 'DefName') {
    if (local) return null
    switch (p.name) {
      case 'TypeSpec': {
        if (!isFirstChildOfType(p, node, 'DefName')) return null
        if (p.getChild('StructType')) return KIND.struct
        if (p.getChild('InterfaceType')) return KIND.interface
        return KIND.type
      }
      case 'ConstSpec':
        return KIND.constant
      case 'VarSpec':
        return KIND.variable
      case 'FunctionDecl':
        return isFirstChildOfType(p, node, 'DefName') ? KIND.func : null
      default:
        // Parameter(形参)、PackageClause(包名)、局部 VarDecl 一律排除
        return null
    }
  }
  if (node.name === 'FieldName') {
    if (local) return null
    switch (p.name) {
      case 'MethodDecl':
        return isFirstChildOfType(p, node, 'FieldName') ? KIND.method : null
      case 'MethodElem': // 接口方法
        return KIND.method
      case 'FieldDecl': // 结构体字段
        return KIND.field
      default:
        // SelectorExpr(h.Name / fmt.Println 这类引用)排除
        return null
    }
  }
  return null
}

function classifyCpp(node: SyntaxNode, text: string): KindId | null {
  const p = node.parent
  if (!p) return null
  if (node.name === 'TypeIdentifier') {
    switch (p.name) {
      // 必须**带定义体**才算定义。`const struct utimbuf *` 这种出现在形参里的
      // elaborated type specifier 也会被解析成 StructSpecifier + TypeIdentifier,
      // 不加这道判定就会把每一处"引用某个结构体"都收成一个结构体定义(实测于
      // MacOSX.sdk 的 utime.h)。前向声明 `struct Node;` 同理不收 —— 它和真定义
      // 同名,收了只会让候选列表多出一条指向声明的噪声。
      case 'StructSpecifier':
      case 'UnionSpecifier':
        return p.getChild('FieldDeclarationList') && isFirstChildOfType(p, node, 'TypeIdentifier') ? KIND.struct : null
      case 'ClassSpecifier':
        return p.getChild('FieldDeclarationList') && isFirstChildOfType(p, node, 'TypeIdentifier') ? KIND.class : null
      case 'EnumSpecifier':
        return p.getChild('EnumeratorList') && isFirstChildOfType(p, node, 'TypeIdentifier') ? KIND.enum : null
      case 'TypeDefinition':
        // typedef 的别名是最后一个 TypeIdentifier(`typedef struct Foo Bar;` 里取 Bar)
        return isLastChildOfType(p, node, 'TypeIdentifier') ? KIND.type : null
      case 'AliasDeclaration': // using X = Y;
        return isFirstChildOfType(p, node, 'TypeIdentifier') ? KIND.type : null
      default:
        // FieldDeclaration 里的类型名、TypeParameterDeclaration 的模板参数:排除
        return null
    }
  }
  if (node.name === 'FieldIdentifier') {
    if (p.name === 'FieldDeclaration') return KIND.field
    // 类体内的成员函数声明
    if (p.name === 'FunctionDeclarator' && p.parent?.name === 'FieldDeclaration') return KIND.method
    return null
  }
  if (node.name === 'Identifier') {
    if (p.name === 'FunctionDeclarator' && p.parent?.name === 'FunctionDefinition') return KIND.func
    // 自由函数原型(`int helper(int a);`):头文件里常常只有它,不收会让纯声明头文件大纲空掉。
    // 与形参干净可分 —— 形参是 `Identifier < ParameterDeclaration < ParameterList`。
    if (p.name === 'FunctionDeclarator' && p.parent?.name === 'Declaration') return KIND.declaration
    if (p.name === 'NamespaceDefinition') {
      return isFirstChildOfType(p, node, 'Identifier') ? KIND.namespace : null
    }
    if (p.name === 'Enumerator') return KIND.constant
    if (p.name === 'PreprocDirective') {
      // `#define NAME(args)`:只收第一个 Identifier(宏名),宏形参必须排除
      if (!text.slice(p.from, p.from + 7).startsWith('#define')) return null
      return isFirstChildOfType(p, node, 'Identifier') ? KIND.macro : null
    }
    // ParameterDeclaration(形参)、InitDeclarator(局部变量)、表达式内引用:排除
    return null
  }
  if (node.name === 'ScopedIdentifier') {
    // 类外定义 `void Widget::resize(...)`:名字取末段,容器取限定段
    if (p.name === 'FunctionDeclarator' && p.parent?.name === 'FunctionDefinition') return KIND.func
    if (p.name === 'FunctionDeclarator' && p.parent?.name === 'Declaration') return KIND.declaration
    return null
  }
  return null
}

function classifyJs(node: SyntaxNode, nodeText: string): KindId | null {
  const p = node.parent
  if (!p) return null
  if (node.name === 'VariableDefinition') {
    switch (p.name) {
      case 'FunctionDeclaration':
        return isFirstChildOfType(p, node, 'VariableDefinition') ? KIND.func : null
      case 'ClassDeclaration':
        return isFirstChildOfType(p, node, 'VariableDefinition') ? KIND.class : null
      case 'NamespaceDeclaration':
        return isFirstChildOfType(p, node, 'VariableDefinition') ? KIND.namespace : null
      case 'VariableDeclaration': {
        // 只收模块顶层声明(export 是透明包装);函数体内的 Block 声明是局部变量
        const scope = skipWrappers(p.parent, ['ExportDeclaration'])
        if (scope?.name !== 'Script') return null
        return /^[A-Z_][A-Z0-9_]*$/.test(nodeText) ? KIND.constant : KIND.variable
      }
      default:
        // ParamList / ArrowFunction 形参、ForOfSpec、ForSpec、CatchClause:排除
        return null
    }
  }
  if (node.name === 'PropertyDefinition') {
    if (p.name === 'MethodDeclaration') return KIND.method
    if (p.name === 'PropertyDeclaration') return KIND.field
    // 对象字面量的 Property、接口成员的 PropertyType:排除(避免候选列表被通用属性名淹没)
    return null
  }
  if (node.name === 'TypeDefinition') {
    switch (p.name) {
      case 'InterfaceDeclaration': return KIND.interface
      case 'TypeAliasDeclaration': return KIND.type
      case 'EnumDeclaration': return KIND.enum
      default: return null
    }
  }
  return null
}

// —— 容器名解析:定位符号所属的类 / 结构体 / 命名空间 / 外层函数 ——

const CONTAINER_NAME_CHILD: Record<Lang, Record<string, string>> = {
  python: { ClassDefinition: 'VariableName', FunctionDefinition: 'VariableName' },
  java: {
    ClassDeclaration: 'Definition',
    RecordDeclaration: 'Definition',
    InterfaceDeclaration: 'Definition',
    AnnotationTypeDeclaration: 'Definition',
    EnumDeclaration: 'Definition',
    MethodDeclaration: 'Definition',
    ConstructorDeclaration: 'Definition',
  },
  go: { TypeSpec: 'DefName', FunctionDecl: 'DefName', MethodDecl: 'FieldName' },
  cpp: {
    ClassSpecifier: 'TypeIdentifier',
    StructSpecifier: 'TypeIdentifier',
    UnionSpecifier: 'TypeIdentifier',
    EnumSpecifier: 'TypeIdentifier',
    NamespaceDefinition: 'Identifier',
  },
  js: {
    ClassDeclaration: 'VariableDefinition',
    NamespaceDeclaration: 'VariableDefinition',
    InterfaceDeclaration: 'TypeDefinition',
    TypeAliasDeclaration: 'TypeDefinition',
    EnumDeclaration: 'TypeDefinition',
    MethodDeclaration: 'PropertyDefinition',
    FunctionDeclaration: 'VariableDefinition',
  },
}

/**
 * Go 方法的容器是**接收者类型**,它在 `MethodDecl → Parameters → Parameter` 里,
 * 不在祖先链上 —— 泛化的 containerOf 找不到它,必须单独取。
 * 形如 `func (h *Handler) Dispatch(...)`,容器应为 `Handler`。
 */
function goReceiverType(methodDecl: SyntaxNode, text: string): string | null {
  const param = methodDecl.getChild('Parameters')?.getChild('Parameter')
  if (!param) return null
  const typeNode = param.getChild('TypeName') ?? param.getChild('PointerType')?.getChild('TypeName')
  return typeNode ? text.slice(typeNode.from, typeNode.to) : null
}

function containerOf(node: SyntaxNode, lang: Lang, text: string): string | null {
  const table = CONTAINER_NAME_CHILD[lang]
  let p = node.parent
  while (p) {
    const childType = table[p.name]
    if (childType) {
      const nameNode = p.getChild(childType)
      // 跳过"自己就是这个容器的名字位"的那一层,避免把自身当容器
      if (nameNode && !(nameNode.from === node.from && nameNode.to === node.to)) {
        return text.slice(nameNode.from, nameNode.to)
      }
    }
    p = p.parent
  }
  return null
}

// —— 行号:一次构建行首偏移表,二分查找 ——

function lineStartsOf(text: string): number[] {
  const starts = [0]
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1)
  }
  return starts
}

function lineAt(starts: number[], pos: number): number {
  let lo = 0
  let hi = starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid] <= pos) lo = mid
    else hi = mid - 1
  }
  return lo + 1 // 1-based
}

/** Markdown 标题大纲(仅大纲,不参与跳转与引用):跳过围栏代码块内的 # */
export function extractMarkdownHeadings(text: string): RawSymbol[] {
  const out: RawSymbol[] = []
  const lines = text.split('\n')
  let fence: string | null = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fenceMatch = /^\s{0,3}(```+|~~~+)/.exec(line)
    if (fenceMatch) {
      if (fence == null) fence = fenceMatch[1][0]
      else if (fenceMatch[1][0] === fence) fence = null
      continue
    }
    if (fence != null) continue
    const m = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (m) {
      out.push({
        name: m[2],
        kind: KIND.heading,
        line: i + 1,
        container: null,
        level: m[1].length,
      })
    }
  }
  return out
}

/**
 * 抽取一份源码中的定义符号。
 * 返回顺序即文件内出现顺序(大纲面板直接使用)。
 */
export function extractSymbols(text: string, langId: string): RawSymbol[] {
  if (langId === 'markdown') return extractMarkdownHeadings(text)
  const picked = parserFor(langId)
  if (!picked) return []
  const { parser, lang } = picked

  const tree = parser.parse(text)
  const starts = lineStartsOf(text)
  const out: RawSymbol[] = []
  // 同名同行去重:`typedef struct Node Node;` 这类写法会在同一位置产出两个 Node
  // (前向声明 + typedef 别名),留两条只会让候选列表出现两个完全一样的条目。
  const seen = new Set<string>()
  const cursor = tree.cursor()

  do {
    const name = cursor.name
    // 廉价预筛:只有可能是"定义位"的节点名才进入规则判定
    if (
      name !== 'VariableName' && name !== 'Definition' && name !== 'DefName' &&
      name !== 'FieldName' && name !== 'TypeIdentifier' && name !== 'FieldIdentifier' &&
      name !== 'Identifier' && name !== 'ScopedIdentifier' &&
      name !== 'VariableDefinition' && name !== 'PropertyDefinition' && name !== 'TypeDefinition'
    ) continue

    const node = cursor.node
    const nodeText = text.slice(node.from, node.to)
    if (!nodeText || nodeText.length > 200 || nodeText.includes('\n')) continue

    let kind: KindId | null = null
    switch (lang) {
      case 'python': kind = classifyPython(node, nodeText); break
      case 'java': kind = classifyJava(node); break
      case 'go': kind = classifyGo(node); break
      case 'cpp': kind = classifyCpp(node, text); break
      case 'js': kind = classifyJs(node, nodeText); break
    }
    if (kind == null) continue

    let symName = nodeText
    let container = containerOf(node, lang, text)
    if (lang === 'go' && name === 'FieldName' && node.parent?.name === 'MethodDecl') {
      container = goReceiverType(node.parent, text) ?? container
    }
    // C++ 的 `Ns::fn` 定义:名字取末段,容器取限定段
    if (name === 'ScopedIdentifier') {
      const idx = symName.lastIndexOf('::')
      if (idx > 0) {
        container = symName.slice(0, idx)
        symName = symName.slice(idx + 2)
      }
    }

    const line = lineAt(starts, node.from)
    const key = `${symName}@${line}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ name: symName, kind, line, container })
  } while (cursor.next())

  return out
}

// —— 查找引用的精筛(任务 7.2 / design.md D3 第三级漏斗)——

/** 标识符字符:用于判定"整词"命中,避免 `Handler` 命中 `HandlerImpl` */
function isIdentChar(code: number): boolean {
  return (
    (code >= 48 && code <= 57) || // 0-9
    (code >= 65 && code <= 90) || // A-Z
    (code >= 97 && code <= 122) || // a-z
    code === 95 || // _
    code === 36 || // $
    code > 127 // 允许非 ASCII 标识符
  )
}

/** 节点类型是否属于注释或字符串字面量 */
function isCommentOrString(nodeName: string): boolean {
  return /Comment|String|Char(?:acter)?Literal/i.test(nodeName)
}

/**
 * 返回 name 在源码中作为**整词**出现、且**不落在注释与字符串字面量内**的所有起始偏移。
 *
 * 「排除注释与字符串」靠语法树判定而不是正则猜:先按整词找出所有候选位置,
 * 再用 `resolveInner` 取该位置最内层节点并向上查,命中 Comment/String 类节点即丢弃。
 * 解析失败(或语言不支持)时退化为只做整词匹配 —— 宁可多给几条,也不静默漏掉真引用。
 */
export function occurrencesOutsideCommentsAndStrings(
  text: string,
  langId: string,
  name: string,
): number[] {
  if (!name) return []
  // 先做整词扫描(廉价),再决定是否需要解析
  const raw: number[] = []
  let from = 0
  for (;;) {
    const idx = text.indexOf(name, from)
    if (idx === -1) break
    const before = idx > 0 ? text.charCodeAt(idx - 1) : -1
    const after = idx + name.length < text.length ? text.charCodeAt(idx + name.length) : -1
    if (!(before >= 0 && isIdentChar(before)) && !(after >= 0 && isIdentChar(after))) {
      raw.push(idx)
    }
    from = idx + name.length
  }
  if (raw.length === 0) return []

  const picked = parserFor(langId)
  if (!picked) return raw

  let tree
  try {
    tree = picked.parser.parse(text)
  } catch {
    return raw
  }

  const out: number[] = []
  for (const pos of raw) {
    let node: SyntaxNode | null = tree.resolveInner(pos, 1)
    let inside = false
    while (node) {
      if (isCommentOrString(node.name)) {
        inside = true
        break
      }
      node = node.parent
    }
    if (!inside) out.push(pos)
  }
  return out
}

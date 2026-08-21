// C/C++ 抽取质量与符号密度实测(任务 11.4)。
//
// 样本 = 本机上的真实开源 C/C++ 代码(LLVM libc++ 头文件 + Node/V8 C++ 头文件),
// 对照组 = 旗舰场景用的 Go 合成样本(306,000 符号那组数据就出自它,所以密度要跟它比)。
//
// 关注两件事:
//  ① 收录原型后 C/C++ 的符号密度是否显著高于 Go(规格 2026-08-17 的观察项:
//     若达 Go 的 2 倍以上,须回报复看 400,000 上限)
//  ② 抽取结果是否明显混入形参/局部变量(误收率的粗筛)
import { build } from 'esbuild'
import { readFileSync, statSync, readdirSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join, extname } from 'node:path'
import { PROJECT } from './paths.mjs'

const out = join(mkdtempSync(join(tmpdir(), 'cv-cpp-')), 'extract.mjs')
await build({
  entryPoints: [join(PROJECT, 'src/intel/extract.ts')],
  bundle: true, format: 'esm', outfile: out, platform: 'node', logLevel: 'error',
})
const { extractSymbols } = await import(out)

// 头文件来源:`HEADERS` 环境变量优先(冒号分隔多个目录),否则用 macOS 默认路径。
// **这个测量的实质是"拿真实头文件量误收率",不是"拿苹果的头文件量"** ——
// 默认走 macOS SDK 只因为开发机是 mac,不该让别的平台无法复现。
const ROOTS = process.env.HEADERS
  ? process.env.HEADERS.split(':').filter(Boolean)
  : [
      '/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk/usr/include/c++/v1',
      '/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk/usr/include',
      join(homedir(), 'Library/Caches/node-gyp'),
    ]

const CPP_EXT = new Set(['.h', '.hpp', '.hh', '.c', '.cc', '.cpp', '.cxx'])

function walk(dir, acc, depth = 0) {
  if (acc.length >= 4000 || depth > 5) return acc
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return acc }
  for (const e of entries) {
    if (acc.length >= 4000) break
    const full = join(dir, e.name)
    if (e.isDirectory()) walk(full, acc, depth + 1)
    else if (e.isFile()) {
      const ext = extname(e.name)
      // libc++ 的无扩展名头文件(<vector> 之类)也算,但只取有扩展名的以免误吞二进制
      if (CPP_EXT.has(ext)) acc.push(full)
    }
  }
  return acc
}

const files = []
for (const r of ROOTS) walk(r, files)
// 一个都没扫到时**必须报错**,不能安静地量出"0 个符号、误收率 0%" ——
// 那是一份看起来完美的空报告,比失败更糟(它会被当成通过)。
if (files.length === 0) {
  console.error(
    `未在以下位置找到任何 C/C++ 头文件:\n  ${ROOTS.join('\n  ')}\n` +
      '请用 HEADERS 指向头文件目录后重试,例如:HEADERS=/usr/include node scripts/measure-cpp.mjs',
  )
  process.exit(1)
}
if (files.length === 0) {
  console.log('未在本机找到真实 C/C++ 样本,跳过(结论按"未验证"记录)')
  process.exit(0)
}

// 均匀抽样,避免只抽到某一个子目录
const SAMPLE = 400
const step = Math.max(1, Math.floor(files.length / SAMPLE))
const sample = files.filter((_, i) => i % step === 0).slice(0, SAMPLE)

let totalBytes = 0
let totalSymbols = 0
let parsedFiles = 0
const kindCount = new Map()
const perFile = []

for (const f of sample) {
  let text
  try {
    const st = statSync(f)
    if (st.size > 5 * 1024 * 1024) continue // 与产品的 5 MB 上限一致
    text = readFileSync(f, 'utf8')
  } catch { continue }
  const lang = ['.c', '.h'].includes(extname(f)) ? 'c' : 'cpp'
  let syms
  try { syms = extractSymbols(text, lang) } catch { continue }
  parsedFiles++
  totalBytes += Buffer.byteLength(text)
  totalSymbols += syms.length
  perFile.push({ f, n: syms.length, kb: Buffer.byteLength(text) / 1024 })
  for (const s of syms) kindCount.set(s.kind, (kindCount.get(s.kind) ?? 0) + 1)
}

const KIND_NAME = {
  1: '类', 2: '接口', 3: '枚举', 4: '结构体', 5: '函数', 6: '方法', 7: '字段',
  8: '常量', 9: '变量', 10: '类型', 11: '命名空间', 12: '宏', 13: '构造', 14: '标题', 15: '声明',
}

// —— Go 对照组:旗舰场景用的同一份合成源码 ——
const goSrc = (d, idx) => {
  const tag = `${d}_${idx}`
  const L = [`package pkg${d}`, '']
  for (let i = 0; i < 6; i++) {
    L.push(`type Type${tag}_${i} struct {`, `\tField${tag}_${i} string`, '}', '')
    L.push(`func Func${tag}_${i}(arg string, count int) error {`, '\tlocal := arg', '\t_ = local', '\treturn nil', '}', '')
    L.push(`const Const${tag}_${i} = ${i}`, '')
    L.push(`func (t *Type${tag}_${i}) Method${tag}_${i}(p int) int { return p }`, '')
    L.push(`var Var${tag}_${i} int`, '')
  }
  return L.join('\n')
}
let goBytes = 0
let goSymbols = 0
for (let i = 0; i < 50; i++) {
  const src = goSrc(0, i)
  goBytes += Buffer.byteLength(src)
  goSymbols += extractSymbols(src, 'go').length
}

const cppPerFile = totalSymbols / parsedFiles
const cppPerKB = totalSymbols / (totalBytes / 1024)
const goPerFile = goSymbols / 50
const goPerKB = goSymbols / (goBytes / 1024)

console.log(`\n样本来源:${ROOTS.filter((r) => files.some((f) => f.startsWith(r))).join('\n            ')}`)
console.log(`候选文件 ${files.length} 个,抽样解析 ${parsedFiles} 个,合计 ${(totalBytes / 1024 / 1024).toFixed(1)} MB\n`)
console.log('=== 符号密度对比(任务 11.4 的新增观察项)===')
console.log(`真实 C/C++ : ${cppPerFile.toFixed(1)} 符号/文件, ${cppPerKB.toFixed(2)} 符号/KB`)
console.log(`Go 对照组   : ${goPerFile.toFixed(1)} 符号/文件, ${goPerKB.toFixed(2)} 符号/KB(旗舰场景同一份合成源码)`)
console.log(`密度倍率(按符号/KB): ${(cppPerKB / goPerKB).toFixed(2)}×  ${cppPerKB / goPerKB >= 2 ? '⚠️ 达 2 倍以上,须回报复看 400,000 上限' : '✅ 未达 2 倍,阈值无需复看'}`)

console.log('\n=== 抽取种类分布 ===')
for (const [k, n] of [...kindCount].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${(KIND_NAME[k] ?? k).padEnd(6)} ${String(n).padStart(6)}  ${((n / totalSymbols) * 100).toFixed(1)}%`)
}

console.log('\n=== 符号最多的 5 个文件(便于人工抽查是否混入形参/局部变量)===')
for (const p of perFile.sort((a, b) => b.n - a.n).slice(0, 5)) {
  console.log(`  ${p.n} 符号 / ${p.kb.toFixed(0)} KB  ${p.f}`)
}

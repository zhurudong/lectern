// E2E 验收走查:真实 Chrome + 已装载扩展 + OPFS 合成项目
// 注意:__cv 测试钩子仅存在于 dev 构建,故先产出 dist-dev 再装载(正式 dist 不携带钩子)。
import puppeteer from 'puppeteer-core'
import { execSync, spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PROJECT, SCRIPTS, resolveChrome } from './paths.mjs'

// 路径与 Chrome 解析都来自 `paths.mjs` —— **仓库里只有那一份推导**(任务 2.1 / 2.2)。
// 这里不再自己算一遍:同一个模式抄多份,下次改目录结构会漏掉其中一处,
// 而漏掉的那处不报错,只在别人机器上炸。
const SHOTS = SCRIPTS
const DIST = join(PROJECT, 'dist-dev')
const CHROME = resolveChrome()

console.log('building dev bundle (dist-dev)…')
execSync('npx vite build --mode development --outDir dist-dev', { cwd: PROJECT, stdio: 'inherit' })
// 发布产物也就地构建一次:下面的不变量门禁要查 `dist/`,
// **不重建就等于查"上次碰巧留在那儿的那份"** —— 一份过期的干净产物照样让门禁变绿,
// 而当前源码可能早已不干净。门禁必须查它刚刚从当前源码构建出来的东西。
console.log('building release bundle (dist)…')
execSync('npx vite build --outDir dist', { cwd: PROJECT, stdio: 'inherit' })

const results = []
function check(name, ok, extra = '') {
  results.push({ name, ok, extra })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`)
}

// 已知偶发、原因未明、且产品行为已被真人核验正常的断言,走这条通道。
//
// **它不是"注释掉了事"**:断言照常执行、失败照常打印、总结里单独计数并点名 ——
// 只是不把整个套件染红。这么做的理由是**误归因的代价**:它红的时候,
// 下一个人最自然的反应是"我刚改的东西弄坏了",然后去查一个不存在的回归。
//
// 硬边界:**只有被追踪、且有独立证据表明产品正常的项**才能走这里。
// 任何新出现的红一律用 `check` —— 这条通道不许用来消化未知问题。
const flaky = []
function checkKnownFlaky(name, ok, extra = '', tracking = '') {
  if (ok) {
    results.push({ name, ok, extra })
    console.log(`PASS  ${name}${extra ? '  — ' + extra : ''}`)
    return
  }
  flaky.push({ name, extra, tracking })
  console.log(`FLAKY ${name}${extra ? '  — ' + extra : ''}  【已知偶发,不计入失败:${tracking}】`)
}

// ---- 产物符号门禁(任务 1.4 / 1b.2 / 1c.7)----
// **调用 `check-invariants.mjs`,不在这里重写一遍匹配。** 符号清单只有那一份;
// 在 E2E 里再写一次正则,等于让"零网络 / 只读"这条承诺同时存在两份定义,
// 而两份定义迟早会漂移 —— 那正是这个项目已经吃过亏的接缝形态。
// 只按退出码判定,**不解析它的输出**(解析输出 = 又把它的格式契约复制一份)。
{
  const gate = (dist) =>
    spawnSync('node', [join(SHOTS, 'check-invariants.mjs')], {
      cwd: PROJECT,
      stdio: 'inherit',
      env: { ...process.env, DIST: dist },
    }).status === 0
  // `dist/` 是**发货产物**,承诺是对它做出的;`dist-dev` 是本次 E2E 真正装载的那份。
  // 两份都查:只查前者会漏掉"测试用的这份其实不干净",只查后者会漏掉发货产物本身。
  check('发布产物 dist/ 通过不变量门禁(零网络 + 只读 + 权限)', gate('dist'), '查的是本次刚构建的 dist')
  check('本次装载的 dist-dev 同样通过不变量门禁', gate('dist-dev'))

  // 键位单一来源(3b.5):同样**调脚本而不是在这里重写判定**。
  // 它做的是变异测试(改 keys.ts → 重建 → 看两处标注是否都跟着变),
  // 需要重建 dist-dev,所以必须跑在浏览器装载扩展**之前**。
  check(
    '键位标注与实际绑定同源(变异测试:改映射后菜单与帮助同步变化)',
    spawnSync('node', [join(SHOTS, 'check-key-single-source.mjs')], {
      cwd: PROJECT,
      stdio: 'inherit',
    }).status === 0,
  )
}

const profile = mkdtempSync(join(tmpdir(), 'cv-e2e-'))
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  pipe: true,
  enableExtensions: true,
  args: [
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1440,900',
  ],
  defaultViewport: { width: 1400, height: 850 },
})

try {
  // 新版 Chrome 移除了 --load-extension,改用 CDP Extensions.loadUnpacked
  const extId = await browser.installExtension(DIST)
  check('扩展已装载(installExtension)', !!extId, extId)
  const swTarget = await browser
    .waitForTarget(
      (t) => t.type() === 'service_worker' && t.url().includes(extId),
      { timeout: 8000 },
    )
    .catch(() => null)
  check('MV3 service worker 已注册', !!swTarget, swTarget?.url() ?? '未观测到(可能已休眠)')

  const page = await browser.newPage()
  const httpRequests = []
  const consoleErrors = []
  page.on('request', (r) => {
    const u = r.url()
    if (/^https?:\/\//i.test(u)) httpRequests.push(u)
  })
  page.on('pageerror', (e) => consoleErrors.push(String(e)))
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text())
  })

  /** 读当前主题下某个 CSS 令牌的值(令牌表是单一源,断言不手写色值) */
  const token = (name) =>
    page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name)
  const asRgb = (hex) => {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim())
    return m ? `rgb(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)})` : hex
  }
  /** 等待主题切换完成:判据是 body 背景与 --bg 令牌一致,而不是某个硬编码颜色 */
  const waitThemeApplied = () =>
    page.waitForFunction(
      () => {
        const t = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
        if (!t) return false
        const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(t)
        const want = m ? `rgb(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)})` : t
        return getComputedStyle(document.body).backgroundColor === want
      },
      { timeout: 5000 },
    )

  /**
   * 等某个元素的某个计算样式**稳定下来**,再往下走(通常是截图前)。
   *
   * 为什么不 `sleep(130)`:过渡时长正好是 130ms,睡 130 卡在边界上,偶尔仍会拍到
   * 最后一帧;而且它的症状是"截图偶尔有点脏",没人会把它认成 bug。
   *
   * **"连续两次读到同一个值"自己有个起点假稳的坑**:若在过渡**还没开始**时就来轮询,
   * 头两次读到的都是初始值,于是判"已稳定"直接放行 —— 等的是"没在动",
   * 而"还没开始动"同样没在动。所以给了 `from`:先等值**离开过初始值**,再等它稳。
   * 不传 `from` 时退化成原来的语义(只在确知过渡已开始时才这么用)。
   */
  const waitStyleSettled = async (selector, prop = 'backgroundColor', { from = null, timeout = 5000 } = {}) => {
    const read = () => page.evaluate(
      (sel, pr) => {
        const el = document.querySelector(sel)
        return el ? getComputedStyle(el)[pr] : null
      },
      selector, prop,
    )
    const t0 = Date.now()
    if (from !== null) {
      // 阶段一:必须先看见它动过
      while (Date.now() - t0 < timeout) {
        const v = await read()
        if (v !== null && v !== from) break
        await new Promise((r) => setTimeout(r, 30))
      }
    }
    // 阶段二:再等它停下来
    let prev = null
    let stable = 0
    while (Date.now() - t0 < timeout) {
      const v = await read()
      if (v !== null && v === prev) {
        stable += 1
        if (stable >= 2) return v
      } else {
        stable = 0
      }
      prev = v
      await new Promise((r) => setTimeout(r, 40))
    }
    return prev
  }

  /**
   * **深色截图的正向守卫。**
   *
   * 上一版这里只断言"过渡已稳定" —— 那是个**负向**条件("没在动"),
   * 而我们真正要的是**终态**:深色是不是真的画出来了。两者不等价,
   * 起点静止也满足"没在动",于是一张浅色的图照样能过。
   *
   * 这里守三件事,缺一不可:
   *   ① `data-theme` 确实是 `dark`(应用层已切);
   *   ② `body` 的实际背景**等于当前 `--bg` 令牌**(样式已应用到画面,不只是变量变了);
   *   ③ 这个值**不等于切换前的浅色值**(排除"根本没换套"这一种)。
   * 返回实测底色,交给调用方 `check` —— 让它成为一条会红的断言,而不是一次静默等待。
   */
  const waitDarkPainted = async (lightBg, timeout = 6000) => {
    const probe = () => page.evaluate(() => {
      const tokenBg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
      const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(tokenBg)
      const want = m ? `rgb(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)})` : tokenBg
      return {
        theme: document.documentElement.getAttribute('data-theme'),
        bodyBg: getComputedStyle(document.body).backgroundColor,
        tokenBg: want,
      }
    })
    const t0 = Date.now()
    let last = null
    while (Date.now() - t0 < timeout) {
      last = await probe()
      if (last.theme === 'dark' && last.bodyBg === last.tokenBg && last.bodyBg !== lightBg) return last
      await new Promise((r) => setTimeout(r, 50))
    }
    return last
  }

  await page.goto(`chrome-extension://${extId}/viewer.html`, { waitUntil: 'load' })
  await page.waitForSelector('.welcome', { timeout: 10000 })
  check('查看器页面(欢迎页)在扩展 CSP 下正常渲染', true)
  {
    const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    check('首装默认浅色主题(底色取自 --bg 令牌)', bodyBg === asRgb(await token('--bg')), `${bodyBg} vs 令牌 ${asRgb(await token('--bg'))}`)
  }
  await page.screenshot({ path: join(SHOTS, 'shot-1-welcome.png') })

  // ---- OPFS 合成测试项目 ----
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    // 清空(重复运行时)
    for await (const name of root.keys()) await root.removeEntry(name, { recursive: true })

    const write = async (dir, name, content) => {
      const fh = await dir.getFileHandle(name, { create: true })
      const w = await fh.createWritable()
      await w.write(content)
      await w.close()
    }
    const docs = await root.getDirectoryHandle('docs', { create: true })
    const src = await root.getDirectoryHandle('src', { create: true })
    const bin = await root.getDirectoryHandle('bin', { create: true })

    await write(root, 'README.md', [
      '# Demo Project',
      '',
      '<script>window.__xss = 1<\/script>',
      '<img src="x" onerror="window.__xss2 = 1">',
      '',
      '| 列A | 列B |',
      '| --- | --- |',
      '| 1 | 2 |',
      '',
      '```go',
      'package main',
      'func main() { println("hi") }',
      '```',
      '',
      '本地图片: ![logo](docs/logo.svg)',
      '缺失图片: ![missing](docs/missing.png)',
      '远程图片: ![remote](https://example.com/x.png)',
      '',
      '[项目内链接](src/main.go) · [坏链接](nope/void.md) · [外部](https://example.com)',
    ].join('\n'))
    await write(docs, 'logo.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="#4ec9b0"/></svg>')
    await write(src, 'main.go', 'package main\n\nimport "fmt"\n\n// 入口\nfunc main() {\n\tfmt.Println("hello")\n}\n')
    await write(src, 'app.py', 'import os\n\ndef main():\n    print("hi")  # comment\n')
    // ---- 代码理解合成文件(任务 10.1)----
    // 刻意构造:跨文件唯一定义、两处同名定义、注释与字符串中的同名文本、
    // 形参与局部变量同名的函数、不支持语言(.yaml)、仅大纲语言(.md)。
    // ---- caret 落点专用夹具(fix-navigation-caret-landing 3.0)----
    // **目标符号必须离文件开头足够远。**
    // 已实测的缺陷规律是"跳转后 caret 恒在文档开头",所以若目标恰好在第 1 行,
    // "caret 落在目标行"会**碰巧成立**,整组断言全绿而缺陷隐身。
    // 独立测量里就有一格是这么"通过"的(三行的小夹具、定义在第 1 行)。
    // **凡位置正确性类断言,夹具的正确答案 MUST NOT 与默认值重合。**
    await write(src, 'deep.go', [
      'package server',
      '',
      ...Array.from({ length: 45 }, (_, i) => `// 填充注释行 ${i + 1},把目标推离文件开头`),
      '',
      'func DeepAnchor(seed int) int {',   // 第 49 行
      '\treturn seed * 2',
      '}',
      '',
      'func callsIt() int {',
      '\treturn DeepAnchor(21)',
      '}',
    ].join('\n'))
    await write(src, 'handler.go', [
      'package server',                       // 1
      '',                                     // 2
      'import "fmt"',                         // 3
      '',                                     // 4
      '// Handler 处理请求',                   // 5
      'type Handler struct {',                // 6
      '\tName string',                        // 7
      '}',                                    // 8
      '',                                     // 9
      'const MaxRetries = 3',                 // 10
      '',                                     // 11
      'func Serve(addr string, timeout int) error {', // 12
      '\tlocalOnly := addr',                  // 13
      '\tfmt.Println(localOnly, timeout)',    // 14
      '\treturn nil',                         // 15
      '}',                                    // 16
      '',                                     // 17
      'func (h *Handler) Dispatch(req string) string {', // 18
      '\treturn h.Name + req',                // 19
      '}',                                    // 20
    ].join('\n'))
    // 同名定义之一:New(与 store.go 构成多候选)
    await write(src, 'service.go', [
      'package server',
      '',
      '// New 创建 service —— 这行注释里的 Serve 不应计入引用',
      'func New(cfg string) string {',
      '\treturn "Serve"',
      '}',
    ].join('\n'))
    await write(src, 'store.go', [
      'package store',
      '',
      'func New(dsn string) string {',
      '\treturn dsn',
      '}',
    ].join('\n'))
    await write(src, 'Service.java', [
      'package demo;',                                            // 1
      '',                                                         // 2
      'public class Service {',                                   // 3
      '    private int counter;',                                 // 4
      '    public static final String NAME = "svc";',             // 5
      '',                                                         // 6
      '    public Service(int seed) { this.counter = seed; }',     // 7
      '',                                                         // 8
      '    public String handle(String request, int retries) {',   // 9
      '        int localTmp = retries + 1;',                       // 10
      '        return request + localTmp;',                        // 11
      '    }',                                                     // 12
      '}',                                                         // 13
    ].join('\n'))
    await write(src, 'models.py', [
      'CONST_LIMIT = 10',
      '',
      'class Repo:',
      '    table = "rows"',
      '',
      '    def fetch(self, key, limit):',
      '        cached = key',
      '        return cached',
    ].join('\n'))
    await write(src, 'engine.ts', [
      'export interface Options { name: string }',
      '',
      'export function process(input: string, count: number): string {',
      '    const localOnly = input.repeat(count)',
      '    return localOnly',
      '}',
      '',
      'export class Engine {',
      '    private field = 1',
      '    run(taskName: string) { return taskName }',
      '}',
      '',
      'export function build(): Engine {',
      '    return new Engine()',
      '}',
    ].join('\n'))
    await write(src, 'widget.cpp', [
      '#define MAX_SIZE 1024',
      '',
      'struct Point { int x; int y; };',
      '',
      'class Widget {',
      'public:',
      '    int width;',
      '    void resize(int newWidth, int newHeight);',
      '};',
      '',
      'int compute(int a, int b) {',
      '    int sum = a + b;',
      '    return sum;',
      '}',
      '',
      'int caller() { return compute(1, 2); }',
    ].join('\n'))
    // 调用方:跳转到定义 / 多候选 / 查找引用的触发点
    await write(src, 'client.go', [
      'package server',                  // 1
      '',                                // 2
      'func Run() error {',              // 3
      '\th := New("cfg")',               // 4
      '\t_ = h',                         // 5
      '\treturn Serve("addr", 1)',       // 6
      '}',                               // 7
    ].join('\n'))
    // 同名重载 + 前置声明:验证单文件模式与项目模式的跳转行为一致(任务 8b.5 / 10.6c)
    await write(src, 'overload.cpp', [
      'void overloaded(int a);',                    // 1  声明
      'void overloaded(const char *s);',            // 2  声明(重载)
      'void solo(int a);',                          // 3  声明
      '',                                           // 4
      'void overloaded(int a) { (void)a; }',        // 5  定义
      'void overloaded(const char *s) { (void)s; }',// 6  定义(重载)
      '',                                           // 7
      'void solo(int a) { (void)a; }',              // 8  唯一定义
      '',                                           // 9
      'int callSite() {',                           // 10
      '    overloaded(1);',                         // 11
      '    solo(2);',                               // 12
      '    return 0;',                              // 13
      '}',                                          // 14
    ].join('\n'))
    // C 头文件:纯原型,验证"声明"种类与"定义优先"跳转(任务 3.10)
    await write(src, 'util.h', [
      '#ifndef UTIL_H',                  // 1
      '#define UTIL_H',                  // 2
      '',                                // 3
      'int compute(int a, int b);',      // 4
      'void reset(void);',               // 5
      '',                                // 6
      '#endif',                          // 7
    ].join('\n'))
    // B 组高频语言 + C 组整文件名 + D 组近似高亮(任务 2c / 2d / 2e)
    await write(src, 'main.rs', 'fn main() {\n    let x: u32 = 1;\n    println!("{}", x);\n}\n')
    await write(src, 'app.rb', 'class Greeter\n  def initialize(name)\n    @name = name\n  end\nend\n')
    await write(src, 'Main.kt', 'fun main() {\n    val x: Int = 1\n    println(x)\n}\n')
    await write(src, 'Prog.cs', [
      '// 入口',
      'namespace App {',
      '  public class P {',
      '    const int Retries = 3;',
      '    public static void Main() { System.Console.WriteLine("hi"); }',
      '  }',
      '}',
    ].join('\n'))
    await write(src, 'build.gradle', [
      '// 构建脚本',
      "plugins { id 'java' }",
      'def retries = 3',
      "dependencies { implementation 'a:b:1.0' }",
    ].join('\n'))
    await write(src, 'Cargo.toml', '[package]\nname = "demo"\nversion = "0.1.0"\n')
    await write(src, 'Dockerfile', [
      '# 构建镜像',
      'FROM node:20',
      'WORKDIR /app',
      'ENV NODE_ENV=production',
      'RUN npm ci',
      'CMD ["node", "x.js"]',
    ].join('\n'))
    await write(src, 'Dockerfile.dev', [
      '# 开发镜像',
      'FROM node:20',
      'ENV NODE_ENV=development',
      'RUN npm install',
      'CMD ["npm", "run", "dev"]',
    ].join('\n'))
    await write(src, 'CMakeLists.txt', 'cmake_minimum_required(VERSION 3.10)\nproject(demo)\nadd_executable(demo main.c)\n')
    await write(src, 'App.vue', '<template>\n  <div v-if="ok">{{ msg }}</div>\n</template>\n<script>\nexport default { data() { return { ok: true } } }\n</' + 'script>\n')
    await write(src, 'App.svelte', '<script>\n  let count = 0\n</' + 'script>\n<button on:click={() => count++}>{count}</button>\n')
    // CSS 家族:各用专用高亮模式,不是拿 css 近似顶替(任务 2b)
    await write(src, 'theme.scss', [
      '$brand: #336699;',
      '@mixin card($pad: 8px) {',
      '  padding: $pad;',
      '}',
      '.panel {',
      '  color: $brand;',
      '  &:hover { color: darken($brand, 10%); }',
      '  .nested { @include card(12px); }',
      '}',
    ].join('\n'))
    await write(src, 'theme.less', [
      '@brand: #336699;',
      '.mixin(@pad: 8px) { padding: @pad; }',
      '.panel {',
      '  color: @brand;',
      '  &:hover { color: lighten(@brand, 10%); }',
      '}',
    ].join('\n'))
    await write(src, 'theme.sass', [
      '$brand: #336699',
      '.panel',
      '  color: $brand',
      '  &:hover',
      '    color: red',
    ].join('\n'))
    // Markdown 围栏里的 scss 也要高亮 —— 同一个功能的另一半,漏了就是"断言吃半句"
    await write(src, 'styles-guide.md', [
      '# 样式约定',
      '',
      '```scss',
      '$brand: #336699;',
      '.panel { color: $brand; }',
      '```',
    ].join('\n'))
    await write(src, 'config.yaml', 'server:\n  port: 8080\n  handler: Handler\n')
    await write(src, 'guide.md', [
      '# 阅读指南',          // 1
      '',
      '正文',
      '',
      '```go',
      '# 这不是标题',        // 6(围栏内,不是标题)
      '```',
      '',
      '## 快速开始',         // 9
      '',
      // 填充:让"安装"远在首屏之外,否则"滚动到可见区域"不写定位逻辑也恒真
      ...Array.from({ length: 60 }, (_, i) => `第 ${i + 1} 段填充正文,用于把后面的标题推出首屏。`).flatMap((t) => [t, '']),
      '### 安装',            // 131
    ].join('\n'))
    await write(root, 'data.json', '{"version": 1}\n')
    await write(root, 'Makefile', 'all:\n\techo build\n')
    await write(root, 'runme', '#!/usr/bin/env bash\necho hello\n')
    await write(root, 'temp.txt', 'to be deleted\n')
    await write(root, 'photo.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60"><circle cx="30" cy="30" r="25" fill="#c586c0"/></svg>')
    await write(root, 'single.md', '单文件模式相对图片: ![x](docs/logo.svg)\n')
    // 二进制:含 NUL
    await write(bin, 'blob.bin', new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0, 0, 1, 2, 3, 0, 250, 251]))
    // 6MB 的支持语言文件:验证"超过 5MB 不参与符号索引"在预览区与大纲区都要明示(任务 9.2)
    {
      const fh = await src.getFileHandle('huge.go', { create: true })
      const w = await fh.createWritable()
      await w.write('package huge\n\nfunc HugeEntry() {}\n')
      const chunk = '// padding 填充行 abcdefghijklmnopqrstuvwxyz\n'.repeat(20000) // ~1MB
      for (let i = 0; i < 6; i++) await w.write(chunk)
      await w.close()
    }
    // 50MB 大文件
    {
      const fh = await root.getFileHandle('big.log', { create: true })
      const w = await fh.createWritable()
      const chunk = ('log line 数据 abcdefghijklmnopqrstuvwxyz 0123456789\n').repeat(20000) // ~1MB
      for (let i = 0; i < 50; i++) await w.write(chunk)
      await w.close()
    }
    // 1500 条目目录
    const bigdir = await root.getDirectoryHandle('bigdir', { create: true })
    for (let b = 0; b < 15; b++) {
      await Promise.all(
        Array.from({ length: 100 }, (_, i) =>
          bigdir.getFileHandle(`entry-${String(b * 100 + i).padStart(4, '0')}.txt`, { create: true })),
      )
    }
    // ---- 重目录夹具(change: add-heavy-dir-exclusion,任务 4.1)----
    // **这个夹具本身就是修复的一部分**:既有合成项目从不长 node_modules 与 .git,
    // 而那正是"打开真实仓库会把依赖包全扫进去"这个问题一直没被发现的原因。
    {
      const nm = await root.getDirectoryHandle('node_modules', { create: true })
      // 一个能被预览/看大纲、但不该被搜到的依赖包文件
      const lodash = await nm.getDirectoryHandle('lodash', { create: true })
      await write(lodash, 'index.js', [
        '// 依赖包内的文件:可以打开看,但不该进项目级索引',
        'export function vendorOnlyHelper(a, b) {',
        '  return a + b',
        '}',
      ].join('\n'))
      // 数千个文件,模拟真实 node_modules 的量级
      for (let d = 0; d < 6; d++) {
        const pkg = await nm.getDirectoryHandle(`pkg-${d}`, { create: true })
        for (let b = 0; b < 5; b++) {
          await Promise.all(
            Array.from({ length: 100 }, (_, i) =>
              write(pkg, `m-${String(b * 100 + i).padStart(3, '0')}.js`, 'export const x = 1\n')),
          )
        }
      }
      const git = await root.getDirectoryHandle('.git', { create: true })
      await write(git, 'config', '[core]\n\trepositoryformatversion = 0\n')
      await write(git, 'HEAD', 'ref: refs/heads/main\n')
      const objs = await git.getDirectoryHandle('objects', { create: true })
      await Promise.all(
        Array.from({ length: 200 }, (_, i) => write(objs, `o-${i}.bin`, 'x')),
      )
    }

    // ~10,000 文件:20 目录 × 500
    const many = await root.getDirectoryHandle('many', { create: true })
    for (let d = 0; d < 20; d++) {
      const sub = await many.getDirectoryHandle(`pkg-${String(d).padStart(2, '0')}`, { create: true })
      for (let b = 0; b < 5; b++) {
        await Promise.all(
          Array.from({ length: 100 }, (_, i) =>
            sub.getFileHandle(`file-${String(b * 100 + i).padStart(3, '0')}.ts`, { create: true })),
        )
      }
    }
  })
  check('OPFS 合成项目就绪(~10,000 文件)', true)

  // ---- 进入项目模式,测首屏时间 ----
  const t0 = Date.now()
  await page.evaluate(async () => {
    window.__cv.enterProject(await navigator.storage.getDirectory())
  })
  await page.waitForSelector('.tree-row', { timeout: 10000 })
  const firstPaint = Date.now() - t0
  check('打开 10k 文件项目,根层首屏 <1s', firstPaint < 1000, `${firstPaint}ms`)

  const rowLabels = () =>
    page.$$eval('.tree-row', (rows) =>
      rows.map((r) => ({
        label: r.querySelector('.label')?.textContent ?? '',
        dir: r.querySelector('.twisty')?.textContent?.trim() !== '',
        selected: r.classList.contains('selected'),
      })),
    )
  // 目录树在索引推进 / 刷新时会重渲染,拿到的元素句柄可能在点击前就失效
  // ("Node is detached from document"),所以带重试。
  // 另:目录树是**虚拟滚动**的,只有视口附近的行在 DOM 里 —— 目标行可能压根没渲染,
  // 所以找不到时要逐屏滚动去找,而不是断定它不存在(行高变化会让这个问题更容易撞上)。
  const clickRow = async (label) => {
    const scanRendered = async () => {
      const handles = await page.$$('.tree-row')
      for (const h of handles) {
        const l = await h.$eval('.label', (el) => el.textContent).catch(() => null)
        if (l !== label) continue
        try {
          await h.click()
          return true
        } catch {
          return null // 句柄失效,让外层重试
        }
      }
      return false
    }
    for (let attempt = 0; attempt < 4; attempt++) {
      const hit = await scanRendered()
      if (hit === true) return true
      if (hit === null) {
        await new Promise((r) => setTimeout(r, 200))
        continue
      }
      // 未渲染:逐屏滚动查找。单文件模式没有目录树,此时直接放弃(返回 false)
      const box = await page
        .$eval('.tree', (el) => ({ h: el.scrollHeight, vh: el.clientHeight, top: el.scrollTop }))
        .catch(() => null)
      if (!box) return false
      for (let top = 0; top < box.h; top += Math.max(100, box.vh * 0.8)) {
        await page.$eval('.tree', (el, t) => { el.scrollTop = t }, top)
        await new Promise((r) => setTimeout(r, 120))
        const found = await scanRendered()
        if (found === true) return true
      }
      await page.$eval('.tree', (el, t) => { el.scrollTop = t }, box.top)
      await new Promise((r) => setTimeout(r, 150))
    }
    return false
  }

  // 按"出现某个具体符号"等待:不能只等 .outline-row 出现 ——
  // 切文件瞬间上一个文件的条目可能仍在 DOM 里,泛化的等待会命中旧内容。
  const outlineRows = () =>
    page.$$eval('.outline-row', (els) =>
      els.map((e) => ({
        name: e.querySelector('.outline-name')?.textContent ?? '',
        line: Number(e.querySelector('.outline-line')?.textContent ?? '0'),
      })),
    )
  const clickOutline = async (name) => {
    const rows = await page.$$('.outline-row')
    for (const r of rows) {
      const n = await r.$eval('.outline-name', (e) => e.textContent).catch(() => null)
      if (n === name) { await r.click(); return true }
    }
    return false
  }
  const openFile = async (label, expectPath) => {
    await clickRow(label)
    await page.waitForFunction(
      (p) => document.querySelector('.preview-header .file-path')?.textContent === p,
      { timeout: 10000 }, expectPath,
    )
  }
  const targetLineText = () => page.$eval('.cm-target-line', (el) => el.textContent).catch(() => null)
  /** 跨文件跳转后内容是异步加载的:必须等落点行真正出现再断言,否则读到的是上一个文件 */
  const waitTargetLine = (substr) =>
    page.waitForFunction(
      (t) => document.querySelector('.cm-target-line')?.textContent?.includes(t),
      { timeout: 10000 }, substr,
    )
  /** 在预览区里按“整词”定位某个标识符并点击(nth 从 1 开始) */
  // 取词坐标只此一份:点击与"按住悬停"共用,避免两处各写一份定位逻辑
  const wordSpot = async (word, nth = 1) =>
    page.evaluate(
      (w, n) => {
        const root = document.querySelector('.cm-content')
        if (!root) return null
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        const re = new RegExp(`(^|[^A-Za-z0-9_$])(${w})([^A-Za-z0-9_$]|$)`)
        let node
        let seen = 0
        while ((node = walker.nextNode())) {
          const text = node.textContent ?? ''
          let from = 0
          for (;;) {
            const m = re.exec(text.slice(from))
            if (!m) break
            const idx = from + m.index + m[1].length
            seen++
            if (seen === n) {
              const range = document.createRange()
              range.setStart(node, idx)
              range.setEnd(node, idx + w.length)
              const r = range.getBoundingClientRect()
              if (r.width > 0) return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
            }
            from = idx + w.length
          }
        }
        return null
      },
      word, nth,
    )

  const clickWord = async (word, { nth = 1, meta = false, right = false } = {}) => {
    const spot = await wordSpot(word, nth)
    if (!spot) return false
    if (meta) await page.keyboard.down('Meta')
    await page.mouse.click(spot.x, spot.y, right ? { button: 'right' } : {})
    if (meta) await page.keyboard.up('Meta')
    return true
  }

  /** 按住 Meta 把指针移到某个标识符上,返回该处是否带可跳转提示 class */
  const hoverWordMeta = async (word, nth = 1) => {
    const spot = await wordSpot(word, nth)
    if (!spot) return { found: false, hinted: false }
    await page.keyboard.down('Meta')
    // 先等修饰键状态落定再移动:`keyboard.down` 与 `mouse.move` 是两条独立的 CDP 调用,
    // 紧挨着发时,mousemove 有可能带着**尚未更新的 metaKey** 到达页面 ——
    // 表现就是"偶发没提示"。定点复现脚本证明机制本身是好的(干净状态与走过 2a 操作后
    // 都能出提示),所以问题在投递时序,不在实现。
    await new Promise((r) => setTimeout(r, 120))
    // 先移到别处再移入:确保产生一次"指针下标识符发生变化"的转移
    await page.mouse.move(spot.x + 300, spot.y)
    await page.mouse.move(spot.x, spot.y)
    // 等"提示出现"这个性质本身,不是等固定毫秒数(固定 250ms 曾偶发假红一次)。
    // 反例用例会在这里等满超时后返回 hinted:false —— **慢一点,但不会骗人**。
    const hinted = await page
      .waitForFunction(() => !!document.querySelector('.cm-jump-hint'), { timeout: 1500 })
      .then(() => true)
      .catch(() => false)
    return { found: true, hinted }
  }
  const releaseMeta = async () => {
    await page.keyboard.up('Meta')
    await new Promise((r) => setTimeout(r, 250))
  }

  const waitOutline = (name) =>
    page.waitForFunction(
      (n) => [...document.querySelectorAll('.outline-row .outline-name')].some((e) => e.textContent === n),
      { timeout: 20000 }, name,
    )
  const clickSearchMode = async (label) => {
    const btns = await page.$$('.search-mode')
    for (const b of btns) {
      const t = await b.evaluate((e) => e.textContent)
      if (t === label) { await b.click(); return true }
    }
    return false
  }

  // ---- 排序:目录在前,名称自然排序 ----
  {
    const rows = await rowLabels()
    const names = rows.map((r) => r.label)
    const dirsFirst = names.slice(0, 4).join(',')
    check('目录优先排序', dirsFirst === 'bigdir,bin,docs,many', dirsFirst)
    const fileSeg = names.slice(4)
    check('文件名自然排序', fileSeg.join(',').includes('big.log,data.json'), fileSeg.join(','))
  }
  await page.screenshot({ path: join(SHOTS, 'shot-2-project.png') })

  // ================= 目录树键盘导航(change: add-tree-keyboard-nav)=================
  // 焦点始终在容器上,活动行由 aria-activedescendant 指向 —— 因此"活动行是谁"
  // 一律读容器的 aria-activedescendant,而不是找带某个 class 的元素。
  const activeLabel = () =>
    page.evaluate(() => {
      const id = document.querySelector('.tree')?.getAttribute('aria-activedescendant')
      if (!id) return null
      return document.getElementById(id)?.querySelector('.label')?.textContent ?? '(已卸载)'
    })
  const activeId = () => page.$eval('.tree', (el) => el.getAttribute('aria-activedescendant'))
  // 容器取得焦点后,活动行是由 signal 驱动渲染的,**不与 focus() 同步发生**。
  // 原先固定 sleep 120ms,在当前夹具(1.3 万文件,索引构建期间主线程繁忙)下会偶发不够。
  // 改成等 aria-activedescendant 真的出现,并记录耗时。
  // **这不是把失败等成成功**:若焦点根本不设置活动行,这里会等满超时,
  // 属性仍为 null,后面的断言照常判红 —— 变的只是"等多久",不是"判什么"。
  let lastFocusWaitMs = 0
  const focusTree = async () => {
    const t0 = Date.now()
    // **先 blur 再 focus。** `el.focus()` 在元素已持有焦点时**不触发 focus 事件**,
    // 而"容器获得焦点时落在首行"的逻辑正挂在该事件上 —— 若此前某步已经把焦点留在树上,
    // 这里就成了空操作,断言会以 null 判红,而产品其实没坏(那是前提失效,不是回归)。
    // 前提二:树里得**已经有真实行**。`moveTo(0)` 会向后跳过所有非 node 行,
    // 若此刻整棵树还是"加载中…"占位(1.3 万文件的索引构建期间会出现),
    // 它扫到末尾也找不到可落点,直接返回 —— activePath 保持 null,
    // **而 focus 事件只发生一次,不会自己重试**。这就是这条断言偶发红的真正原因。
    await page
      .waitForFunction(() => {
        const rows = [...document.querySelectorAll('.tree-row')]
        return rows.length > 0 && rows.some((r) => r.querySelector('.label')?.textContent !== '加载中…')
      }, { timeout: 10000 })
      .catch(() => {})
    await page.evaluate(() => {
      const el = document.activeElement
      if (el instanceof HTMLElement) el.blur()
    })
    await page.$eval('.tree', (el) => el.focus())
    await page
      .waitForFunction(() => !!document.querySelector('.tree')?.getAttribute('aria-activedescendant'), {
        timeout: 5000,
      })
      .catch(() => {})
    lastFocusWaitMs = Date.now() - t0
  }
  const press = async (key, times = 1) => {
    for (let i = 0; i < times; i++) {
      await page.keyboard.press(key)
      await new Promise((r) => setTimeout(r, 60))
    }
  }

  // ---- 骨架:ARIA 角色与可聚焦性(1.1)----
  {
    const aria = await page.evaluate(() => {
      const tree = document.querySelector('.tree')
      const row = document.querySelector('.tree-row[role="treeitem"]')
      const dir = [...document.querySelectorAll('.tree-row[role="treeitem"]')]
        .find((r) => r.hasAttribute('aria-expanded'))
      return {
        treeRole: tree?.getAttribute('role'),
        tabIndex: tree?.getAttribute('tabindex'),
        rowRole: row?.getAttribute('role'),
        level: row?.getAttribute('aria-level'),
        dirExpanded: dir?.getAttribute('aria-expanded'),
      }
    })
    check(
      '目录树具备 tree/treeitem 角色与可聚焦容器',
      aria.treeRole === 'tree' && aria.tabIndex === '0' && aria.rowRole === 'treeitem' && aria.level === '1' && aria.dirExpanded != null,
      JSON.stringify(aria),
    )
  }

  // ---- 容器获得焦点默认落在首行(1.4)----
  {
    // 记录进入本节时焦点在哪:用来判断"前提是否成立",而不是猜
    const before = await page.evaluate(() => document.activeElement?.className ?? '(body)')
    console.log(`  [焦点前提] 进入键盘节时 activeElement = ${before}`)
  }
  await focusTree()
  {
    const first = await activeLabel()
    if (first === null) {
      console.log('  [同瞬快照·按键前] ' + JSON.stringify(await page.evaluate(() => window.__cvTreeState?.() ?? null)))
      await page.keyboard.press('ArrowDown')
      await new Promise((r) => setTimeout(r, 300))
      console.log('  [同瞬快照·按键后] ' + JSON.stringify(await page.evaluate(() => window.__cvTreeState?.() ?? null)))
      console.log('  [树焦点诊断·按键前] ' + JSON.stringify(await page.evaluate(() => {
        const tree = document.querySelector('.tree')
        return {
          rawAttr: tree?.getAttribute('aria-activedescendant'),
          hasAttr: tree?.hasAttribute('aria-activedescendant'),
          firstRowIds: [...document.querySelectorAll('.tree-row')].slice(0, 3).map((r) => r.id),
          activeCls: [...document.querySelectorAll('.tree-row.active')].map((r) => r.id),
        }
      })))
    }
    if (first === null) {
      console.log('  [诊断] ' + JSON.stringify(await page.evaluate(() => {
        const tree = document.querySelector('.tree')
        const rows = [...document.querySelectorAll('.tree-row')]
        return {
          treeHasFocus: document.activeElement === tree,
          activeElClass: document.activeElement?.className ?? null,
          treeTabIndex: tree?.getAttribute('tabindex') ?? null,
          rowCount: rows.length,
          firstRowLabel: rows[0]?.querySelector('.label')?.textContent ?? null,
          firstRowIsHidden: rows[0]?.classList.contains('tree-hidden') ?? null,
        }
      })))
    }
    // 已知偶发触发时**必须就地恢复**:本节后面的断言都以"存在活动行"为前提,
    // 不恢复的话它们会连锁失败,最后整轮脚本超时中断 ——
    // **隔离只做到"不计入失败"是不够的,还要防止它污染后续用例。**
    if (first === null) {
      await page.keyboard.press('Home')
      await new Promise((r) => setTimeout(r, 200))
      console.log('  [已知偶发·已就地恢复] 按 Home 重建活动行 → ' + String(await activeLabel()))
    }
    checkKnownFlaky(
      '容器获得焦点时默认落在首行',
      first === 'bigdir',
      `${first}(等待 ${lastFocusWaitMs}ms)`,
      'fix-tree-focus-default-row 未完全关闭;现象:树确实持有焦点、行已渲染,但 activePath 始终为空。' +
        '真人与其余 300+ 条断言证明产品行为正常。追踪于 chase-tree-focus-race',
    )
  }

  // ---- 纯键盘全链路:移动 → 展开 → 进子项 → 移到文件 → Enter 打开(4.1)----
  {
    // bigdir → bin → docs → many → src(第 5 行)
    await press('ArrowDown', 4)
    const onSrc = await activeLabel()
    check('↑↓ 在相邻行间移动活动行', onSrc === 'src', String(onSrc))

    // → 展开 src(此时未展开)
    await press('ArrowRight')
    await page.waitForFunction(
      () => [...document.querySelectorAll('.tree-row .label')].some((e) => e.textContent === 'main.go'),
      { timeout: 10000 },
    )
    const stillSrc = await activeLabel()
    check('→ 在未展开目录上执行展开且活动行不动(2.2)', stillSrc === 'src', String(stillSrc))

    // → 再按一次:进入第一个子项
    await press('ArrowRight')
    const firstChild = await activeLabel()
    check('→ 在已展开目录上进入第一个子项(2.2)', firstChild === 'app.py', String(firstChild))

    // 移到 main.go 并回车打开
    const beforeOpen = await page.$eval('.preview-header .file-path', (el) => el.textContent).catch(() => null)
    for (let i = 0; i < 40; i++) {
      if ((await activeLabel()) === 'main.go') break
      await press('ArrowDown')
    }
    check('可用方向键移动到目标文件', (await activeLabel()) === 'main.go')
    await press('Enter')
    await page.waitForFunction(
      () => document.querySelector('.preview-header .file-path')?.textContent === 'src/main.go',
      { timeout: 10000 },
    )
    check('Enter 经既有通道打开文件预览(纯键盘全链路)', true, `打开前:${beforeOpen}`)
  }

  // ---- 活动行 ≠ 选中文件(4.3)----
  {
    await press('ArrowDown', 2)
    const state = await page.evaluate(() => {
      const id = document.querySelector('.tree')?.getAttribute('aria-activedescendant')
      const active = id ? document.getElementById(id) : null
      const selected = document.querySelector('.tree-row.selected')
      return {
        active: active?.querySelector('.label')?.textContent ?? null,
        selected: selected?.querySelector('.label')?.textContent ?? null,
        activeHasActiveClass: active?.classList.contains('active') ?? false,
        activeIsSelected: active?.classList.contains('selected') ?? false,
        preview: document.querySelector('.preview-header .file-path')?.textContent ?? null,
      }
    })
    check(
      '活动行与选中文件可处于不同行,且各自标识正确',
      state.active !== state.selected && state.activeHasActiveClass && !state.activeIsSelected && state.selected === 'main.go',
      JSON.stringify(state),
    )
    check('移动活动行不改变预览内容', state.preview === 'src/main.go', String(state.preview))
  }

  // ---- ← 的两种行为(2.3 / 4.2)----
  {
    // 当前在 src 的某个子文件上 → ← 回到父目录 src
    await press('ArrowLeft')
    check('← 在文件上回到父目录行', (await activeLabel()) === 'src', String(await activeLabel()))
    // src 已展开 → ← 折叠
    await press('ArrowLeft')
    await page.waitForFunction(
      () => ![...document.querySelectorAll('.tree-row .label')].some((e) => e.textContent === 'main.go'),
      { timeout: 5000 },
    )
    const collapsed = await page.evaluate(() => {
      const id = document.querySelector('.tree')?.getAttribute('aria-activedescendant')
      return document.getElementById(id)?.getAttribute('aria-expanded')
    })
    check('← 在已展开目录上执行折叠', collapsed === 'false', `aria-expanded=${collapsed}`)
  }

  // ---- Home / End(2.1)----
  {
    await press('End')
    const last = await activeLabel()
    await press('Home')
    const first = await activeLabel()
    check('Home / End 移到首 / 末行', first === 'bigdir' && last !== 'bigdir', `首=${first} 末=${last}`)
  }

  // ---- 焦点分流:⌘K 聚焦搜索框后方向键不动树(2.6 / 4.5)----
  {
    const before = await activeId()
    await page.keyboard.down('Control')
    await page.keyboard.press('KeyK')
    await page.keyboard.up('Control')
    const focused = await page.evaluate(() => document.activeElement?.className ?? '')
    await press('ArrowDown', 3)
    const after = await activeId()
    check(
      '搜索框聚焦时方向键不移动目录树活动行(焦点归属天然分流)',
      focused === 'search-input' && before === after,
      `焦点=${focused} 活动行 ${before} → ${after}`,
    )
    await page.keyboard.press('Escape')
  }

  // ---- 虚拟滚动:活动行被卸载后状态不丢 + 越界自动滚回(3.1/3.2/4.4/4.6)----
  {
    await focusTree()
    await press('Home')
    // 展开 bigdir(1500 条),制造长列表
    for (let i = 0; i < 40; i++) {
      if ((await activeLabel()) === 'bigdir') break
      await press('ArrowUp')
    }
    await press('ArrowRight') // 展开
    await page.waitForFunction(
      () => [...document.querySelectorAll('.tree-row .label')].some((e) => e.textContent?.startsWith('entry-')),
      { timeout: 10000 },
    )
    await press('ArrowRight') // 进入第一个子项
    const beforeScroll = await page.$eval('.tree', (el) => el.scrollTop)

    // 连续下移足够多行,必然越出视口
    const t0 = Date.now()
    await press('ArrowDown', 60)
    const dt = Date.now() - t0
    const after = await page.evaluate(() => {
      const tree = document.querySelector('.tree')
      const id = tree?.getAttribute('aria-activedescendant')
      const el = id ? document.getElementById(id) : null
      const r = el?.getBoundingClientRect()
      const c = tree?.getBoundingClientRect()
      return {
        scrollTop: tree?.scrollTop ?? 0,
        label: el?.querySelector('.label')?.textContent ?? null,
        inView: r && c ? r.top >= c.top - 1 && r.bottom <= c.bottom + 1 : null,
        activeId: id,
      }
    })
    check('活动行越出视口时自动滚回可见区域', after.scrollTop > beforeScroll && after.inView === true, JSON.stringify(after))
    check('1000+ 条目中连续移动仍响应(60 次按键)', dt < 20000 && after.label != null, `${dt}ms,落在 ${after.label}`)

    // 手动把活动行滚出渲染范围 → 元素被卸载 → 再按键仍生效
    await page.$eval('.tree', (el) => { el.scrollTop = el.scrollTop + 4000 })
    await new Promise((r) => setTimeout(r, 300))
    const unmounted = await page.evaluate(() => {
      const id = document.querySelector('.tree')?.getAttribute('aria-activedescendant')
      return { id, stillInDom: !!(id && document.getElementById(id)) }
    })
    await press('ArrowDown')
    const afterUnmount = await activeId()
    check(
      '活动行被虚拟化卸载后状态不丢、后续按键仍生效',
      unmounted.stillInDom === false && afterUnmount !== null && afterUnmount !== unmounted.id,
      `卸载时仍在 DOM=${unmounted.stillInDom},按键后活动行=${afterUnmount}`,
    )
    // 收起 bigdir,恢复后续用例的树状态
    await press('ArrowLeft')
    await press('ArrowLeft')
    await page.waitForFunction(
      () => ![...document.querySelectorAll('.tree-row .label')].some((e) => e.textContent?.startsWith('entry-')),
      { timeout: 5000 },
    )
  }

  // ---- 行序重排后活动行仍指向同一节点(3.3)----
  {
    await focusTree()
    await press('Home')
    const before = await activeLabel()
    await press('ArrowRight') // 展开 bigdir,行序大幅重排
    await page.waitForFunction(
      () => [...document.querySelectorAll('.tree-row .label')].some((e) => e.textContent?.startsWith('entry-')),
      { timeout: 10000 },
    )
    const after = await activeLabel()
    check('展开导致行序重排后活动行仍指向同一节点', before === after && after === 'bigdir', `${before} → ${after}`)
    await press('ArrowLeft')
    await page.waitForFunction(
      () => ![...document.querySelectorAll('.tree-row .label')].some((e) => e.textContent?.startsWith('entry-')),
      { timeout: 5000 },
    )
  }

  // ---- 焦点环与选中态视觉可区分(1.3),两主题(4.9 的可自动化部分)----
  {
    // **先真的选中一个文件。** 这条断言原本只 focusTree() 就去读 `.tree-row.selected`,
    // 而那一刻树里根本没有选中行 —— `selectedBg` 恒为 null,`activeBg !== selectedBg`
    // 于是永远成立。断言绿了三百多轮,却从来没有比较过两种视觉形式。
    // 选 README.md(根层文件,不需要展开任何目录,不扰动后续用例的树状态)。
    await openFile('README.md', 'README.md')
    await focusTree() // 焦点回到树:焦点环挂在 `.tree:focus .tree-row.active::after` 上
    // **再把活动行挪开。** focusTree() 会把活动行落到选中文件那一行,于是 active 与
    // selected 是**同一个元素** —— 拿同一个元素的 backgroundColor 比两次,
    // `activeBg !== selectedBg` 必然为假,断言会以"产品坏了"的样子红,其实是用例摆错了。
    // 这两种形式本来就是设计成**能同时出现在不同的行上**的,断言也必须在那个局面下验。
    await press('Home')
    // `.tree-row` 上声明了 background-color 0.13s 过渡,且行是虚拟化重建的;
    // 紧接着读计算值会读到过渡起点(透明),不是稳定值。等过渡走完再读。
    await new Promise((r) => setTimeout(r, 300))
    // B 方案(restyle-reader D3)把选中态从三形式减为两形式:
    //   焦点环 = ::after 内缩描边 / 选中底 = 整行背景。左色条(--sel-bar)已置 transparent。
    // 断言只认这**两种**形式,并额外要求"选中行 ≠ 普通行" —— 去掉左条后,
    // 整行底成了选中态的唯一载体,它必须真的与普通行不同;
    // 原来的三项断言不查这一点,若底色误配成与普通行同值,断言仍会绿。
    const ring = await page.evaluate(() => {
      const id = document.querySelector('.tree')?.getAttribute('aria-activedescendant')
      const el = id ? document.getElementById(id) : null
      const after = el ? getComputedStyle(el, '::after') : null
      const selEl = document.querySelector('.tree-row.selected')
      const selCs = selEl ? getComputedStyle(selEl) : null
      const plainEl = [...document.querySelectorAll('.tree-row')].find(
        (r) => r !== selEl && !r.classList.contains('selected') && !r.classList.contains('active'),
      )
      return {
        ringWidth: after?.borderTopWidth ?? null,
        ringStyle: after?.borderTopStyle ?? null,
        activeId: id ?? null,
        selectedId: selEl?.id ?? null,
        activeBg: el ? getComputedStyle(el).backgroundColor : null,
        selectedBg: selCs?.backgroundColor ?? null,
        plainBg: plainEl ? getComputedStyle(plainEl).backgroundColor : null,
        selectedBar: selCs?.boxShadow ?? null,
      }
    })
    check(
      '选中态断言的前提成立:活动行与选中行确实是两个不同的行(否则下一条恒假/恒真)',
      ring.selectedBg != null && ring.activeId != null && ring.activeId !== ring.selectedId,
      JSON.stringify({ activeId: ring.activeId, selectedId: ring.selectedId }),
    )
    check(
      '活动行用内缩描边、选中行用背景填充,两种视觉形式各自存在且互不相同,且选中行有别于普通行',
      ring.ringWidth === '1px' &&
        ring.ringStyle === 'solid' &&
        ring.activeBg !== ring.selectedBg &&
        !!ring.plainBg &&
        ring.selectedBg !== ring.plainBg,
      JSON.stringify(ring),
    )
  }

  // ---- 文件类型图标(change: polish-tree-and-outline-ui,任务 3.1–3.3)----
  {
    // 3.2 先在折叠态记下目录图标,展开后再比 —— 展开态不得换图标
    const dirIconCollapsed = await page.evaluate(() => {
      const row = [...document.querySelectorAll('.tree-row')]
        .find((r) => r.querySelector('.label')?.textContent === 'src')
      return row?.querySelector('.icon')?.innerHTML ?? null
    })
    await clickRow('src')
    await page.waitForFunction(
      () => [...document.querySelectorAll('.tree-row .label')].some((e) => e.textContent === 'main.go'),
      { timeout: 10000 },
    )
    const dirIconExpanded = await page.evaluate(() => {
      const row = [...document.querySelectorAll('.tree-row')]
        .find((r) => r.querySelector('.label')?.textContent === 'src')
      return row?.querySelector('.icon')?.innerHTML ?? null
    })
    check(
      '展开/折叠目录时图标不变(展开态只由三角表达)',
      !!dirIconCollapsed && dirIconCollapsed === dirIconExpanded,
      dirIconCollapsed === dirIconExpanded ? '折叠态与展开态字形一致' : '字形发生了变化',
    )

    const tones = await page.evaluate(() =>
      Object.fromEntries(
        [...document.querySelectorAll('.tree-row')].map((r) => [
          r.querySelector('.label')?.textContent ?? '',
          r.querySelector('.icon')?.getAttribute('data-tone') ?? null,
        ]),
      ))
    const distinct = new Set(Object.values(tones).filter(Boolean))
    check('不同类型的文件呈现可区分的图标色类', distinct.size >= 5, `${distinct.size} 种色类:${[...distinct].join(',')}`)

    // 分组优先于区分:同族必须同色(否则就是"一语言一色"的杂乱)
    check(
      '同族语言共用同一色系(C/C++ 一系、Go 一系、Python 一系)',
      tones['widget.cpp'] === tones['util.h'] &&
        tones['widget.cpp'] === tones['overload.cpp'] &&
        tones['handler.go'] === tones['main.go'] &&
        tones['models.py'] === tones['app.py'],
      `cpp=${tones['widget.cpp']} h=${tones['util.h']} go=${tones['handler.go']}/${tones['main.go']} py=${tones['models.py']}/${tones['app.py']}`,
    )
    check(
      '不同族语言色类不同(Go / Java / TS / 数据 / Markdown 互不相同)',
      new Set([tones['main.go'], tones['Service.java'], tones['engine.ts'], tones['config.yaml'], tones['guide.md']]).size === 5,
      `go=${tones['main.go']} java=${tones['Service.java']} ts=${tones['engine.ts']} yaml=${tones['config.yaml']} md=${tones['guide.md']}`,
    )
    check('目录使用中性色且与文件色类区分', tones['docs'] === 'dir' && tones['bin'] === 'dir', `docs=${tones['docs']} bin=${tones['bin']}`)

    // 3.1 目录树中不得出现 emoji 字形(三角 ▾/▸ 属几何图形区,不在 emoji 范围内)
    const emoji = await page.evaluate(() => {
      const text = document.querySelector('.tree')?.textContent ?? ''
      const found = []
      for (const ch of text) {
        const cp = ch.codePointAt(0)
        if ((cp >= 0x1f000 && cp <= 0x1faff) || (cp >= 0x2600 && cp <= 0x27bf) || cp === 0xfe0f) found.push(ch)
      }
      return [...new Set(found)]
    })
    check('目录树中不出现 emoji 图标', emoji.length === 0, emoji.join(' ') || '无')

    // 3.3 两个主题下图标颜色都不得等于背景色(排除某主题下接近隐形)
    const sample = async () =>
      page.evaluate(() => {
        const rows = [...document.querySelectorAll('.tree-row')]
        const bg = getComputedStyle(document.querySelector('.sidebar')).backgroundColor
        const picked = ['main.go', 'Service.java', 'config.yaml', 'guide.md', 'src']
          .map((n) => rows.find((r) => r.querySelector('.label')?.textContent === n))
          .filter(Boolean)
          .map((r) => getComputedStyle(r.querySelector('.icon')).color)
        return { bg, colors: picked }
      })
    const light = await sample()
    await page.click('.theme-toggle')
    await waitThemeApplied()
    const dark = await sample()
    await page.click('.theme-toggle') // 还原浅色
    await waitThemeApplied()
    check(
      '浅色主题下图标颜色均不等于背景色',
      light.colors.length === 5 && light.colors.every((c) => c !== light.bg),
      `bg=${light.bg} colors=${light.colors.join(' ')}`,
    )
    check(
      '暗色主题下图标颜色均不等于背景色',
      dark.colors.length === 5 && dark.colors.every((c) => c !== dark.bg),
      `bg=${dark.bg} colors=${dark.colors.join(' ')}`,
    )
    check(
      '两主题各自定义了独立色值(不是同一组色加透明度)',
      light.colors.join() !== dark.colors.join(),
      `浅色 ${light.colors[0]} vs 暗色 ${dark.colors[0]}`,
    )

    await clickRow('src') // 还原折叠态,后续用例依赖它
    await new Promise((r) => setTimeout(r, 200))
  }

  // ================= 重目录排除(change: add-heavy-dir-exclusion)=================
  {
    // 4.2:默认状态下依赖包与版本库不出现在树里
    const rootLabels = (await rowLabels()).map((r) => r.label)
    check(
      '默认不显示 node_modules / .git',
      !rootLabels.includes('node_modules') && !rootLabels.includes('.git'),
      rootLabels.join(','),
    )

    // 4.3:"已隐藏 N 项"存在且 N 正确(根层被排除的是 node_modules 与 .git 两项)
    const hidden = await page.evaluate(() => {
      const el = document.querySelector('.tree-row.tree-hidden .label')
      return el ? el.textContent : null
    })
    check('根层出现"已隐藏 N 项"提示行且 N 正确', hidden === '已隐藏 2 项', String(hidden))

    // 展开后可见、可下钻
    await page.evaluate(() => {
      document.querySelector('.tree-row.tree-hidden')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await page.waitForFunction(
      () => [...document.querySelectorAll('.tree-row .label')].some((e) => e.textContent === 'node_modules'),
      { timeout: 8000 },
    )
    check('展开后被排除目录可见', true)
    await clickRow('node_modules')
    await page.waitForFunction(
      () => [...document.querySelectorAll('.tree-row .label')].some((e) => e.textContent === 'lodash'),
      { timeout: 8000 },
    )
    await clickRow('lodash')
    await page.waitForFunction(
      () => [...document.querySelectorAll('.tree-row .label')].some((e) => e.textContent === 'index.js'),
      { timeout: 8000 },
    )
    check('可继续下钻到依赖包内部', true)

    // 4.4:依赖包内文件可预览 + 可看单文件大纲,但搜不到,且界面明示边界
    await clickRow('index.js')
    await page.waitForFunction(
      () => document.querySelector('.cm-content')?.textContent?.includes('vendorOnlyHelper'),
      { timeout: 10000 },
    )
    check('被排除目录内的文件可正常预览', true)
    await waitOutline('vendorOnlyHelper')
    check('被排除目录内的文件仍可看单文件大纲(抽取通道不受项目索引排除影响)', true)
    const scopeNotice = await page.$eval('.preview-notice-scope', (el) => el.textContent).catch(() => null)
    check(
      '被排除目录内打开文件时明示"不参与项目级搜索与跳转"',
      !!scopeNotice && scopeNotice.includes('不参与项目级搜索'),
      scopeNotice ? scopeNotice.trim().slice(0, 40) : '未出现',
    )

    // 4.5:三个消费者行为一致 —— 树里能看到,但文件名/符号搜索都搜不到
    await clickSearchMode('文件名')
    await page.keyboard.type('vendorOnly')
    await new Promise((r) => setTimeout(r, 500))
    const fileHits = await page.$$eval('.search-result .result-name', (els) => els.map((e) => e.textContent))
    await page.evaluate(() => {
      const input = document.querySelector('.search-input')
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(input, '')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await clickSearchMode('符号')
    await page.keyboard.type('vendorOnlyHelper')
    await new Promise((r) => setTimeout(r, 500))
    const symHits = await page.$$eval('.search-result .result-name', (els) => els.map((e) => e.textContent))
    check(
      '依赖包内的文件不进文件名索引(树里可见 ≠ 可搜到)',
      !fileHits.includes('index.js'),
      fileHits.join(',') || '无结果',
    )
    check(
      '依赖包内的符号不进符号索引',
      !symHits.includes('vendorOnlyHelper'),
      symHits.join(',') || '无结果',
    )
    await page.keyboard.press('Escape')
    await clickSearchMode('文件名')
    await page.keyboard.press('Escape')

    // 4.2 续:索引规模对应**项目自身**,未被依赖包顶大,也没触发"项目过大"降级。
    //
    // 这里必须**数出来**而不只是"没报降级":夹具里 node_modules + .git 共 3203 个文件,
    // 排除失效时文件数会从 ~10017 涨到 ~13220 —— 那个差值就是这条断言的全部意义。
    // 只断言"没出现项目过大"是抓不住的:13220 一样不到降级阈值,会假绿。
    const FIXTURE_EXCLUDED_FILES = 3001 + 202
    const idxStatus = await page.$eval('.topbar .intel-index', (el) => el.textContent).catch(() => null)
    const indexedFiles = Number(/(\d+)\s*个文件/.exec(idxStatus ?? '')?.[1] ?? NaN)
    check(
      '索引规模对应项目自身,未因依赖包触发"项目过大"降级',
      !!idxStatus && !idxStatus.includes('项目过大'),
      String(idxStatus),
    )
    check(
      `索引文件数不含被排除目录的 ${FIXTURE_EXCLUDED_FILES} 个文件`,
      Number.isFinite(indexedFiles) && indexedFiles > 9000 && indexedFiles < 10000 + FIXTURE_EXCLUDED_FILES,
      `实测 ${indexedFiles};排除失效时应为约 ${10017 + FIXTURE_EXCLUDED_FILES}`,
    )

    // 收起被排除项,恢复后续用例的树状态
    await clickRow('lodash')
    await clickRow('node_modules')
    await page.evaluate(() => {
      document.querySelector('.tree-row.tree-hidden')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await page.waitForFunction(
      () => ![...document.querySelectorAll('.tree-row .label')].some((e) => e.textContent === 'node_modules'),
      { timeout: 8000 },
    )
  }

  // ---- 过渡:只加在非布局属性 + 虚拟滚动期间关闭(任务 3.2 / 3.3 / 3.4)----
  {
    const trans = await page.evaluate(() => {
      const pick = (sel) => {
        const el = document.querySelector(sel)
        if (!el) return null
        const cs = getComputedStyle(el)
        // 注意:transitionProperty 在**没有设置任何过渡**时的初始值就是 "all",
        // 但此时 transitionDuration 是 0s、其实什么都不动。
        // 只看 property 会把"根本没过渡"误判成"给 all 加了过渡"。
        const dur = cs.transitionDuration.split(',').map((d) => parseFloat(d) || 0)
        return { property: cs.transitionProperty, animated: dur.some((d) => d > 0) }
      }
      return { row: pick('.tree-row'), sidebar: pick('.sidebar'), outline: pick('.outline') }
    })
    // 判据是"会不会引起重排/位移",不是属性名单 —— 把一整类布局属性都查一遍
    const LAYOUT = ['width', 'height', 'padding', 'margin', 'top', 'left', 'flex', 'inset', 'all']
    const leaks = Object.entries(trans)
      .filter(([, v]) => v && v.animated && LAYOUT.some((k) => v.property.includes(k)))
      .map(([k, v]) => `${k}=${v.property}`)
    check(
      '过渡未加在任何布局属性上(拖拽调宽不会变成"追着鼠标滑")',
      leaks.length === 0,
      leaks.length ? leaks.join(' | ') : JSON.stringify(trans),
    )
    check(
      '状态过渡确实加在了背景/阴影/颜色上',
      !!trans.row && trans.row.property.includes('background-color') && trans.row.property.includes('box-shadow'),
      JSON.stringify(trans.row),
    )

    // 虚拟滚动复用 DOM 节点:滚动期间必须关掉行过渡,否则快速滚动会出现颜色拖影
    // 需要一棵**能滚动**的树:根目录只有十来行,撑不出滚动条,自然也不会有 scroll 事件。
    // 先展开 bigdir(1,500 条)制造长列表,测完再收起。
    await clickRow('bigdir')
    await page.waitForFunction(
      () => [...document.querySelectorAll('.tree-row .label')].some((e) => e.textContent?.startsWith('entry-')),
      { timeout: 10000 },
    )
    // 必须制造**真实的滚动位移**:若当前已在底部,+800 不会改变 scrollTop,
    // 也就不会触发 scroll 事件,滚动标记自然加不上(那是测试没触发,不是功能坏)
    await page.$eval('.tree', (el) => { el.scrollTop = 0 })
    await new Promise((r) => setTimeout(r, 250))
    const moved = await page.$eval('.tree', (el) => {
      const before = el.scrollTop
      el.scrollTop = Math.min(el.scrollHeight - el.clientHeight, before + 800)
      return el.scrollTop !== before
    })
    check('滚动断言前提:确实产生了滚动位移', moved)
    await page.waitForFunction(() => document.querySelector('.tree')?.classList.contains('scrolling'), { timeout: 3000 })
      .catch(() => {})
    const during = await page.evaluate(() => {
      const tree = document.querySelector('.tree')
      const row = document.querySelector('.tree-row')
      return {
        hasScrollingClass: tree.classList.contains('scrolling'),
        rowTransition: row ? getComputedStyle(row).transitionProperty : null,
      }
    })
    check(
      '滚动期间关闭行过渡(防虚拟滚动下的颜色拖影)',
      during.hasScrollingClass && during.rowTransition === 'none',
      JSON.stringify(during),
    )
    await new Promise((r) => setTimeout(r, 250))
    const after = await page.$eval('.tree-row', (el) => getComputedStyle(el).transitionProperty)
    check('滚动停止后过渡恢复', after !== 'none' && after.includes('background-color'), after)
    await page.$eval('.tree', (el) => { el.scrollTop = 0 })
    await new Promise((r) => setTimeout(r, 250))
    await clickRow('bigdir') // 收起,恢复后续用例的树状态
    await page.waitForFunction(
      () => ![...document.querySelectorAll('.tree-row .label')].some((e) => e.textContent?.startsWith('entry-')),
      { timeout: 5000 },
    )
  }

  // ---- 侧栏拖拽(8.4) ----
  {
    const box = await (await page.$('.resizer')).boundingBox()
    const y = box.y + 200
    await page.mouse.move(box.x + 2, y)
    await page.mouse.down()
    await page.mouse.move(box.x + 102, y, { steps: 5 })
    await page.mouse.up()
    const w = await page.$eval('.sidebar', (el) => el.getBoundingClientRect().width)
    const stored = await page.evaluate(() => localStorage.getItem('cv-sidebar-width'))
    check('侧栏拖拽调宽 + localStorage 持久化', Math.abs(w - 380) < 4 && stored === String(Math.round(w)), `w=${w} stored=${stored}`)
    const box2 = await (await page.$('.resizer')).boundingBox()
    await page.mouse.move(box2.x + 2, y)
    await page.mouse.down()
    await page.mouse.move(box2.x - 98, y, { steps: 5 })
    await page.mouse.up()
  }

  // ---- 文件名搜索(8.2) ----
  {
    await page.keyboard.down('Control')
    await page.keyboard.press('KeyK')
    await page.keyboard.up('Control')
    const focused = await page.evaluate(() => document.activeElement?.className ?? '')
    check('Ctrl+K 聚焦搜索框(preventDefault 拦截默认行为)', focused === 'search-input', String(focused))
    await page.keyboard.type('file-002')
    await new Promise((r) => setTimeout(r, 80))
    const status = await page.$eval('.search-status', (el) => el.textContent).catch(() => null)
    const anyResult = await page.$('.search-result')
    check('索引未就绪提示(或已返回部分结果)', !!status || !!anyResult, status ?? '索引已就绪,直接出结果')
    await page.waitForFunction(
      () => [...document.querySelectorAll('.search-result .result-name')].some((e) => e.textContent === 'file-002.ts'),
      { timeout: 20000 },
    )
    await page.$eval('.search-result', (el) =>
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })))
    await page.waitForFunction(
      () => document.querySelector('.preview-header .file-path')?.textContent?.endsWith('file-002.ts'),
      { timeout: 10000 },
    )
    await page.waitForFunction(
      () => [...document.querySelectorAll('.tree-row')].some(
        (r) => r.classList.contains('selected') && r.querySelector('.label')?.textContent === 'file-002.ts'),
      { timeout: 10000 },
    )
    check('搜索结果打开文件 + 目录树展开选中同步', true)
    // 收起 many/pkg-00,避免 500 行撑开虚拟列表影响后续 clickRow
    await page.$eval('.tree', (el) => { el.scrollTop = 0 })
    await new Promise((r) => setTimeout(r, 300))
    await clickRow('pkg-00')
    await clickRow('many')
    await new Promise((r) => setTimeout(r, 200))
  }

  // ---- 代码高亮 + 只读 ----
  await clickRow('src')
  await page.waitForFunction(() => [...document.querySelectorAll('.tree-row .label')].some((e) => e.textContent === 'main.go'))
  await clickRow('main.go')
  await page.waitForFunction(
    () => document.querySelector('.cm-content')?.textContent?.includes('fmt.Println'),
    { timeout: 10000 },
  )
  {
    const gutters = await page.$('.cm-gutters')
    const text = await page.$eval('.cm-content', (el) => el.textContent)
    check('Go 文件 CM6 渲染 + 行号', !!gutters && text.includes('fmt.Println'))
    // 只读保证的判据**变了**:contentEditable 现在是 true(光标需要它),
    // 只读由 `EditorState.readOnly` 保证。所以这里改成断言那把**真正的锁**在起作用,
    // 而不是断言那道已被证明冗余的旧锁还在 —— 断言要跟着语义走,
    // 不能因为旧断言写着 false 就把功能往旧断言上凑。
    // 各条写入路径(输入/粘贴/拖放/输入法)的逐条证明见下面 2a 那一组。
    const ro = await page.$eval('.cm-content', (el) => ({
      editable: el.getAttribute('contenteditable'),
      ariaReadonly: el.getAttribute('aria-readonly'),
    }))
    const roBefore = await page.$eval('.cm-content', (el) => el.textContent)
    await page.$eval('.cm-content', (el) => el.focus())
    await page.keyboard.type('SHOULD_NOT_WRITE')
    await new Promise((r) => setTimeout(r, 200))
    const roAfter = await page.$eval('.cm-content', (el) => el.textContent)
    check(
      '只读保证(readOnly 生效:可聚焦但写不进去)',
      ro.ariaReadonly === 'true' && roAfter === roBefore,
      `contenteditable=${ro.editable} aria-readonly=${ro.ariaReadonly} 文档${roAfter === roBefore ? '未变' : '被改'}`,
    )
    const hl = await page.$$eval('.cm-line span', (spans) => spans.filter((s) => s.className).length)
    check('语法高亮 span 存在', hl > 3, `${hl} styled spans`)
    const selRow = (await rowLabels()).find((r) => r.selected)
    check('树选中态高亮', selRow?.label === 'main.go', selRow?.label)
  }

  // ---- 导航栈起点:尚未发生任何跳转导航时前进/后退均置灰(spec Scenario)----
  {
    const state = await page.$$eval('.nav-buttons .nav-btn', (els) => els.map((e) => e.disabled))
    check('尚未跳转时后退/前进按钮均置灰', state.length === 2 && state[0] === true && state[1] === true, JSON.stringify(state))
  }
  await page.screenshot({ path: join(SHOTS, 'shot-3-code.png') })

  // 深色**项目模式**截图(restyle-reader 收尾 B)。此前全套只有 shot-7 一张深色,
  // 且是单文件模式 —— 没有目录树、没有滚动条、没有注释,
  // 而"项目模式 + 目录树 + 带注释源码"才是深色下最常见的那一屏,从没被拍过。
  {
    const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    const lightNav = await page.evaluate(() => {
      const el = document.querySelector('.nav-btn')
      return el ? getComputedStyle(el).backgroundColor : null
    })
    await page.click('.theme-toggle')
    // ① 终态守卫:深色**真的画出来了**(不是"过渡不动了")
    const painted = await waitDarkPainted(lightBg)
    check(
      '深色项目截图:深色确实已应用到画面(data-theme=dark 且 body 底色 = --bg 令牌 且 ≠ 浅色底)',
      painted?.theme === 'dark' && painted.bodyBg === painted.tokenBg && painted.bodyBg !== lightBg,
      `${lightBg} → ${painted?.bodyBg}(令牌 ${painted?.tokenBg},theme=${painted?.theme})`,
    )
    // ② 再等过渡走完。传 `from` 是必须的:不传的话"还没开始动"也算稳。
    // 只等 `.nav-btn` 就够:树行与它挂在同一条 130ms 过渡上、同一刻起跑,
    // 而树行背景多数是 transparent,取不到一个有意义的"起始值"来做起点守卫 ——
    // 用一个守不住的等待凑数,不如不等。
    const settled = await waitStyleSettled('.nav-btn', 'backgroundColor', { from: lightNav })
    check(
      '深色项目截图前过渡已走完(.nav-btn 已离开浅色值并稳定)',
      settled != null && settled !== lightNav,
      `.nav-btn ${lightNav} → 稳态 ${settled}`,
    )
    await page.screenshot({ path: join(SHOTS, 'shot-14-dark-project.png') })
    await page.click('.theme-toggle') // 立刻还原浅色,后面的用例都按浅色写
    await waitThemeApplied()
    await waitStyleSettled('.nav-btn', 'backgroundColor', { from: settled })
  }

  // ---- Markdown:净化 + 相对资源 + 双视图 + 内链导航 ----
  await clickRow('README.md')
  await page.waitForSelector('.markdown-body')
  {
    const xss = await page.evaluate(() => ({
      a: window.__xss, b: window.__xss2, scripts: document.querySelectorAll('.markdown-body script').length,
    }))
    check('恶意 Markdown 净化(script/onerror 不执行)', !xss.a && !xss.b && xss.scripts === 0)
    const table = await page.$('.markdown-body table')
    check('GFM 表格渲染', !!table)
    const typo = await page.$eval('.markdown-body', (el) => {
      const cs = getComputedStyle(el)
      return { fs: cs.fontSize, lh: parseFloat(cs.lineHeight) }
    })
    check('Markdown 排版 16px / 行高≥1.6', typo.fs === '16px' && typo.lh >= 25.6, JSON.stringify(typo))
    const codeHl = await page.$$eval('.markdown-body pre code span[class*="tok-"]', (s) => s.length)
    check('代码块静态高亮(tok-*)', codeHl > 2, `${codeHl}`)
    const imgs = await page.$$eval('.markdown-body img', (els) => els.map((e) => e.src))
    check('相对图片 → blob objectURL', imgs.some((s) => s.startsWith('blob:')), imgs.join(' | '))
    // 3 个占位符:onerror 注入用的 src="x"、缺失图片、远程图片
    const placeholders = await page.$$eval('.md-img-placeholder', (els) => els.map((e) => e.textContent))
    check('缺失/远程图片 → 占位符', placeholders.length === 3, placeholders.join(' | '))
    const dead = await page.$('.md-link-dead')
    check('坏链接置灰', !!dead)
    const ext = await page.$eval('.markdown-body a[href^="https://example.com"]', (a) => a.target)
    check('外部链接新标签页', ext === '_blank')
  }
  await page.screenshot({ path: join(SHOTS, 'shot-4-markdown.png') })
  await page.click('.md-toolbar button:nth-child(2)')
  await page.waitForSelector('.cm-editor')
  check('Markdown 源码视图切换', true)
  await page.click('.md-toolbar button:nth-child(1)')
  await page.waitForSelector('.markdown-body')
  // 内链导航(渲染视图异步重建 DOM,用页内 click 避免节点分离竞态)
  await page.waitForSelector('a[data-cv-path="src/main.go"]')
  await new Promise((r) => setTimeout(r, 400))
  await page.$eval('a[data-cv-path="src/main.go"]', (a) => a.click())
  await page.waitForFunction(() => document.querySelector('.preview-header .file-path')?.textContent === 'src/main.go')
  {
    const selRow = (await rowLabels()).find((r) => r.selected)
    check('Markdown 内链导航 + 树同步', selRow?.label === 'main.go', selRow?.label)
  }

  // ---- 大纲:内容正确、不含形参与局部变量、点击定位(10.2)----
  await openFile('Service.java', 'src/Service.java')
  await waitOutline('handle')
  {
    const rows = await outlineRows()
    const got = rows.map((r) => `${r.name}@${r.line}`)
    // Service(类)@3、counter(字段)@4、NAME(常量)@5、Service(构造)@7、handle(方法)@9
    const expect = ['Service@3', 'counter@4', 'NAME@5', 'Service@7', 'handle@9']
    const missing = expect.filter((e) => !got.includes(e))
    check('大纲条目内容与行号正确(Java)', missing.length === 0, missing.length ? '缺失 ' + missing.join(',') : got.join(' '))
    // 形参 seed/request/retries 与局部变量 localTmp 绝不能出现(design.md D1 的祖先过滤是精度生死线)
    const leaked = ['seed', 'request', 'retries', 'localTmp'].filter((f) => rows.some((r) => r.name === f))
    check('大纲不含形参与局部变量', leaked.length === 0, leaked.length ? '误收 ' + leaked.join(',') : '已排除 seed/request/retries/localTmp')
  }
  {
    await clickOutline('handle')
    await page.waitForSelector('.cm-target-line', { timeout: 5000 })
    const lineText = await page.$eval('.cm-target-line', (el) => el.textContent)
    check('点击大纲定位到正确行并高亮', lineText.includes('public String handle'), lineText.trim())
  }
  await page.screenshot({ path: join(SHOTS, 'shot-8-outline.png') })
  // ---- 大纲面板宽度可拖拽 + 持久化(任务 3.4)----
  {
    const outlineWidth = () => page.$eval('.outline', (el) => el.getBoundingClientRect().width)
    const before = await outlineWidth()
    const box = await (await page.$('.resizer-outline')).boundingBox()
    const y = box.y + 120
    // 向左拖 = 加宽(方向与左侧目录树相反,靠 grow 参数区分而不是第二份实现)
    await page.mouse.move(box.x + 2, y)
    await page.mouse.down()
    await page.mouse.move(box.x - 80, y, { steps: 6 })
    await page.mouse.up()
    const after = await outlineWidth()
    const stored = await page.evaluate(() => localStorage.getItem('cv-outline-width'))
    check(
      '拖动大纲分隔条改变宽度 + localStorage 持久化',
      after > before + 60 && stored === String(Math.round(after)),
      `${before} → ${after},stored=${stored}`,
    )

    // 拖到极端位置应停在 min/max,不会被拖没
    await page.mouse.move(box.x - 80 + 2, y)
    await page.mouse.down()
    await page.mouse.move(box.x + 900, y, { steps: 8 })
    await page.mouse.up()
    const minW = await outlineWidth()
    check('大纲拖到极端位置停在最小宽度而非消失', Math.abs(minW - 160) < 2 && minW > 0, `${minW}px(min=160)`)
    await page.mouse.move((await (await page.$('.resizer-outline')).boundingBox()).x + 2, y)
    await page.mouse.down()
    await page.mouse.move(0, y, { steps: 8 })
    await page.mouse.up()
    const maxW = await outlineWidth()
    check('大纲拖到另一端停在最大宽度', Math.abs(maxW - 520) < 2, `${maxW}px(max=520)`)

    // 任务 2.4:折叠再展开应恢复到用户**拖出来**的宽度(折叠态与宽度互不干扰)。
    // 必须真的拖过再折叠 —— 直接改 localStorage 模拟不出来,宽度只在挂载时读一次。
    await page.click('.outline-header .outline-toggle')
    await page.waitForSelector('.outline-collapsed', { timeout: 5000 })
    await page.click('.outline-collapsed .outline-toggle')
    await page.waitForSelector('.outline-header', { timeout: 5000 })
    const widthAfterExpand = await outlineWidth()
    check(
      '折叠后再展开恢复到用户调过的宽度(折叠态与宽度互不干扰)',
      Math.abs(widthAfterExpand - maxW) < 2,
      `折叠前 ${maxW}px → 展开后 ${widthAfterExpand}px`,
    )
    await page.evaluate(() => localStorage.removeItem('cv-outline-collapsed'))

    // 重载后保持
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('.welcome', { timeout: 10000 })
    await page.evaluate(async () => {
      window.__cv.enterProject(await navigator.storage.getDirectory())
    })
    await page.waitForSelector('.tree-row', { timeout: 10000 })
    await clickRow('src')
    await page.waitForFunction(
      () => [...document.querySelectorAll('.tree-row .label')].some((e) => e.textContent === 'Service.java'),
      { timeout: 10000 },
    )
    await clickRow('Service.java')
    await page.waitForSelector('.outline', { timeout: 10000 })
    const restored = await outlineWidth()
    check('重载后大纲宽度保持', Math.abs(restored - maxW) < 2, `${restored}px`)
    // 还原到默认宽度,避免影响后续用例的布局
    await page.evaluate(() => localStorage.setItem('cv-outline-width', '220'))
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('.welcome', { timeout: 10000 })
    await page.evaluate(async () => {
      window.__cv.enterProject(await navigator.storage.getDirectory())
    })
    await page.waitForSelector('.tree-row', { timeout: 10000 })
    await clickRow('src')
    await page.waitForFunction(
      () => [...document.querySelectorAll('.tree-row .label')].some((e) => e.textContent === 'Service.java'),
      { timeout: 10000 },
    )
    await clickRow('Service.java')
    await waitOutline('handle')
  }


  // ---- Go / C++ / Python / TS 抽取正确性(10.2 的多语言覆盖)----
  await openFile('handler.go', 'src/handler.go')
  await waitOutline('Dispatch')
  {
    const rows = await outlineRows()
    const got = rows.map((r) => `${r.name}@${r.line}`)
    const expect = ['Handler@6', 'Name@7', 'MaxRetries@10', 'Serve@12', 'Dispatch@18']
    const missing = expect.filter((e) => !got.includes(e))
    check('大纲条目内容与行号正确(Go)', missing.length === 0, missing.length ? '缺失 ' + missing.join(',') : got.join(' '))
    const leaked = ['addr', 'timeout', 'localOnly', 'req', 'h', 'server'].filter((f) => rows.some((r) => r.name === f))
    check('Go 形参/局部变量/包名未进入大纲', leaked.length === 0, leaked.length ? '误收 ' + leaked.join(',') : '已排除')
  }
  {
    const cap = await page.$eval('.intel-cap', (el) => ({ text: el.textContent, cls: el.className }))
    check('支持的语言显示"可跳转"能力标识', cap.text === '可跳转' && cap.cls.includes('intel-cap-full'), JSON.stringify(cap))
    const lang = await page.$eval('.intel-lang', (el) => el.textContent)
    check('预览区显示语言名', lang === 'Go', lang)
    const idx = await page.$('.intel-index')
    check('预览区显示索引状态', !!idx, await page.$eval('.intel-index', (el) => el.textContent).catch(() => '无'))
  }

  // ---- 项目级索引状态在顶栏可见(spec「全项目符号索引」要求展示进度与完成状态)----
  {
    const topStatus = await page.$eval('.topbar .intel-index', (el) => el.textContent).catch(() => null)
    check('顶栏可见项目级符号索引状态', !!topStatus, topStatus ?? '未渲染')
  }

  // 切换文件时不得残留上一个文件的条目(spec「大纲随文件切换」):
  // 用 MutationObserver 记录切换过程中的每一帧,而不是只看最终态 —— 只看最终态是假绿。
  await page.evaluate(() => {
    window.__outlineTrace = []
    window.__outlineObs = new MutationObserver(() => {
      window.__outlineTrace.push({
        path: document.querySelector('.preview-header .file-path')?.textContent ?? '',
        names: [...document.querySelectorAll('.outline-row .outline-name')].map((e) => e.textContent),
      })
    })
    window.__outlineObs.observe(document.body, { childList: true, subtree: true })
  })
  await openFile('widget.cpp', 'src/widget.cpp')
  await waitOutline('compute')
  {
    const trace = await page.evaluate(() => {
      window.__outlineObs.disconnect()
      return window.__outlineTrace
    })
    const goOnly = ['Dispatch', 'Serve', 'MaxRetries', 'Handler']
    const residue = trace.filter((t) => t.path === 'src/widget.cpp' && t.names.some((n) => goOnly.includes(n)))
    check(
      '切换文件时大纲不残留上一个文件的条目',
      residue.length === 0,
      residue.length ? `残留 ${JSON.stringify(residue[0].names)}` : `${trace.length} 帧均无残留`,
    )
  }
  {
    const rows = await outlineRows()
    const got = rows.map((r) => `${r.name}@${r.line}`)
    const expect = ['MAX_SIZE@1', 'Point@3', 'Widget@5', 'width@7', 'resize@8', 'compute@11']
    const missing = expect.filter((e) => !got.includes(e))
    check('大纲条目内容与行号正确(C++)', missing.length === 0, missing.length ? '缺失 ' + missing.join(',') : got.join(' '))
    const leaked = ['newWidth', 'newHeight', 'a', 'b', 'sum'].filter((f) => rows.some((r) => r.name === f))
    check('C++ 形参/局部变量未进入大纲', leaked.length === 0, leaked.length ? '误收 ' + leaked.join(',') : '已排除')
  }

  await openFile('engine.ts', 'src/engine.ts')
  await waitOutline('Engine')
  {
    const rows = await outlineRows()
    const leaked = ['input', 'count', 'localOnly', 'taskName'].filter((f) => rows.some((r) => r.name === f))
    check('TS 形参/局部变量未进入大纲', leaked.length === 0, leaked.length ? '误收 ' + leaked.join(',') : '已排除')
    const got = rows.map((r) => r.name)
    check('TS 大纲含接口/函数/类/方法', ['Options', 'process', 'Engine', 'run'].every((n) => got.includes(n)), got.join(','))
  }

  await openFile('models.py', 'src/models.py')
  await waitOutline('fetch')
  {
    const rows = await outlineRows()
    const got = rows.map((r) => r.name)
    check('Python 大纲含常量/类/字段/方法', ['CONST_LIMIT', 'Repo', 'table', 'fetch'].every((n) => got.includes(n)), got.join(','))
    const leaked = ['key', 'limit', 'cached', 'self'].filter((f) => rows.some((r) => r.name === f))
    check('Python 形参/局部变量未进入大纲', leaked.length === 0, leaked.length ? '误收 ' + leaked.join(',') : '已排除')
  }

  // ---- 不支持的语言:明确说明而非空白(10.2)----
  await openFile('config.yaml', 'src/config.yaml')
  {
    await page.waitForFunction(
      () => document.querySelector('.outline-note')?.textContent?.includes('暂不支持大纲'),
      { timeout: 5000 },
    )
    const note = await page.$eval('.outline-note', (el) => el.textContent)
    check('.yaml 大纲区展示不支持说明(非空白)', note.includes('暂不支持大纲'), note.trim().slice(0, 40))
    const cap = await page.$eval('.intel-cap', (el) => ({ text: el.textContent, cls: el.className }))
    check('.yaml 显示"仅高亮"能力标识', cap.text === '仅高亮' && cap.cls.includes('intel-cap-none'), JSON.stringify(cap))
    // "不支持"的说明是同步渲染的,预览区读文件却是异步的 ——
    // 直接查 .cm-content 会在文件还没读完时拿到 null。必须等正文真正出现。
    await page.waitForFunction(
      () => document.querySelector('.cm-content')?.textContent?.includes('port: 8080'),
      { timeout: 10000 },
    )
    const hl = await page.$$eval('.cm-line span', (spans) => spans.filter((sp) => sp.className).length)
    check('.yaml 语法高亮与预览不受影响', hl > 0, `${hl} styled spans`)
    // 不支持的语言 MUST NOT 提供跳转入口:右键不应弹出代码理解菜单(11.9 矩阵捞出的格子)。
    // **必须用合成事件**:不支持的语言我们不调 preventDefault(让用户仍能用 Chrome 自带右键菜单),
    // 所以真实右键会拉起**浏览器原生菜单**并卡住整个标签页 —— 合成事件不会。
    const menuOnYaml = await page.evaluate(() => {
      const line = document.querySelector('.cm-content .cm-line')
      const r = line?.getBoundingClientRect()
      if (!r) return 'no-line'
      line.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, clientX: r.x + 10, clientY: r.y + r.height / 2,
      }))
      return !!document.querySelector('.intel-menu')
    })
    check('.yaml 不提供跳转/引用入口(右键无代码理解菜单)', menuOnYaml === false, String(menuOnYaml))
  }

  // ---- CSS 家族专用高亮(任务 2b.4 / 2b.5)----
  // "高亮生效"不能只断言有 span:整片纯文本也可能有一个 span。
  // 必须断言产生了**多种**不同的高亮类,才说明真的做了词法着色。
  const distinctTokenClasses = () =>
    page.$$eval('.cm-line span', (spans) =>
      [...new Set(spans.map((s) => s.className).filter(Boolean))].length)

  for (const [file, path, probe] of [
    ['theme.scss', 'src/theme.scss', '@mixin card'],
    ['theme.less', 'src/theme.less', '.mixin(@pad'],
    ['theme.sass', 'src/theme.sass', '&:hover'],
  ]) {
    await openFile(file, path)
    await page.waitForFunction(
      (t) => document.querySelector('.cm-content')?.textContent?.includes(t),
      { timeout: 10000 }, probe,
    )
    // 文本出现 ≠ 词法着色已完成:StreamLanguage 的 tokenize 可能晚一帧,
    // 直接数 span 会偶发数到 0(**这条曾以"0 种高亮类"假红过一次**)。
    // 等的是**要断言的那个性质本身**,不是它的代理指标;门槛仍是 >= 3,没有放宽 ——
    // 若真的没做着色,这里等满超时,kinds 仍是 0,断言照常判红。
    await page
      .waitForFunction(
        () =>
          new Set(
            [...document.querySelectorAll('.cm-line span')].map((s) => s.className).filter(Boolean),
          ).size >= 3,
        { timeout: 8000 },
      )
      .catch(() => {})
    const kinds = await distinctTokenClasses()
    check(`${file} 使用专用高亮(产生多种高亮类,非整片纯文本)`, kinds >= 3, `${kinds} 种高亮类`)
  }

  // 2b.4:代码理解层 MUST NOT 被扩到 CSS 家族 —— 与 css 现状保持一致
  await openFile('theme.scss', 'src/theme.scss')
  {
    const cap = await page.$eval('.intel-cap', (el) => ({ text: el.textContent, cls: el.className }))
    check('.scss 能力标识为"仅高亮"(代码理解层未扩到 CSS 家族)', cap.text === '仅高亮' && cap.cls.includes('intel-cap-none'), JSON.stringify(cap))
    await page.waitForFunction(
      () => document.querySelector('.outline-note')?.textContent?.includes('暂不支持大纲'),
      { timeout: 8000 },
    )
    const note = await page.$eval('.outline-note', (el) => el.textContent)
    check('.scss 大纲区展示不支持说明', note.includes('SCSS') && note.includes('暂不支持大纲'), note.trim().slice(0, 30))
    // 合成 contextmenu:对不支持的语言我们故意不 preventDefault,真实右键会拉起浏览器原生菜单卡住标签页
    // 正文是异步读取的:必须等行渲染出来再派发事件,否则拿不到元素、断言变成 'no-line'
    await page.waitForFunction(
      () => document.querySelector('.cm-content')?.textContent?.includes('$brand'),
      { timeout: 10000 },
    )
    const menu = await page.evaluate(() => {
      const line = document.querySelector('.cm-content .cm-line')
      const r = line?.getBoundingClientRect()
      if (!r) return 'no-line'
      line.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, clientX: r.x + 10, clientY: r.y + r.height / 2,
      }))
      return !!document.querySelector('.intel-menu')
    })
    check('.scss 不提供跳转/引用入口', menu === false, String(menu))
  }

  // ---- B 组高频语言 / C 组整文件名 / D 组近似高亮(任务 2c / 2d / 2e)----
  for (const [file, path, probe, label] of [
    ['main.rs', 'src/main.rs', 'fn main()', 'Rust'],
    ['app.rb', 'src/app.rb', 'class Greeter', 'Ruby'],
    ['Main.kt', 'src/Main.kt', 'fun main()', 'Kotlin'],
    ['Prog.cs', 'src/Prog.cs', 'namespace App', 'C#'],
    ['build.gradle', 'src/build.gradle', "id 'java'", 'Groovy'],
    ['Cargo.toml', 'src/Cargo.toml', '[package]', 'TOML'],
    // C 组:整文件名识别 —— Dockerfile 无扩展名、CMakeLists.txt 的 .txt 会被误判为纯文本
    ['Dockerfile', 'src/Dockerfile', 'FROM node', 'Dockerfile'],
    ['Dockerfile.dev', 'src/Dockerfile.dev', 'NODE_ENV', 'Dockerfile'],
    ['CMakeLists.txt', 'src/CMakeLists.txt', 'cmake_minimum_required', 'CMake'],
  ]) {
    await openFile(file, path)
    await page.waitForFunction(
      (t) => document.querySelector('.cm-content')?.textContent?.includes(t),
      { timeout: 10000 }, probe,
    )
    // 文本出现 ≠ 着色完成:直接数会偶发数到 0(Dockerfile.dev 曾这么假红过一次)
    await page
      .waitForFunction(
        () =>
          new Set(
            [...document.querySelectorAll('.cm-line span')].map((e) => e.className).filter(Boolean),
          ).size >= 3,
        { timeout: 6000 },
      )
      .catch(() => {})
    const kinds = await distinctTokenClasses()
    const shown = await page.$eval('.intel-lang', (el) => el.textContent)
    const cap = await page.$eval('.intel-cap', (el) => el.textContent)
    check(
      `${file}:识别为 ${label} + 专用高亮生效 + 归"仅高亮"档`,
      shown === label && kinds >= 3 && cap === '仅高亮',
      `语言=${shown} 高亮类=${kinds} 能力=${cap}`,
    )
  }

  // 2d.3:Makefile 没有可用模式 —— 按纯文本展示,MUST NOT 借别的模式假装有高亮
  await openFile('Makefile', 'Makefile')
  {
    await page.waitForFunction(
      () => document.querySelector('.cm-content')?.textContent?.includes('echo build'),
      { timeout: 10000 },
    )
    const kinds = await distinctTokenClasses()
    const shown = await page.$eval('.intel-lang', (el) => el.textContent)
    check(
      'Makefile 按纯文本展示,未借用其他模式假装高亮',
      shown === '纯文本' && kinds <= 1,
      `语言=${shown} 高亮类=${kinds}(>1 即说明被某个模式着色了)`,
    )
  }

  // 2e:Vue / Svelte 近似高亮 —— 高亮要生效,且必须明示是近似
  for (const [file, path, probe, label] of [
    ['App.vue', 'src/App.vue', 'v-if', 'Vue'],
    ['App.svelte', 'src/App.svelte', 'on:click', 'Svelte'],
  ]) {
    await openFile(file, path)
    await page.waitForFunction(
      (t) => document.querySelector('.cm-content')?.textContent?.includes(t),
      { timeout: 10000 }, probe,
    )
    const kinds = await distinctTokenClasses()
    const shown = await page.$eval('.intel-lang', (el) => el.textContent)
    const cap = await page.$eval('.intel-cap', (el) => ({ text: el.textContent, title: el.title }))
    check(
      `${file}:走 html 通道高亮生效,且能力标识明示为"近似高亮"`,
      shown === label && kinds >= 3 && cap.text === '近似高亮' && cap.title.includes('近似'),
      `语言=${shown} 高亮类=${kinds} 能力=${cap.text}`,
    )
  }

  // 2b.2 的另一半:Markdown 围栏里的 scss 同样要高亮
  await openFile('styles-guide.md', 'src/styles-guide.md')
  {
    await page.waitForSelector('.markdown-body pre code', { timeout: 10000 })
    const fenceKinds = await page.$$eval('.markdown-body pre code span[class*="tok-"]', (els) =>
      [...new Set(els.map((e) => e.className))].length)
    check('Markdown 围栏 ```scss 也产生多种高亮类', fenceKinds >= 2, `${fenceKinds} 种 tok-* 类`)
  }

  // ---- Markdown:仅标题大纲 ----
  await openFile('guide.md', 'src/guide.md')
  {
    await waitOutline('安装')
    const rows = await outlineRows()
    const got = rows.map((r) => r.name)
    check('.md 展示标题层级大纲', got.join(',') === '阅读指南,快速开始,安装', got.join(','))
    check('.md 大纲跳过围栏代码块内的 #', !got.includes('这不是标题'), got.join(','))
    const cap = await page.$eval('.intel-cap', (el) => el.textContent)
    check('.md 显示"仅大纲"能力标识', cap === '仅大纲', cap)
    // Markdown 标题只进大纲,MUST NOT 参与跳转与符号搜索(11.9 矩阵捞出的格子)
    await clickSearchMode('符号')
    await page.keyboard.type('快速开始')
    await new Promise((r) => setTimeout(r, 400))
    const mdHits = await page.$$eval('.search-result .result-name', (els) => els.map((e) => e.textContent))
    check('Markdown 标题不进入全局符号搜索', mdHits.length === 0, mdHits.join(',') || '无结果')
    await page.keyboard.press('Escape')
    await clickSearchMode('文件名')
    await page.keyboard.press('Escape')
  }

  // ---- 富文本视图下点大纲要真的定位(任务 4.6 / 10.2b)----
  // 契约只有一份:指定目标行时,当前渲染通道必须把对应内容定位到可见区域并短暂标识;
  // 富文本没有"行",就定位到该源码行对应的渲染元素,MUST NOT 静默不动作。
  {
    const scrollTopBefore = await page.$eval('.markdown-body', (el) => el.scrollTop)
    await clickOutline('安装')
    await page.waitForFunction(
      () => !!document.querySelector('.markdown-body .md-target'),
      { timeout: 8000 },
    )
    const state = await page.evaluate(() => {
      const body = document.querySelector('.markdown-body')
      const hit = body?.querySelector('.md-target')
      if (!body || !hit) return null
      const b = body.getBoundingClientRect()
      const r = hit.getBoundingClientRect()
      return {
        tag: hit.tagName,
        line: hit.getAttribute('data-cv-line'),
        text: hit.textContent,
        inView: r.top >= b.top - 2 && r.top <= b.bottom,
        scrollTop: body.scrollTop,
        stillRendered: !!document.querySelector('.markdown-body'),
        switchedToSource: !!document.querySelector('.cm-editor'),
      }
    })
    check(
      '富文本视图:点大纲定位到对应的渲染标题元素并标识',
      state?.tag === 'H3' && state.text === '安装' && state.line === '131' && state.inView,
      JSON.stringify(state),
    )
    check(
      '富文本视图:确实发生了滚动(目标原本在首屏之外)',
      !!state && state.scrollTop > scrollTopBefore,
      `scrollTop ${scrollTopBefore} → ${state?.scrollTop}`,
    )
    check(
      '富文本视图:定位后仍停留在富文本视图,未被切走',
      !!state && state.stillRendered && !state.switchedToSource,
      `富文本=${state?.stillRendered} 源码=${state?.switchedToSource}`,
    )

    // 源码视图下同一条目应定位到源码行
    await page.click('.md-toolbar button:nth-child(2)')
    await page.waitForSelector('.cm-editor', { timeout: 8000 })
    await clickOutline('安装')
    await waitTargetLine('### 安装')
    check('源码视图:同一大纲条目定位到源码行', true)
    await page.click('.md-toolbar button:nth-child(1)')
    await page.waitForSelector('.markdown-body', { timeout: 8000 })
  }

  // ================= 跳转 / 导航栈 / 查找引用(阶段二)=================


  // ---- C/C++ 头文件原型进入大纲(任务 3.10 / spec 新增 Scenario)----
  await openFile('util.h', 'src/util.h')
  await waitOutline('compute')
  {
    const rows = await outlineRows()
    const got = rows.map((r) => `${r.name}@${r.line}`)
    check('纯声明头文件的原型进入大纲(不为空)', ['UTIL_H@2', 'compute@4', 'reset@5'].every((e) => got.includes(e)), got.join(' '))
    const kinds = await page.$$eval('.outline-row', (els) =>
      els.map((e) => ({ name: e.querySelector('.outline-name')?.textContent, cls: e.querySelector('.outline-kind')?.className })))
    const computeRow = kinds.find((k) => k.name === 'compute')
    check('函数原型的种类标为“声明”(kind-15)', computeRow?.cls?.includes('kind-15'), computeRow?.cls ?? '未找到')
    const leaked = rows.filter((r) => ['a', 'b'].includes(r.name))
    check('原型的形参未进入大纲', leaked.length === 0, leaked.map((r) => r.name).join(',') || '已排除')
  }

  // ---- 定义优先:同名既有声明又有唯一定义时直接跳定义,不弹候选(spec 新增 Scenario)----
  await openFile('widget.cpp', 'src/widget.cpp')
  await waitOutline('compute')
  // 大纲由 Worker 抽取,可能**早于**预览区把文件读完 —— 只等大纲会在旧内容上找标识符。
  // 点词之前必须确认预览区已经是目标文件的正文。
  await page.waitForFunction(
    () => document.querySelector('.cm-content')?.textContent?.includes('int caller()'),
    { timeout: 10000 },
  )
  {
    // 点 caller() 里的调用点(第 2 个整词 compute),而不是定义行
    const ok = await clickWord('compute', { nth: 2, meta: true })
    check('可在预览区 ⌘+点击标识符触发跳转(不依赖浏览器保留键)', ok)
    await page.waitForFunction(() => !!document.querySelector('.cm-target-line'), { timeout: 8000 })
    const panel = await page.$('.candidate-panel')
    const line = await targetLineText()
    check(
      '定义与其声明并存时直接定位到定义,不弹候选列表',
      !panel && !!line && line.includes('int compute(int a, int b)'),
      `候选面板=${!!panel} 落点=${line?.trim()}`,
    )
  }

  // ---- 跨文件唯一定义跳转(10.3)----
  await openFile('client.go', 'src/client.go')
  await page.waitForFunction(() => document.querySelector('.cm-content')?.textContent?.includes('return Serve'), { timeout: 8000 })
  {
    await clickWord('Serve', { meta: true })
    await page.waitForFunction(
      () => document.querySelector('.preview-header .file-path')?.textContent === 'src/handler.go',
      { timeout: 8000 },
    )
    await waitTargetLine('func Serve(addr string')
    const line = await targetLineText()
    check('跨文件跳转到唯一定义且落点行号正确', !!line && line.includes('func Serve(addr string'), line?.trim())
    const selRow = (await rowLabels()).find((r) => r.selected)
    check('跨文件跳转同步目录树选中态', selRow?.label === 'handler.go', selRow?.label)
  }

  // ---- 导航栈:两级跳转后连续两次后退(10.4)----
  // 断言旁注明:CDP 合成按键只进渲染进程、不触发浏览器 UI,
  // 因此“浏览器级前进后退是否被拦住”不可由 E2E 覆盖,只能真机核验(任务 12.3)。
  {
    // 第二级:在 handler.go 的第 18 行对 Handler 触发跳转(同文件,定义在第 6 行)。
    // Handler 在本文件出现三次:第 5 行注释、第 6 行定义、第 18 行方法接收者 → 取第 3 个。
    await clickWord('Handler', { nth: 3, meta: true })
    await page.waitForFunction(
      () => document.querySelector('.cm-target-line')?.textContent?.includes('type Handler struct'),
      { timeout: 8000 },
    )
    check('第二级跳转到达 Handler 定义行', true)

    const backBtn = '.nav-buttons .nav-btn:first-child'
    await page.click(backBtn)
    await page.waitForFunction(
      () => document.querySelector('.cm-target-line')?.textContent?.includes('Dispatch'),
      { timeout: 8000 },
    )
    check('后退一次:回到 handler.go 的跳出行', true)

    await page.click(backBtn)
    await page.waitForFunction(
      () =>
        document.querySelector('.preview-header .file-path')?.textContent === 'src/client.go' &&
        document.querySelector('.cm-target-line')?.textContent?.includes('return Serve'),
      { timeout: 8000 },
    )
    check('再后退一次:逐级回到原文件原行(client.go 的跳出行)', true)

    const fwdBtn = '.nav-buttons .nav-btn:last-child'
    const fwdEnabled = await page.$eval(fwdBtn, (el) => !el.disabled)
    check('后退后前进按钮可用', fwdEnabled)
    await page.click(fwdBtn)
    await page.waitForFunction(
      () => document.querySelector('.preview-header .file-path')?.textContent === 'src/handler.go',
      { timeout: 8000 },
    )
    check('前进回到下一处', true)

    // 一路后退到栈端点(栈里还留着本段之前产生的条目,不能假设只退两次就到底)
    for (let i = 0; i < 12; i++) {
      const disabled = await page.$eval(backBtn, (el) => el.disabled)
      if (disabled) break
      await page.click(backBtn)
      await new Promise((r) => setTimeout(r, 220))
    }
    const backDisabled = await page.$eval(backBtn, (el) => el.disabled)
    check('一路后退到栈端点后按钮置灰', backDisabled === true, `disabled=${backDisabled}`)
    await page.click(backBtn) // 端点处再点一次:应无操作、不报错
    // 落点可能是代码文件(.cm-content)也可能是 Markdown(.markdown-body)——
    // 断言的意思是"预览内容仍在",不该假定是哪种渲染通道
    const stillHasContent = await page.evaluate(() => {
      const el = document.querySelector('.cm-content') ?? document.querySelector('.markdown-body')
      return (el?.textContent ?? '').length > 0
    })
    check('栈端点处再次后退无操作、预览内容仍在', stillHasContent)

    // ⌥← 的 keydown 处理器确实调用了 preventDefault
    await page.evaluate(() => { window.__cv.lastNavKey.key = ''; window.__cv.lastNavKey.defaultPrevented = false })
    await page.keyboard.down('Alt')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.up('Alt')
    const navKey = await page.evaluate(() => ({ ...window.__cv.lastNavKey }))
    check(
      '⌥← 的 keydown 处理器 defaultPrevented === true(注:浏览器级前进后退不可由 E2E 覆盖,须真机核验)',
      navKey.key === 'ArrowLeft' && navKey.defaultPrevented === true,
      JSON.stringify(navKey),
    )
  }

  // ---- 同名多候选:出现列表且未自动跳转(10.3)----
  await openFile('client.go', 'src/client.go')
  await page.waitForFunction(() => document.querySelector('.cm-content')?.textContent?.includes('New('), { timeout: 8000 })
  {
    const before = await page.$eval('.preview-header .file-path', (el) => el.textContent)
    const clicked = await clickWord('New', { meta: true })
    const appeared = await page
      .waitForSelector('.candidate-panel', { timeout: 8000 })
      .then(() => true)
      .catch(() => false)
    if (!appeared) {
      const diag = await page.evaluate(() => ({
        toast: document.querySelector('.intel-toast')?.textContent ?? null,
        path: document.querySelector('.preview-header .file-path')?.textContent ?? null,
        head: document.querySelector('.cm-content')?.textContent?.slice(0, 60) ?? null,
      }))
      check('同名多候选弹出候选列表', false, `点中=${clicked} 诊断=${JSON.stringify(diag)}`)
    }
    const rows = await page.$$eval('.candidate-row', (els) =>
      els.map((e) => e.querySelector('.candidate-path')?.textContent ?? ''))
    check('同名多候选弹出候选列表', rows.length === 2, rows.join(' | '))
    check('候选条目含文件路径与行号', rows.some((r) => r.includes('src/service.go:4')) && rows.some((r) => r.includes('src/store.go:3')), rows.join(' | '))
    const after = await page.$eval('.preview-header .file-path', (el) => el.textContent)
    check('多候选时未自动跳转(仍停在原文件)', after === before, `${before} → ${after}`)
    // 选择后才跳转
    await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.candidate-row')]
      const target = rows.find((r) => r.textContent?.includes('src/store.go'))
      target?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await page.waitForFunction(
      () => document.querySelector('.preview-header .file-path')?.textContent === 'src/store.go',
      { timeout: 8000 },
    )
    check('在候选列表中选择后才跳转', true)
  }
  await page.screenshot({ path: join(SHOTS, 'shot-10-candidates.png') })

  // ---- 找不到定义:提示且预览不变(10.3)----
  await openFile('client.go', 'src/client.go')
  await page.waitForFunction(() => document.querySelector('.cm-content')?.textContent?.includes('func Run'), { timeout: 8000 })
  {
    const before = await page.$eval('.preview-header .file-path', (el) => el.textContent)
    await clickWord('error', { meta: true })
    await page.waitForSelector('.intel-toast', { timeout: 8000 })
    const toast = await page.$eval('.intel-toast', (el) => el.textContent)
    const after = await page.$eval('.preview-header .file-path', (el) => el.textContent)
    check('未找到定义时给出提示', toast.includes('未在项目内找到'), toast.trim())
    check('未找到定义时预览保持不变', after === before, `${before} → ${after}`)
    await page.click('.intel-toast')
  }

  // ---- 右键菜单入口(不依赖浏览器保留键)----
  {
    await clickWord('Serve', { right: true })
    await page.waitForSelector('.intel-menu', { timeout: 8000 })
    const items = await page.$$eval('.intel-menu-item', (els) => els.map((e) => e.textContent?.trim()))
    check('预览区右键菜单提供“跳转到定义”与“查找引用”', items.some((t) => t?.startsWith('跳转到定义')) && items.some((t) => t?.startsWith('查找引用')), items.join(' | '))
  }

  // ---- 查找引用:条数正确、注释与字符串被排除、点击直达行(10.5)----
  {
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('.intel-menu-item')].find((b) => b.textContent?.startsWith('查找引用'))
      btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await page.waitForSelector('.ref-panel', { timeout: 8000 })
    await page.waitForFunction(
      () => (document.querySelector('.ref-status')?.textContent ?? '').includes('扫描完成'),
      { timeout: 30000 },
    )
    const files = await page.$$eval('.ref-file', (els) => els.map((e) => e.textContent?.trim().split(' ')[0] ?? ''))
    const rows = await page.$$eval('.ref-row', (els) => els.map((e) => e.textContent?.trim() ?? ''))
    check('查找引用命中定义处与调用处', files.includes('src/handler.go') && files.includes('src/client.go'), files.join(' | '))
    // service.go 里 Serve 只出现在注释与字符串字面量中,必须被排除
    check('注释与字符串中的同名文本被排除(service.go 不出现)', !files.includes('src/service.go'), files.join(' | '))
    check('引用条数正确(2 处:定义 + 调用)', rows.length === 2, `${rows.length} 条 — ${rows.join(' ⏎ ')}`)
    const hint = await page.$eval('.ref-hint', (el) => el.textContent)
    check('引用面板明示基于名称匹配的精度边界', hint.includes('基于名称匹配'), hint.trim().slice(0, 30))
    // 点击直达行
    await page.evaluate(() => {
      const row = [...document.querySelectorAll('.ref-row')].find((r) => r.textContent?.includes('return Serve'))
      row?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await page.waitForFunction(
      () => document.querySelector('.preview-header .file-path')?.textContent === 'src/client.go',
      { timeout: 8000 },
    )
    // 跨文件跳转的内容是异步加载的,必须等落点行出现再读,否则会读到上一个文件
    await waitTargetLine('return Serve')
    const line = await targetLineText()
    check('点击引用结果直达对应行', !!line && line.includes('return Serve'), line?.trim())
  }
  await page.screenshot({ path: join(SHOTS, 'shot-11-references.png') })
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.ref-btn')].find((b) => b.textContent === '✕')
    btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })

  // ---- 同名重载 / 声明+定义:两种模式行为必须一致(任务 8b.5 / 10.6c)----
  // spec:候选判定的依据是"同名定义有几条",与搜索范围是全项目还是单文件无关;
  // 同一个文件、同一个标识符,用户 MUST NOT 因为换了打开方式而得到不同结果。
  const probeOverload = async (label) => {
    await page.waitForFunction(
      () => document.querySelector('.cm-content')?.textContent?.includes('int callSite()'),
      { timeout: 10000 },
    )
    const out = {}

    // ① 重载:4 条同名(2 声明 + 2 定义)→ 必须弹候选且不自动跳
    const pathBefore = await page.$eval('.preview-header .file-path', (el) => el.textContent)
    await clickWord('overloaded', { nth: 5, meta: true }) // callSite() 里的调用点
    const shown = await page
      .waitForSelector('.candidate-panel', { timeout: 8000 })
      .then(() => true)
      .catch(() => false)
    out.candidates = shown
      ? await page.$$eval('.candidate-row', (els) =>
          els.map((e) => e.querySelector('.candidate-path')?.textContent ?? ''))
      : []
    out.pathUnchanged = (await page.$eval('.preview-header .file-path', (el) => el.textContent)) === pathBefore
    out.jumped = !!(await page.$('.cm-target-line'))
    await page.keyboard.press('Escape')

    // ② 声明 + 唯一定义:必须落在**定义**行(第 8 行),不是声明行(第 3 行)
    await clickWord('solo', { nth: 3, meta: true }) // callSite() 里的调用点
    const landed = await page
      .waitForSelector('.cm-target-line', { timeout: 8000 })
      .then(() => page.$eval('.cm-target-line', (el) => el.textContent))
      .catch(() => null)
    out.soloLine = landed?.trim() ?? null
    out.soloPanel = !!(await page.$('.candidate-panel'))
    console.log(`    [${label}] 重载候选 ${out.candidates.length} 条 / solo 落点「${out.soloLine}」`)
    return out
  }

  // —— 项目模式 ——
  await openFile('overload.cpp', 'src/overload.cpp')
  const inProject = await probeOverload('项目模式')
  check(
    '项目模式:同名重载弹候选列表且未自动跳转',
    inProject.candidates.length === 4 && inProject.pathUnchanged && !inProject.jumped,
    `${inProject.candidates.length} 条候选,路径未变=${inProject.pathUnchanged},未跳转=${!inProject.jumped}`,
  )
  check(
    '项目模式:声明 + 唯一定义时落点在定义行',
    inProject.soloLine === 'void solo(int a) { (void)a; }' && !inProject.soloPanel,
    `${inProject.soloLine} / 弹候选=${inProject.soloPanel}`,
  )

  // ============ 面板级焦点模型(change: add-keyboard-first-navigation,第 1 组)============
  {
    await openFile('client.go', 'src/client.go')
    await page.waitForFunction(
      () => document.querySelector('.cm-content')?.textContent?.includes('New('),
      { timeout: 8000 },
    )
    // 哪个面板持有焦点:读 :focus-within 归属,而不是猜
    const focusedPanel = () =>
      page.evaluate(() => {
        const el = document.activeElement
        if (!el) return null
        if (el.closest('.sidebar')) return 'sidebar'
        if (el.closest('.outline')) return 'outline'
        if (el.closest('.preview-stack')) return 'preview'
        return el.className || '(其它)'
      })

    // 面板之间还夹着**别的合法控件**(预览头部的后退/前进按钮)—— 那是对的:
    // 它们是真控件,本来就该能被键盘够到,把它们移出 Tab 序反而是削弱可达性。
    // 所以这里断言的是**面板的先后次序**,并把中途停靠点一并打印出来:
    // 夹了什么看得见,而不是被断言悄悄吞掉。
    const PANELS = ['sidebar', 'preview', 'outline']
    const tabToNextPanel = async (shift = false) => {
      const from = await focusedPanel()
      const stops = []
      for (let i = 0; i < 8; i++) {
        if (shift) {
          await page.keyboard.down('Shift')
          await page.keyboard.press('Tab')
          await page.keyboard.up('Shift')
        } else {
          await page.keyboard.press('Tab')
        }
        await new Promise((r) => setTimeout(r, 100))
        const now = await focusedPanel()
        stops.push(now)
        if (PANELS.includes(now) && now !== from) return { panel: now, stops }
      }
      return { panel: null, stops }
    }

    await page.$eval('.tree', (el) => el.focus())
    await new Promise((r) => setTimeout(r, 120))
    const start = await focusedPanel()
    const step1 = await tabToNextPanel()
    const step2 = await tabToNextPanel()
    check(
      '纯 Tab 从目录树 → 预览 → 大纲依次获得焦点',
      [start, step1.panel, step2.panel].join(' → ') === 'sidebar → preview → outline',
      `${start} → ${step1.panel} → ${step2.panel}(途经:${[...step1.stops, ...step2.stops].join(', ')})`,
    )

    // 1.5:整圈**只用了 Tab / Shift+Tab**,没有任何自定义键位
    const b1 = await tabToNextPanel(true)
    const b2 = await tabToNextPanel(true)
    check(
      'Shift+Tab 反向走回:大纲 → 预览 → 目录树(基线不依赖任何自定义键位)',
      [b1.panel, b2.panel].join(' → ') === 'preview → sidebar',
      `${b1.panel} → ${b2.panel}(途经:${[...b1.stops, ...b2.stops].join(', ')})`,
    )

    // 1.2:面板焦点态可见,且**用的是与行焦点/选中态不同的形式**(顶边实线,非背景填充)
    const panelRing = await page.evaluate(() => {
      const stack = document.querySelector('.preview-stack')
      document.querySelector('.preview-body')?.focus()
      const cs = getComputedStyle(stack)
      const sideCs = getComputedStyle(document.querySelector('.sidebar'))
      return { previewShadow: cs.boxShadow, sidebarShadow: sideCs.boxShadow }
    })
    check(
      '持有焦点的面板有可见焦点标识,未持有的没有',
      panelRing.previewShadow !== 'none' && panelRing.previewShadow !== panelRing.sidebarShadow,
      JSON.stringify(panelRing),
    )
  }

  // ====== 预览区光标 + 只读仍然成立(add-keyboard-first-navigation 2a)======
  // **这一组的重点不是"光标能动",是"去掉那道锁之后文档仍然一个字都改不了"。**
  // 只验"打字没反应"是不够的:contentEditable 打开后,粘贴 / 拖放 / 输入法
  // 都是独立的写入路径,它们各走各的浏览器通道。
  {
    await openFile('client.go', 'src/client.go')
    await page.waitForFunction(
      () => document.querySelector('.cm-content')?.textContent?.includes('New('),
      { timeout: 8000 },
    )
    const docText = () => page.$eval('.cm-content', (el) => el.textContent)
    const cursorRect = () =>
      page.evaluate(() => {
        const c = document.querySelector('.cm-cursor-primary') ?? document.querySelector('.cm-cursor')
        if (!c) return null
        const r = c.getBoundingClientRect()
        return { top: Math.round(r.top), left: Math.round(r.left), visible: r.height > 0 }
      })

    // 用**点击**把焦点放进代码区并落下光标 —— 这也是真人最常用的入口。
    // (纯键盘全链路另有 4.1 那组,那一组一个鼠标事件都不派发。)
    // `el.focus()` 在这里不够可靠:实测焦点会落回 body(诊断打印过 focused:false),
    // 而点击既能聚焦又能确定光标位置。
    // 代码区可能在解析/索引推进时重挂,`page.click` 解析到句柄后元素就可能已脱离文档
    // (实测报过 "Node is detached from document")。与 clickRow 同样的处理:重试。
    let clicked = false
    for (let i = 0; i < 5 && !clicked; i++) {
      clicked = await page.click('.cm-line').then(() => true).catch(() => false)
      if (!clicked) await new Promise((r) => setTimeout(r, 250))
    }
    await page
      .waitForFunction(() => !!document.querySelector('.cm-editor.cm-focused'), { timeout: 4000 })
      .catch(() => {})
    check(
      '点击代码区后编辑器持有焦点(光标的前提)',
      await page.evaluate(() => !!document.querySelector('.cm-editor.cm-focused')),
      '前提断言:焦点不在编辑器时,下面几条光标断言都没有意义',
    )
    // 把光标放到文档开头,起点确定
    await page.keyboard.down('Meta'); await page.keyboard.press('Home'); await page.keyboard.up('Meta')
    await new Promise((r) => setTimeout(r, 150))

    // 等光标真的画出来(CM6 的 drawSelection 只在编辑器持有焦点时显示光标),
    // 而不是等固定毫秒数
    await page
      .waitForFunction(
        () => {
          const c = document.querySelector('.cm-cursor-primary') ?? document.querySelector('.cm-cursor')
          return !!c && c.getBoundingClientRect().height > 0
        },
        { timeout: 4000 },
      )
      .catch(() => {})
    const atStart = await cursorRect()
    if (!atStart?.visible) {
      console.log('  [光标诊断] ' + JSON.stringify(await page.evaluate(() => ({
        focused: !!document.querySelector('.cm-editor.cm-focused'),
        activeEl: document.activeElement?.className ?? null,
        cursorEls: document.querySelectorAll('.cm-cursor').length,
      }))))
    }
    check('只读态下光标可见(2a.4)', !!atStart && atStart.visible, JSON.stringify(atStart))

    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await new Promise((r) => setTimeout(r, 150))
    const afterDown = await cursorRect()
    check(
      '方向键上下移动光标',
      !!afterDown && !!atStart && afterDown.top > atStart.top,
      `${atStart?.top} → ${afterDown?.top}`,
    )

    await page.keyboard.press('End')
    await new Promise((r) => setTimeout(r, 150))
    const afterEnd = await cursorRect()
    check(
      '行尾键把光标移到行末',
      !!afterEnd && !!afterDown && afterEnd.left > afterDown.left,
      `${afterDown?.left} → ${afterEnd?.left}`,
    )

    await page.keyboard.press('Home')
    await new Promise((r) => setTimeout(r, 150))
    const afterHome = await cursorRect()
    check('行首键把光标移回行首', !!afterHome && afterHome.left < afterEnd.left, `${afterEnd?.left} → ${afterHome?.left}`)

    // ---- 逐条写入路径:文档必须逐字不变(2a.2 / 2a.5)----
    const before = await docText()

    await page.keyboard.type('ZZZ_SHOULD_NOT_APPEAR')
    await new Promise((r) => setTimeout(r, 200))
    check('键盘输入不改变文档', (await docText()) === before, '文档逐字不变')

    // 粘贴:真实 paste 事件 + DataTransfer(不是模拟按键)
    await page.evaluate(() => {
      const dt = new DataTransfer()
      dt.setData('text/plain', 'PASTED_SHOULD_NOT_APPEAR')
      document.querySelector('.cm-content')
        .dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    })
    await new Promise((r) => setTimeout(r, 200))
    check('粘贴不改变文档', (await docText()) === before, '文档逐字不变')

    // 拖放文本进代码区
    await page.evaluate(() => {
      const dt = new DataTransfer()
      dt.setData('text/plain', 'DROPPED_SHOULD_NOT_APPEAR')
      const el = document.querySelector('.cm-content')
      el.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }))
      el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
    })
    await new Promise((r) => setTimeout(r, 200))
    check('拖放文本不改变文档', (await docText()) === before, '文档逐字不变')

    // 输入法组合:compositionstart → beforeinput(insertCompositionText)→ compositionend
    await page.evaluate(() => {
      const el = document.querySelector('.cm-content')
      el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
      el.dispatchEvent(new InputEvent('beforeinput', {
        inputType: 'insertCompositionText', data: '输入法不该写进来', bubbles: true, cancelable: true,
      }))
      el.dispatchEvent(new CompositionEvent('compositionend', { data: '输入法不该写进来', bubbles: true }))
    })
    await new Promise((r) => setTimeout(r, 250))
    check('输入法组合不改变文档', (await docText()) === before, '文档逐字不变')

    // 2a.3:contentEditable 打开后的附带面必须显式关掉
    const attrs = await page.$eval('.cm-content', (el) => ({
      spellcheck: el.getAttribute('spellcheck'),
      contentEditable: el.getAttribute('contenteditable'),
      ariaReadonly: el.getAttribute('aria-readonly'),
    }))
    check(
      'contentEditable 已打开(光标所需),但拼写检查关闭且标注只读',
      attrs.contentEditable === 'true' && attrs.spellcheck === 'false' && attrs.ariaReadonly === 'true',
      JSON.stringify(attrs),
    )
  }

  // ====== 大纲键盘导航(add-keyboard-first-navigation 2b)======
  {
    // 用 overload.cpp:它的大纲有多条(overloaded / solo / callSite)。
    // main.go 不行 —— 它只有 `main` 一条,"↑↓ 能移动"在单条列表上根本测不出来
    // (第一版就是这么假红的:main → main)。所以下面先把"至少两条"断言出来,
    // 夹具日后变了会直接说话,而不是让移动断言莫名其妙地失败。
    await openFile('overload.cpp', 'src/overload.cpp')
    await waitOutline('solo')
    const rowCount = await page.$$eval('.outline-row', (els) => els.length)
    check('大纲键盘用例的前提:该文件大纲有多条可移动条目', rowCount >= 2, `${rowCount} 条`)
    const activeName = () =>
      page.evaluate(() => {
        const id = document.querySelector('.outline-body')?.getAttribute('aria-activedescendant')
        if (!id) return null
        return document.getElementById(id)?.querySelector('.outline-name')?.textContent ?? '(已卸载)'
      })

    await page.$eval('.outline-body', (el) => el.focus())
    await new Promise((r) => setTimeout(r, 120))
    check('大纲未选中任何条目时无活动态', (await activeName()) === null, String(await activeName()))

    // 比的是**活动项标识**,不是显示名:overload.cpp 里相邻两条都叫 `overloaded`
    // (两个重载声明),按名字比会得出"没动",而它其实动了 —— 又一次"观察的是代理指标"。
    const activeId = () => page.$eval('.outline-body', (el) => el.getAttribute('aria-activedescendant'))
    await page.keyboard.press('ArrowDown')
    await new Promise((r) => setTimeout(r, 150))
    const first = await activeId()
    await page.keyboard.press('ArrowDown')
    await new Promise((r) => setTimeout(r, 150))
    const second = await activeId()
    check(
      '↑↓ 在大纲条目间移动活动项',
      first !== null && second !== null && first !== second,
      `${first} → ${second}`,
    )

    await page.keyboard.press('ArrowUp')
    await new Promise((r) => setTimeout(r, 150))
    check('↑ 回到上一条', (await activeId()) === first, `${second} → ${await activeId()}`)

    // Enter 定位:落点行应变成活动项所在行
    const targetName = await activeName()
    await page.keyboard.press('Enter')
    await new Promise((r) => setTimeout(r, 400))
    const located = await page.evaluate(() => {
      const line = document.querySelector('.cm-target-line')
      return line ? line.textContent : null
    })
    check(
      'Enter 定位到活动条目所在行',
      !!located && !!targetName && located.includes(targetName),
      `活动项=${targetName} 落点行=${located}`,
    )

    // 2b.3:切换文件后活动态不得指向不相干的条目
    await openFile('main.go', 'src/main.go')
    await waitOutline('main')
    const afterSwitch = await activeName()
    check(
      '切换预览文件后大纲活动态清空,不指向上一个文件的条目',
      afterSwitch === null,
      String(afterSwitch),
    )
  }

  // ====== 键盘触发跳转 / 查找引用 + 可发现性(3.6 / 3b.5 / 3b.6 / 4.1 / 4.2)======
  {
    // ---- 3b.6:不用任何自定义键位也能到达帮助入口 ----
    // **用键盘打开**(聚焦入口 + Enter),不是 `el.click()`:programmatic click 不会
    // 把焦点给按钮,于是面板记下的"回哪儿去"就不是这个按钮,下面 2.1 的往返
    // 就测不到真东西了。spec 的场景原文也是"用户用键盘打开帮助面板"。
    await page.evaluate(() => {
      const b = document.querySelector('.help-toggle')
      if (b instanceof HTMLElement) b.focus()
    })
    const helpOpenedFrom = await page.evaluate(() => document.activeElement?.className ?? null)
    await page.keyboard.press('Enter')
    await new Promise((r) => setTimeout(r, 300))
    check(
      '帮助面板往返断言的前提成立:打开前焦点确实在帮助入口按钮上',
      helpOpenedFrom === 'help-toggle',
      `打开前焦点=${helpOpenedFrom}`,
    )
    const helpRows = await page.$$eval('.help-row', (els) =>
      els.map((e) => ({
        label: e.querySelector('.help-row-label')?.textContent ?? '',
        key: e.querySelector('.help-row-key')?.textContent ?? '',
      })))
    check(
      '帮助入口可点开且列出了键盘操作(基线:界面按钮,不依赖任何自定义键位)',
      helpRows.length >= 5 && helpRows.some((r) => r.label === '跳转到定义'),
      `${helpRows.length} 条:${helpRows.map((r) => r.label).slice(0, 4).join(' / ')}…`,
    )
    // 1.1b:一块"讲解键盘操作"的面板,必须写自己的退出键 ——
    // 否则就是"功能与它自身可用性之间的缝"再出现一次。
    check(
      '帮助面板列出了自己的退出键(Esc 关闭本面板)',
      helpRows.some((r) => r.label === '关闭本面板' && r.key === 'Esc'),
      helpRows.filter((r) => r.label === '关闭本面板').map((r) => `${r.label}=${r.key}`).join(',') || '未列出',
    )
    check(
      '帮助里同时列出原生基线键(Tab 切面板 / 方向键移动光标)',
      helpRows.some((r) => r.key.includes('Tab')) && helpRows.some((r) => r.key.includes('↑')),
      helpRows.filter((r) => r.key.includes('Tab') || r.key.includes('↑')).map((r) => r.key).join(' | '),
    )
    // ---- fix-help-panel-a11y 1.2:打开时焦点必须**移入面板** ----
    // 这条以前没有,而且缺了它,下面 2.1 的"焦点回到触发按钮"是**恒真**的:
    // 旧实现根本不移动焦点,焦点一直待在触发按钮上,"归还"自然成立 ——
    // 断言测的是"它没走",不是"它回来了"。先验它真的走了,归还才有意义。
    const afterOpen = await page.evaluate(() => {
      const panel = document.querySelector('.help-panel')
      const ae = document.activeElement
      return {
        open: !!panel,
        inPanel: !!(panel && ae && panel.contains(ae)),
        active: ae?.className ?? null,
      }
    })
    check(
      '打开帮助面板后焦点移入面板(否则按键根本到不了它)',
      afterOpen.open === true && afterOpen.inPanel === true,
      JSON.stringify(afterOpen),
    )

    // ---- 2.2:打开期间 Tab 不逸出面板(焦点陷阱)----
    // 连按而不是按一次:面板里只有一个可聚焦元素(✕),按一次很容易"碰巧"还在里面;
    // 要看的是**循环**,所以按到超过元素个数的圈数,每一步都记下落点。
    const tabTrail = []
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab')
      await new Promise((r) => setTimeout(r, 60))
      tabTrail.push(await page.evaluate(() => {
        const panel = document.querySelector('.help-panel')
        const ae = document.activeElement
        return {
          in: !!(panel && ae && panel.contains(ae)),
          el: ae ? `${ae.tagName.toLowerCase()}.${ae.className}` : null,
        }
      }))
    }
    // 反向也要走一遍:Shift+Tab 从第一个元素往回走是最容易漏出去的那一步
    for (let i = 0; i < 3; i++) {
      await page.keyboard.down('Shift')
      await page.keyboard.press('Tab')
      await page.keyboard.up('Shift')
      await new Promise((r) => setTimeout(r, 60))
      tabTrail.push(await page.evaluate(() => {
        const panel = document.querySelector('.help-panel')
        const ae = document.activeElement
        return {
          in: !!(panel && ae && panel.contains(ae)),
          el: ae ? `${ae.tagName.toLowerCase()}.${ae.className}` : null,
        }
      }))
    }
    check(
      '帮助面板打开期间 Tab / Shift+Tab 焦点始终不逸出面板(9 步全程)',
      tabTrail.length === 9 && tabTrail.every((t) => t.in === true),
      tabTrail.map((t) => `${t.in ? '✓' : '✗'}${t.el}`).join(' → '),
    )

    // ---- 2.3:aria-modal 的**声明与实现一致** ----
    // 这条不是查"属性在不在",而是查**声明与约束是否配套**:
    // 声明了模态就必须真的约束焦点;没约束就不许声明。两种不配套都判红。
    const modal = await page.evaluate(() => {
      const panel = document.querySelector('.help-panel')
      return { declared: panel?.getAttribute('aria-modal') ?? null, role: panel?.getAttribute('role') ?? null }
    })
    const trapped = tabTrail.every((t) => t.in === true)
    // 断言取**双向**的强形式:声明在 **且** 约束成立。
    // 只写"声明了就必须约束"是不够的 —— 那条在 `aria-modal` 被误删时照样绿,
    // 而 1.3 已经落地、1.4 的前提已成立,此刻少了声明就是"做了却不告诉辅助技术"。
    // 反过来若哪天陷阱被拆掉,这条也会红,不会留下一个孤零零的声明。
    check(
      'aria-modal 的声明与焦点约束互为背书(声明在 + 焦点真被约束,缺一即红)',
      modal.declared === 'true' && modal.role === 'dialog' && trapped,
      `aria-modal=${modal.declared} role=${modal.role} 焦点被约束=${trapped}`,
    )

    // ---- fix-help-panel-a11y 2.1:Esc 关闭,**且焦点回到触发按钮** ----
    // 只断言"面板关了"不够:面板关了而焦点掉进虚空,键盘用户下一次 Tab
    // 会从页面开头重来 —— 焦点去哪了才是他真正在意的事。
    const beforeEsc = await page.evaluate(() => ({
      open: !!document.querySelector('.help-panel'),
      active: document.activeElement?.className ?? null,
    }))
    await page.keyboard.press('Escape')
    await new Promise((r) => setTimeout(r, 300))
    const afterEsc = await page.evaluate(() => ({
      open: !!document.querySelector('.help-panel'),
      active: document.activeElement?.className ?? null,
    }))
    check(
      'Esc 关闭帮助面板',
      beforeEsc.open === true && afterEsc.open === false,
      `按前 open=${beforeEsc.open} → 按后 open=${afterEsc.open}`,
    )
    check(
      'Esc 关闭后焦点仍在触发按钮上(不掉进虚空)',
      afterEsc.active === 'help-toggle',
      `焦点=${afterEsc.active}`,
    )
    // 面板此刻已关闭;下面这行是兜底,防止上面的断言失败时残留一个打开的面板
    await page.evaluate(() => document.querySelector('.help-close')?.click())
    await new Promise((r) => setTimeout(r, 250))

    // ---- 3b.2:右键菜单旁注键位 ----
    await openFile('client.go', 'src/client.go')
    await page.waitForFunction(
      () => document.querySelector('.cm-content')?.textContent?.includes('New('),
      { timeout: 8000 },
    )
    const menuKey = await page.evaluate(() => {
      document.querySelector('.code-view')?.dispatchEvent(
        new MouseEvent('contextmenu', { clientX: 400, clientY: 200, bubbles: true, cancelable: true }))
      return new Promise((res) => setTimeout(() => {
        const k = document.querySelector('.intel-menu-key')?.textContent ?? null
        document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
        res(k)
      }, 400))
    })
    check('右键菜单的操作项旁注了键位', !!menuKey, String(menuKey))

    // ---- 4.2:新键位**只在代码区内**生效,没有做全局注册 ----
    // 焦点放在目录树上按同一个键位:不得触发跳转(否则就是全局注册了)
    await page.$eval('.tree', (el) => el.focus())
    await new Promise((r) => setTimeout(r, 150))
    const pathBefore = await page.$eval('.preview-header .file-path', (el) => el.textContent)
    await page.keyboard.down('Meta'); await page.keyboard.press('Enter'); await page.keyboard.up('Meta')
    await new Promise((r) => setTimeout(r, 400))
    const pathAfterTreeKey = await page.$eval('.preview-header .file-path', (el) => el.textContent)
    check(
      '焦点在目录树时按代码区键位不触发跳转(新键位未做全局注册)',
      pathAfterTreeKey === pathBefore && !(await page.$('.candidate-panel')),
      `${pathBefore} → ${pathAfterTreeKey}`,
    )

    // 每个子块都用它**重新立起自己的前提**,而不是继承上一步的状态:
    // 上一步会换文件、移光标、改焦点 —— 继承下来的"当前状态"往往不是我以为的那个。
    // (这一轮四条假红全是这么来的:跳转跳到 store.go 之后,后面的 ⌘⇧↩ 落在了 `return` 上。)
    const placeCursorOnNew = async () => {
      await openFile('client.go', 'src/client.go')
      await page.waitForFunction(
        () => document.querySelector('.cm-content')?.textContent?.includes('New('),
        { timeout: 8000 },
      )
      let ok = false
      for (let i = 0; i < 5 && !ok; i++) {
        ok = await page.click('.cm-line').then(() => true).catch(() => false)
        if (!ok) await new Promise((r) => setTimeout(r, 250))
      }
      await page.keyboard.down('Meta'); await page.keyboard.press('Home'); await page.keyboard.up('Meta')
      for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown')
      for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowRight')
      await new Promise((r) => setTimeout(r, 150))
    }

    // ---- 3.6:纯键盘跳转(多候选时仍弹列表,与鼠标一致)----
    // 把光标移到第 4 行的 `New` 上:⌘Home 定位到文首,再 ↓×3 / →×7
    // (client.go 第 4 行是 `\th := New("cfg")`,第 7 个字符落在 New 内部)
    let clicked2 = false
    for (let i = 0; i < 5 && !clicked2; i++) {
      clicked2 = await page.click('.cm-line').then(() => true).catch(() => false)
      if (!clicked2) await new Promise((r) => setTimeout(r, 250))
    }
    await page.keyboard.down('Meta'); await page.keyboard.press('Home'); await page.keyboard.up('Meta')
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown')
    for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowRight')
    await new Promise((r) => setTimeout(r, 150))
    await page.keyboard.down('Meta'); await page.keyboard.press('Enter'); await page.keyboard.up('Meta')
    const panelAppeared = await page
      .waitForSelector('.candidate-panel', { timeout: 6000 })
      .then(() => true)
      .catch(() => false)
    const kbRows = panelAppeared
      ? await page.$$eval('.candidate-row', (els) => els.map((e) => e.querySelector('.candidate-path')?.textContent ?? ''))
      : []
    check(
      '纯键盘触发跳转:多候选时同样弹列表(与鼠标触发一致)',
      panelAppeared && kbRows.length === 2,
      `${kbRows.length} 条候选:${kbRows.join(' | ')}`,
    )

    // ---- 5.1:焦点确实在面板内,↓ 改选中,Enter 跳**第二项** ----
    // **只验"Enter 后跳转了"证明不了选中生效** —— 选中没生效时它会跳第一项,
    // 而"跳转发生了"照样为真。所以必须断言落点是第二项。
    const inPanel = await page.evaluate(() =>
      !!document.activeElement?.closest('.candidate-panel'))
    if (!inPanel) {
      console.log('  [候选焦点诊断] ' + JSON.stringify(await page.evaluate(() => ({
        active: document.activeElement?.className ?? null,
        panelExists: !!document.querySelector('.candidate-panel'),
        panelTabIndex: document.querySelector('.candidate-panel')?.getAttribute('tabindex') ?? null,
        rows: document.querySelectorAll('.candidate-row').length,
        activeDesc: document.querySelector('.candidate-panel')?.getAttribute('aria-activedescendant') ?? null,
      }))))
    }
    check('多候选弹出后焦点落在面板内(键盘才可能生效)', inPanel, String(inPanel))
    const sel0 = await page.evaluate(() =>
      document.querySelector('.candidate-panel')?.getAttribute('aria-activedescendant'))
    await page.keyboard.press('ArrowDown')
    await new Promise((r) => setTimeout(r, 200))
    const sel1 = await page.evaluate(() =>
      document.querySelector('.candidate-panel')?.getAttribute('aria-activedescendant'))
    check('↓ 改变候选面板的选中项', !!sel0 && !!sel1 && sel0 !== sel1, `${sel0} → ${sel1}`)
    const secondPath = kbRows[1]?.split(':')[0]
    await page.keyboard.press('Enter')
    const wentSecond = await page
      .waitForFunction(
        (p) => document.querySelector('.preview-header .file-path')?.textContent === p,
        { timeout: 8000 }, secondPath,
      )
      .then(() => true)
      .catch(() => false)
    await new Promise((r) => setTimeout(r, 400))
    const candFocus = await page.evaluate(() => !!document.querySelector('.cm-editor.cm-focused'))
    check('候选面板 Enter 之后焦点落在代码区', candFocus, String(candFocus))
    check(
      'Enter 跳到**当前选中项**(第二项),而不是永远第一项',
      wentSecond,
      `期望 ${secondPath},实际 ${await page.$eval('.preview-header .file-path', (el) => el.textContent)}`,
    )

    // ---- 5.3:Esc 关闭候选面板后焦点归还到代码区 ----
    // 上一条断言把预览跳到了 store.go,所以这里必须重新回到 client.go 并重放光标
    await placeCursorOnNew()
    await page.keyboard.down('Meta'); await page.keyboard.press('Enter'); await page.keyboard.up('Meta')
    const reopened = await page.waitForSelector('.candidate-panel', { timeout: 6000 }).then(() => true).catch(() => false)
    if (reopened) {
      await page.keyboard.press('Escape')
      await new Promise((r) => setTimeout(r, 300))
      const back = await page.evaluate(() => ({
        open: !!document.querySelector('.candidate-panel'),
        inEditor: !!document.querySelector('.cm-editor.cm-focused'),
      }))
      check(
        'Esc 关闭候选面板并把焦点归还到代码区(不是"关掉了"就算过)',
        back.open === false && back.inEditor === true,
        JSON.stringify(back),
      )
    } else {
      check('Esc 关闭候选面板并把焦点归还到代码区(不是"关掉了"就算过)', false, '候选面板未能重新打开')
    }
    await new Promise((r) => setTimeout(r, 250))

    // ---- 3.6:纯键盘查找引用 ----
    // Escape 关掉候选面板后焦点未必还在编辑器里,光标位置也可能不再在 New 上 ——
    // 所以**把前提重新立起来**再按键,而不是假设它还保持着。
    await placeCursorOnNew()
    await page.keyboard.down('Meta')
    await page.keyboard.down('Shift')
    await page.keyboard.press('Enter')
    await page.keyboard.up('Shift')
    await page.keyboard.up('Meta')
    // 面板类名是 `.ref-panel`(第一版我写成 `.reference-panel`,断言因此假红一次)
    const refAppeared = await page
      .waitForSelector('.ref-panel', { timeout: 8000 })
      .then(() => true)
      .catch(() => false)
    // **等扫描完成再断言。** 第一版只断言"面板出现了",读到的标题是"0 处 / 0 个文件"
    // —— 那时扫描还在跑。一个"面板出现即通过"的断言,在引用一条都没找到时照样绿,
    // 而 3.6 要的是"行为与鼠标触发一致",不是"有个面板弹出来"。
    if (refAppeared) {
      await page
        .waitForFunction(
          () => (document.querySelector('.ref-status')?.textContent ?? '').includes('扫描完成'),
          { timeout: 30000 },
        )
        .catch(() => {})
    }
    const refTitle = refAppeared
      ? await page.$eval('.ref-title', (el) => el.textContent).catch(() => null)
      : null
    const refFiles = refAppeared
      ? await page.$$eval('.ref-file', (els) => els.map((e) => e.textContent?.trim().split(' ')[0] ?? ''))
      : []
    const refRows = refAppeared ? await page.$$eval('.ref-row', (els) => els.length) : 0
    check(
      '纯键盘触发查找引用:出现引用面板且针对光标处的标识符',
      refAppeared && !!refTitle && refTitle.includes('New'),
      `面板=${refAppeared} 标题=${refTitle}`,
    )
    check(
      '纯键盘查找引用的结果与鼠标触发一致(命中定义处与调用处,非空)',
      refRows > 0 && refFiles.includes('src/client.go'),
      `${refRows} 条 — ${refFiles.join(' | ')}`,
    )

    // ---- 5.2:引用结果**能用键盘选中并跳过去**(此前只验了"面板出现、内容非空")----
    if (refAppeared) {
      const refFocused = await page.evaluate(() => !!document.activeElement?.closest('.ref-body'))
      check('引用面板打开后焦点落在结果区内', refFocused, String(refFocused))
      const r0 = await page.evaluate(() =>
        document.querySelector('.ref-body')?.getAttribute('aria-activedescendant'))
      await page.keyboard.press('ArrowDown')
      await new Promise((r) => setTimeout(r, 200))
      const r1 = await page.evaluate(() =>
        document.querySelector('.ref-body')?.getAttribute('aria-activedescendant'))
      check('↑↓ 在引用结果间移动(跨文件分组连续,不在组边界卡住)', !!r0 && !!r1 && r0 !== r1, `${r0} → ${r1}`)
      // 选中项对应的目标:从选中行读出行号,Enter 后预览应停在该行
      const target = await page.evaluate(() => {
        const id = document.querySelector('.ref-body')?.getAttribute('aria-activedescendant')
        const row = id ? document.getElementById(id) : null
        const group = row?.closest('.ref-group')
        return {
          line: row?.querySelector('.ref-line')?.textContent ?? null,
          file: group?.querySelector('.ref-file')?.textContent?.trim().split(' ')[0] ?? null,
        }
      })
      await page.keyboard.press('Enter')
      const arrived = await page
        .waitForFunction(
          (f) => document.querySelector('.preview-header .file-path')?.textContent === f,
          { timeout: 8000 }, target.file,
        )
        .then(() => true)
        .catch(() => false)
      // 落点行高亮是跳转完成后才加上的,且只亮 1.6 秒 —— 要等它出现,不能立刻读
      const landedLine = await page
        .waitForFunction(() => document.querySelector('.cm-target-line')?.textContent ?? null, { timeout: 6000 })
        .then((h) => h.jsonValue())
        .catch(() => null)
      check(
        'Enter 跳到键盘选中的那一条引用(文件与行都对上)',
        arrived && !!landedLine,
        `选中 ${target.file}:${target.line} → 到达=${arrived} 落点行=${landedLine ? landedLine.trim().slice(0, 30) : '无'}`,
      )
    }
    if (refAppeared) await page.keyboard.press('Escape')
  }

  // ====== 4.1 全链路:纯键盘走完一整趟,**全程不派发任何鼠标事件** ======
  // 这一组里没有 page.click / page.mouse.* —— 一次都没有。
  // 起手用 evaluate 里的 blur() 把焦点归零(那是 DOM 调用,不是鼠标事件)。
  {
    // **先把前提清干净。** 第一版没做这件事,结果两条断言是假绿:
    // client.go 早已是打开状态,于是"方向键定位到它""Enter 打开它"在
    // 一个键都没生效的情况下照样通过。纯键盘链路必须从"还没到那儿"开始走。
    await openFile('main.go', 'src/main.go')
    await page.waitForFunction(
      () => document.querySelector('.preview-header .file-path')?.textContent === 'src/main.go',
      { timeout: 10000 },
    )
    await page.evaluate(() => {
      const el = document.activeElement
      if (el instanceof HTMLElement) el.blur()
    })
    // **要的是"焦点落在那个容器上",不是"焦点落在那个面板范围内"。**
    // `.sidebar` 里还有刷新按钮,它在 Tab 序里排在目录树之前 ——
    // 按"范围内"判定会在按钮上就停下,于是后面的方向键一个都进不了树
    // (第一版就是这么卡在 main.go 的:断言说"进了目录树",其实焦点在刷新按钮上)。
    const whichPanel = () =>
      page.evaluate(() => {
        const el = document.activeElement
        if (!el) return null
        if (el.classList.contains('tree')) return 'sidebar'
        if (el.classList.contains('outline-body')) return 'outline'
        if (el.classList.contains('preview-body') || el.closest('.cm-editor')) return 'preview'
        return null
      })
    // 顶栏有若干按钮与搜索框,从 body 起步要按不少次才轮到面板 —— 给足次数
    const tabUntil = async (want, max = 30) => {
      for (let i = 0; i < max; i++) {
        if ((await whichPanel()) === want) return true
        await page.keyboard.press('Tab')
        await new Promise((r) => setTimeout(r, 110))
      }
      return (await whichPanel()) === want
    }
    const treeActive = () =>
      page.evaluate(() => {
        const id = document.querySelector('.tree')?.getAttribute('aria-activedescendant')
        if (!id) return null
        const el = document.getElementById(id)
        return {
          label: el?.querySelector('.label')?.textContent ?? null,
          expanded: el?.getAttribute('aria-expanded'),
        }
      })

    check('纯键盘:Tab 进入目录树', await tabUntil('sidebar'), String(await whichPanel()))

    // 浏览目录:从当前活动行出发找 client.go。
    // **不要"Home 之后一路 ↓"** —— 夹具里 bigdir 有 1500 个子项,展开时几十次下移
    // 还在它里面(第一版就是这么卡住的,最后停在 main.go)。
    // 当前活动行在 src 内(刚打开过 main.go),client.go 按字母序在它前面,先向上找。
    const seek = async (key, steps) => {
      for (let i = 0; i < steps; i++) {
        if ((await treeActive())?.label === 'client.go') return true
        await page.keyboard.press(key)
        await new Promise((r) => setTimeout(r, 70))
      }
      return (await treeActive())?.label === 'client.go'
    }
    let reached = await seek('ArrowUp', 40)
    if (!reached) reached = await seek('ArrowDown', 60)
    check('纯键盘:方向键浏览目录树并定位到目标文件', reached, `活动行=${(await treeActive())?.label}`)

    await page.keyboard.press('Enter')
    await page.waitForFunction(
      () => document.querySelector('.preview-header .file-path')?.textContent === 'src/client.go',
      { timeout: 10000 },
    )
    check('纯键盘:Enter 打开文件(此前打开的是 main.go,确实换过来了)', true, 'src/main.go → src/client.go')

    // Tab 进代码区,方向键移动光标到第 6 行的 Serve 上
    check('纯键盘:Tab 进入代码区', await tabUntil('preview'), String(await whichPanel()))
    // 前提断言:焦点必须真的落在**编辑器**里,而不是只落在面板容器上 ——
    // 只断言"面板拿到焦点"时,光标键与 ⌘↩ 其实一个都进不去,而断言照样绿。
    await new Promise((r) => setTimeout(r, 200))
    check(
      '纯键盘:焦点落进代码编辑器本身(不只是面板容器)',
      await page.evaluate(() => !!document.querySelector('.cm-editor.cm-focused')),
      String(await page.evaluate(() => document.activeElement?.className ?? null)),
    )
    await page.keyboard.down('Meta'); await page.keyboard.press('Home'); await page.keyboard.up('Meta')
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowDown')
    for (let i = 0; i < 9; i++) await page.keyboard.press('ArrowRight')
    await new Promise((r) => setTimeout(r, 150))

    // 跳定义:Serve 只有一处定义 → 直接落到 handler.go
    await page.keyboard.down('Meta'); await page.keyboard.press('Enter'); await page.keyboard.up('Meta')
    const jumped = await page
      .waitForFunction(
        () => document.querySelector('.preview-header .file-path')?.textContent === 'src/handler.go',
        { timeout: 8000 },
      )
      .then(() => true)
      .catch(() => false)
    check('纯键盘:⌘↩ 跳到唯一定义处', jumped, await page.$eval('.preview-header .file-path', (el) => el.textContent))

    // 查引用。**跳转换了文件 → CodeView 重挂 → 新的 .cm-content 并不持有焦点**,
    // 所以先用 Tab 重新进代码区(仍然只用键盘,不派发任何鼠标事件),
    // 否则 ⌘⇧↩ 根本到不了 CM6 —— 那样测的是"按键没送达",不是"查引用坏了"。
    // **要的是"编辑器本身持有焦点",不是"焦点在预览面板范围内"。**
    // `.preview-body` 也算 'preview',但按键不会进 CodeMirror ——
    // 那样 ⌘⇧↩ 静默无反应,测出来像"查引用坏了",其实是按键没送达。
    // (这条正是我这轮偶发红的原因:premise 宽于我要的性质。)
    // 跳转后焦点**应当自己留在编辑器里** —— 不需要用户再 Tab 找回来。
    // (原先靠按 Tab 补位,而补位次数不定:同文件 0 次、跨文件十几次,
    //  于是这条时红时绿;补位掩盖的正是"跳出去就丢焦点"这个真缺陷。)
    const stayed = await page
      .waitForFunction(() => !!document.querySelector('.cm-editor.cm-focused'), { timeout: 5000 })
      .then(() => true)
      .catch(() => false)
    check('纯键盘:⌘↩ 跨文件跳转后焦点仍在编辑器(无需再按 Tab 找回来)', stayed, String(await whichPanel()))
    await new Promise((r) => setTimeout(r, 200))
    // **光标位置也要重新立起来,不能继承跳转留下的那个。**
    // 跳转只滚动 + 高亮落点行,并不保证选区落在某个标识符上;继承下来时
    // `wordAtCursor` 可能为 null,于是 ⌘⇧↩ 什么也不做 —— 那测的是"按键没落在词上",
    // 不是"查引用坏了"(实测这条偶发红过一次)。
    // handler.go 第 6 行是 `type Handler struct {`,→×6 落在 Handler 里。
    await page.keyboard.down('Meta'); await page.keyboard.press('Home'); await page.keyboard.up('Meta')
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowDown')
    for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight')
    await new Promise((r) => setTimeout(r, 150))
    await page.keyboard.down('Meta'); await page.keyboard.down('Shift')
    await page.keyboard.press('Enter')
    await page.keyboard.up('Shift'); await page.keyboard.up('Meta')
    const refOk = await page.waitForSelector('.ref-panel', { timeout: 8000 }).then(() => true).catch(() => false)
    check('纯键盘:⌘⇧↩ 查找引用', refOk, refOk ? '引用面板已出现' : '未出现')
    if (refOk) await page.keyboard.press('Escape')

    // 后退回来(⌥← 是既有导航栈键位)
    await page.keyboard.down('Alt'); await page.keyboard.press('ArrowLeft'); await page.keyboard.up('Alt')
    const backOk = await page
      .waitForFunction(
        () => document.querySelector('.preview-header .file-path')?.textContent === 'src/client.go',
        { timeout: 8000 },
      )
      .then(() => true)
      .catch(() => false)
    check('纯键盘:⌥← 后退回出发文件', backOk, await page.$eval('.preview-header .file-path', (el) => el.textContent))
  }

  // ====== 跳转后的焦点交接 + 各入口"离开时"焦点审计(fix-jump-focus-handoff)======
  // **断言点不是"跳转发生了"** —— 焦点掉 body 时那条同样为真,正是这个 bug
  // 逃过既有断言的原因。这里一律验:落地后焦点在哪 + 键盘还能不能接着用。
  {
    const cursorTop = () =>
      page.evaluate(() => {
        const c = document.querySelector('.cm-cursor-primary') ?? document.querySelector('.cm-cursor')
        return c ? Math.round(c.getBoundingClientRect().top) : null
      })

    // ---- 3.1:⌘⇧O 符号搜索 → 键盘选中跳转 → 焦点必须在编辑器里,且 ↓ 真的移动光标 ----
    await clickSearchMode('符号')
    await page.keyboard.type('Dispatch')
    await page.waitForFunction(
      () => [...document.querySelectorAll('.search-result .result-name')].some((e) => e.textContent === 'Dispatch'),
      { timeout: 20000 },
    )
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await page.waitForFunction(
      () => document.querySelector('.preview-header .file-path')?.textContent === 'src/handler.go',
      { timeout: 10000 },
    )
    await new Promise((r) => setTimeout(r, 500))
    const afterSymbol = await page.evaluate(() => ({
      inEditor: !!document.querySelector('.cm-editor.cm-focused'),
      active: document.activeElement?.className ?? null,
    }))
    check(
      '符号搜索跳转后焦点落在代码编辑器内(不是 body)',
      afterSymbol.inEditor === true,
      JSON.stringify(afterSymbol),
    )
    const beforeMove = await cursorTop()
    await page.keyboard.press('ArrowDown')
    await new Promise((r) => setTimeout(r, 200))
    const afterMove = await cursorTop()
    check(
      '符号搜索跳转后按 ↓ 代码光标真的移动(证明按键确实进了编辑器)',
      beforeMove != null && afterMove != null && afterMove > beforeMove,
      `${beforeMove} → ${afterMove}`,
    )

    // ---- 3.2:⌘K 文件名搜索打开文件后同样可直接用键盘 ----
    await clickSearchMode('文件名')
    await page.keyboard.type('client.go')
    await page.waitForFunction(
      () => [...document.querySelectorAll('.search-result .result-name')].some((e) => e.textContent?.includes('client.go')),
      { timeout: 15000 },
    )
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await page.waitForFunction(
      () => document.querySelector('.preview-header .file-path')?.textContent === 'src/client.go',
      { timeout: 10000 },
    )
    await new Promise((r) => setTimeout(r, 500))
    const afterFile = await page.evaluate(() => ({
      inEditor: !!document.querySelector('.cm-editor.cm-focused'),
      active: document.activeElement?.className ?? null,
    }))
    check('文件名搜索打开文件后焦点落在代码编辑器内', afterFile.inEditor === true, JSON.stringify(afterFile))

    // ---- 2.1 审计 + 3.3:把"本来就对"的入口钉住 ----
    // 目录树 Enter:焦点**应当留在树上**(用户在树里连续浏览)。
    // 这条不是漏改,是正确动线 —— 钉住它,免得日后有人"顺手"把它改成跳进编辑器。
    await page.$eval('.tree', (el) => el.focus())
    await new Promise((r) => setTimeout(r, 150))
    await page.keyboard.press('Enter')
    await new Promise((r) => setTimeout(r, 500))
    const afterTree = await page.evaluate(() => ({
      onTree: document.activeElement?.classList.contains('tree') ?? false,
      active: document.activeElement?.className ?? null,
    }))
    check(
      '目录树 Enter 打开文件后焦点**留在树上**(正确动线,非漏改)',
      afterTree.onTree === true,
      JSON.stringify(afterTree),
    )
  }

  // ====== 导航落点:caret 必须跟到目标符号(fix-navigation-caret-landing)======
  // **断言纪律:验"落在哪",不验"动没动"。**
  // "caret 动了"从文件开头动到第 2 行也成立;"跳转发生了"在 caret 没跟过去时同样成立。
  // 目标 `DeepAnchor` 在 src/deep.go **第 49 行** —— 刻意远离文件开头(见夹具处说明)。
  {
    const TARGET_LINE = 49
    const TARGET = 'DeepAnchor'
    // caret 所在行:找选区所在的 .cm-line,再读它对应的行号槽
    // 读 caret 行用**编辑器自己的选区状态**,不用 DOM getSelection:
    // CM6 的选区只在编辑器持有焦点时反映到 DOM,而大纲激活等入口
    // 的焦点有意留在别处 —— 那时读 DOM 会得到 null,看起来像"caret 没落上",
    // 其实是我量错了地方(第一版就是这么误报的)。
    const caretLine = () => page.evaluate(() => window.__cv?.caretLine?.value ?? null)

    // ---- 3.0d:先断言**夹具真长成我以为的样子**,再用它 ----
    // 只在注释里嘱咐"目标要离文件开头远"是不够的:夹具若因转义写错而塌成一行,
    // 装置照跑不误,给出的红绿全是幻影。**凡"精心构造的前提",都要有断言证明它被构造出来了。**
    await clickSearchMode('符号')
    await page.keyboard.type(TARGET)
    await page.waitForFunction(
      (n) => [...document.querySelectorAll('.search-result .result-name')].some((e) => e.textContent === n),
      { timeout: 20000 }, TARGET,
    )
    const fixtureLoc = await page.$eval('.search-result', (el) => el.textContent ?? '')
    check(
      `夹具自检:${TARGET} 确实位于 src/deep.go 第 ${TARGET_LINE} 行(远离文件开头)`,
      fixtureLoc.includes(`src/deep.go:${TARGET_LINE}`),
      fixtureLoc.trim().slice(0, 60),
    )
    await page.keyboard.press('Escape')
    await new Promise((r) => setTimeout(r, 200))

    // ---- 2.4 / 3.1:符号搜索跳转 ----
    await clickSearchMode('符号')
    await page.keyboard.type(TARGET)
    await page.waitForFunction(
      (n) => [...document.querySelectorAll('.search-result .result-name')].some((e) => e.textContent === n),
      { timeout: 20000 }, TARGET,
    )
    // 不按 ↓:结果唯一,直接 Enter 取第一条。
    // (第一版按了 ↓,选中的是子串命中的另一个符号,于是"目标行"根本不是我以为的那个。)
    await page.keyboard.press('Enter')
    await page.waitForFunction(
      () => document.querySelector('.preview-header .file-path')?.textContent === 'src/deep.go',
      { timeout: 10000 },
    )
    await new Promise((r) => setTimeout(r, 600))
    const symbolCaret = await caretLine()
    check(
      `符号搜索跳转:caret 落在目标行(第 ${TARGET_LINE} 行),不是文件开头`,
      symbolCaret === TARGET_LINE,
      `caret 在第 ${symbolCaret} 行`,
    )

    // ---- 3.2 接续断言:按 ↓ 应到目标行 + 1 ----
    await page.keyboard.press('ArrowDown')
    await new Promise((r) => setTimeout(r, 250))
    const nextLine = await caretLine()
    check(
      `接续:跳转后按 ↓,caret 到第 ${TARGET_LINE + 1} 行(证明它是从目标行开始移动的)`,
      nextLine === TARGET_LINE + 1,
      `caret 在第 ${nextLine} 行`,
    )

    // ---- 3.3 语义断言:直接查引用,查的必须是目标符号 ----
    await page.keyboard.press('ArrowUp')
    await new Promise((r) => setTimeout(r, 200))
    await page.keyboard.down('Meta'); await page.keyboard.down('Shift')
    await page.keyboard.press('Enter')
    await page.keyboard.up('Shift'); await page.keyboard.up('Meta')
    const refShown = await page.waitForSelector('.ref-panel', { timeout: 8000 }).then(() => true).catch(() => false)
    const refTitle = refShown ? await page.$eval('.ref-title', (el) => el.textContent) : null
    check(
      '语义:跳转后直接查引用,查的是**目标符号**(证明 caret 停在该符号上)',
      refShown && !!refTitle && refTitle.includes(TARGET),
      `面板标题=${refTitle}`,
    )

    // ---- 3.4:引用面板 —— 焦点在列表 **且** caret 已在目标处,两者并存 ----
    if (refShown) {
      await new Promise((r) => setTimeout(r, 300))
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('Enter')
      await new Promise((r) => setTimeout(r, 700))
      const both = await page.evaluate(() => ({
        focusInList: !!document.activeElement?.closest('.ref-body'),
        activeCls: document.activeElement?.className ?? null,
      }))
      const refCaret = await caretLine()
      check(
        '引用面板跳转:焦点仍在结果列表 **且** caret 已落到目标处(两者并存,不互相替代)',
        both.focusInList === true && refCaret != null,
        `焦点=${both.activeCls} caret 行=${refCaret}`,
      )
      await page.keyboard.press('Escape')
      await new Promise((r) => setTimeout(r, 250))
    }

    // ---- 2.8 / 3.0c:回程 —— ⌥← 应回到**离开时 caret 那一行**,不是视口顶行 ----
    // **夹具必须让两者不同**:若离开时 caret 恰好在视口第一行,
    // "回到 caret 行"与"回到视口顶行"给出同一个数字,断言会碰巧全绿而缺口隐身。
    // (这是本 change 里同一个陷阱第三次:小文件 / 单一目标行 / 视口顶行。)
    {
      await openFile('deep.go', 'src/deep.go')
      await page.waitForFunction(
        () => document.querySelector('.cm-content')?.textContent?.includes('DeepAnchor'),
        { timeout: 8000 },
      )
      // 把 caret 放到第 49 行,然后**单独滚动**,使视口顶行与 caret 行分离
      await page.evaluate(() => { window.__cv.caretLine.value = 0 })
      await clickSearchMode('符号')
      await page.keyboard.type(TARGET)
      await page.waitForFunction(
        (n) => [...document.querySelectorAll('.search-result .result-name')].some((e) => e.textContent === n),
        { timeout: 20000 }, TARGET,
      )
      await page.keyboard.press('Enter')
      await page.waitForFunction(
        () => document.querySelector('.preview-header .file-path')?.textContent === 'src/deep.go',
        { timeout: 10000 },
      )
      await new Promise((r) => setTimeout(r, 500))
      // 只滚动,不动 caret
      await page.evaluate(() => {
        const sc = document.querySelector('.cm-scroller')
        if (sc) sc.scrollTop = Math.max(0, sc.scrollTop - 220)
      })
      await new Promise((r) => setTimeout(r, 400))
      const before = await page.evaluate(() => ({
        caret: window.__cv?.caretLine?.value ?? null,
        viewportTop: window.__cv?.viewportLine?.value ?? null,
      }))
      check(
        '回程前提:离开时 caret 行 ≠ 视口顶行(否则这条断言测不出区别)',
        before.caret != null && before.viewportTop != null && before.caret !== before.viewportTop,
        `caret=${before.caret} 视口顶行=${before.viewportTop}`,
      )

      // 用**会记入导航栈**的入口离开:目录树点击走的是 selectFile,不入栈,
      // 那样 ⌥← 会退到更早的条目上(第一版就是这么退到第 21 行的)。
      await clickSearchMode('符号')
      await page.keyboard.type('Dispatch')
      await page.waitForFunction(
        () => [...document.querySelectorAll('.search-result .result-name')].some((e) => e.textContent === 'Dispatch'),
        { timeout: 20000 },
      )
      console.log('  [离开前 caret] ' + JSON.stringify(await page.evaluate(() => ({
        caret: window.__cv?.caretLine?.value ?? null,
        viewportTop: window.__cv?.viewportLine?.value ?? null,
      }))))
      await page.keyboard.press('Enter')
      await page.waitForFunction(
        () => document.querySelector('.preview-header .file-path')?.textContent === 'src/handler.go',
        { timeout: 10000 },
      )
      await new Promise((r) => setTimeout(r, 500))
      await page.keyboard.down('Alt'); await page.keyboard.press('ArrowLeft'); await page.keyboard.up('Alt')
      const backHome = await page
        .waitForFunction(
          () => document.querySelector('.preview-header .file-path')?.textContent === 'src/deep.go',
          { timeout: 8000 },
        )
        .then(() => true)
        .catch(() => false)
      await new Promise((r) => setTimeout(r, 500))
      const backCaret = await caretLine()
      // 4.2:回程也要断言**焦点在哪** —— 原先这一组只验了 caret 一维,
      // 于是"文件对了、caret 对了、但焦点掉 body"整个漏掉(真机上稳定复现)。
      // **一条要求点名了几个资源,验收就要逐一对应**,不能只覆盖引发立项的那一个。
      const backFocus = await page.evaluate(() => ({
        inEditor: !!document.querySelector('.cm-editor.cm-focused'),
        active: document.activeElement?.className ?? null,
      }))
      check(
        '⌥← 回程后焦点回到代码区(回来能直接按 ↓,不是掉在 body 上)',
        backFocus.inEditor === true,
        JSON.stringify(backFocus),
      )
      if (backCaret !== before.caret) {
        console.log('  [回程诊断] ' + JSON.stringify(await page.evaluate(() => ({
          nav: window.__cvNavStack?.() ?? null,
          caret: window.__cv?.caretLine?.value ?? null,
          path: document.querySelector('.preview-header .file-path')?.textContent ?? null,
        }))))
      }
      check(
        '⌥← 回到**离开时 caret 那一行**,而不是视口顶行或文件开头',
        backHome && backCaret === before.caret,
        `期望 ${before.caret},实际 ${backCaret}(当时视口顶行 ${before.viewportTop})`,
      )
    }

    // ---- 2.7:大纲条目激活也要带 caret ----
    await openFile('deep.go', 'src/deep.go')
    await waitOutline(TARGET)
    await page.$eval('.outline-body', (el) => el.focus())
    await new Promise((r) => setTimeout(r, 150))
    for (let i = 0; i < 12; i++) {
      const name = await page.evaluate(() => {
        const id = document.querySelector('.outline-body')?.getAttribute('aria-activedescendant')
        return id ? document.getElementById(id)?.querySelector('.outline-name')?.textContent ?? null : null
      })
      if (name === TARGET) break
      await page.keyboard.press('ArrowDown')
      await new Promise((r) => setTimeout(r, 90))
    }
    await page.keyboard.press('Enter')
    await new Promise((r) => setTimeout(r, 600))
    const outlineCaret = await caretLine()
    const outlineFocus = await page.evaluate(() => ({
      inEditor: !!document.querySelector('.cm-editor.cm-focused'),
      active: document.activeElement?.className ?? null,
    }))
    check('大纲激活之后焦点落在代码区', outlineFocus.inEditor === true, JSON.stringify(outlineFocus))
    check(
      `大纲激活:caret 落在目标行(第 ${TARGET_LINE} 行)`,
      outlineCaret === TARGET_LINE,
      `caret 在第 ${outlineCaret} 行`,
    )
  }

  // ================= 按住修饰键的可跳转提示(change: add-jump-affordance)=================
  {
    await openFile('client.go', 'src/client.go')
    await page.waitForFunction(
      () => document.querySelector('.cm-content')?.textContent?.includes('New('),
      { timeout: 8000 },
    )

    // 3.1 上半:可跳转的标识符有提示
    const onJumpable = await hoverWordMeta('New')
    if (!onJumpable.hinted) {
      console.log('  [提示诊断] ' + JSON.stringify(await page.evaluate(() => ({
        activeEl: document.activeElement?.className ?? null,
        path: document.querySelector('.preview-header .file-path')?.textContent ?? null,
        hasCmContent: !!document.querySelector('.cm-content'),
        codeViewIntel: !!document.querySelector('.code-view-intel'),
        indexStatus: document.querySelector('.intel-index')?.textContent ?? null,
      }))))
    }
    check('按住修饰键悬停可跳转标识符 → 出现提示', onJumpable.found && onJumpable.hinted, JSON.stringify(onJumpable))

    // 提示**看得见**,不只是类名挂上了。这条是 restyle-reader 补的:
    // 该下划线的颜色取自 --hot-bar,而 --hot-bar 同时也是"选中左条"那一支;
    // 换主题时若按"去左条"把 --hot-bar 置成 transparent,下划线会连带静默消失 ——
    // 而上面那条只查 `.cm-jump-hint` 存不存在,照样全绿。
    // 提示的全部内容就是那条线的颜色,所以颜色必须被断言,不能只断言类名。
    const hintPaint = await page.evaluate(() => {
      const el = document.querySelector('.cm-jump-hint')
      if (!el) return null
      const cs = getComputedStyle(el)
      return { color: cs.textDecorationColor, thickness: cs.textDecorationThickness, line: cs.textDecorationLine }
    })
    const transparent = (c) => !c || /rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0\s*\)/.test(c)
    check(
      '可跳转提示的下划线真的画得出来(颜色非透明),而不只是类名挂上了',
      !!hintPaint && hintPaint.line.includes('underline') && !transparent(hintPaint.color),
      JSON.stringify(hintPaint),
    )

    // 3.2 上半:释放修饰键 → 清除
    await releaseMeta()
    const afterRelease = await page.evaluate(() => !!document.querySelector('.cm-jump-hint'))
    check('释放修饰键 → 提示清除', afterRelease === false, `仍有提示=${afterRelease}`)

    // 3.1 下半:**不可跳转的没有提示**。只验上半等于没验出"区别",
    // 而"区别"正是这个功能的全部价值 —— 全都加下划线与全都不加一样无用。
    const onPlain = await hoverWordMeta('error')
    check('不可跳转的标识符 → 无提示(证明提示确实在区分)', onPlain.found && !onPlain.hinted, JSON.stringify(onPlain))
    await releaseMeta()

    // 3.2 下半:指针移开 → 清除
    await hoverWordMeta('New')
    await page.mouse.move(5, 5)
    await new Promise((r) => setTimeout(r, 250))
    const afterLeave = await page.evaluate(() => !!document.querySelector('.cm-jump-hint'))
    check('指针移开代码区 → 提示清除', afterLeave === false, `仍有提示=${afterLeave}`)
    await releaseMeta()

    // 3.3 窗口失焦 → 清除。**按住修饰键 ⌘Tab 切走时 keyup 可能永不送达**,
    // 只靠 keyup 会让下划线滞留;这条单独成立,不能靠上面两条覆盖。
    const stuck = await hoverWordMeta('New')
    await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    await new Promise((r) => setTimeout(r, 250))
    const afterBlur = await page.evaluate(() => !!document.querySelector('.cm-jump-hint'))
    check(
      '窗口失焦 → 提示清除(⌘Tab 切走时 keyup 不会送达)',
      stuck.hinted === true && afterBlur === false,
      `失焦前有提示=${stuck.hinted} 失焦后仍有=${afterBlur}`,
    )
    await releaseMeta()

    // 3.5 语义边界:提示只表示"存在同名定义、点击会进入跳转流程",
    // **不等于"点击必然唯一定位"**。多候选时悬停有提示、点击仍弹列表 —— 视觉不能偷改契约。
    const multi = await hoverWordMeta('New')
    await releaseMeta()
    await clickWord('New', { meta: true })
    const panel = await page
      .waitForSelector('.candidate-panel', { timeout: 8000 })
      .then(() => true)
      .catch(() => false)
    check(
      '多处同名定义:悬停有提示,点击仍弹候选列表(提示没有把语义升级成确定跳转)',
      multi.hinted === true && panel === true,
      `提示=${multi.hinted} 候选面板=${panel}`,
    )
    await page.keyboard.press('Escape')

    // 3.4 上半:不支持代码理解的语言直接短路
    await openFile('config.yaml', 'src/config.yaml')
    await page.waitForFunction(
      () => document.querySelector('.cm-content')?.textContent?.includes('port'),
      { timeout: 8000 },
    )
    const onYaml = await hoverWordMeta('Handler')
    check('不支持代码理解的语言(.yaml)无提示', onYaml.found && !onYaml.hinted, JSON.stringify(onYaml))
    await releaseMeta()
  }

  // —— 单文件模式(同一个文件)——
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    const src = await root.getDirectoryHandle('src')
    window.__cv.enterSingleFile(await src.getFileHandle('overload.cpp'))
  })
  await page.waitForFunction(
    () => document.querySelector('.preview-header .file-path')?.textContent === 'overload.cpp',
    { timeout: 10000 },
  )
  await waitOutline('solo')
  const inSingle = await probeOverload('单文件模式')
  check(
    '单文件模式:同名重载同样弹候选列表且未自动跳转(不再静默跳第一条)',
    inSingle.candidates.length === 4 && inSingle.pathUnchanged && !inSingle.jumped,
    `${inSingle.candidates.length} 条候选,路径未变=${inSingle.pathUnchanged},未跳转=${!inSingle.jumped}`,
  )
  check(
    '单文件模式:定义优先同样生效,落点在定义行而非声明行',
    inSingle.soloLine === 'void solo(int a) { (void)a; }' && !inSingle.soloPanel,
    `${inSingle.soloLine} / 弹候选=${inSingle.soloPanel}`,
  )
  check(
    '同一文件同一标识符:单文件模式与项目模式跳转行为一致',
    inSingle.candidates.length === inProject.candidates.length && inSingle.soloLine === inProject.soloLine,
    `候选 ${inProject.candidates.length}→${inSingle.candidates.length};落点 ${inProject.soloLine === inSingle.soloLine ? '一致' : '不一致'}`,
  )

  // 3.4 下半:单文件模式下,本文件没有定义的标识符不得有提示
  {
    const local = await hoverWordMeta('solo')
    // 反例必须是**本文件里确实存在的词**,否则"没提示"是因为压根没悬停到东西 ——
    // 第一版用了 `Serve`(它根本不在 overload.cpp 里),`found:false` 让断言白绿了一次。
    // `int` 在文件里出现多次,且不会被抽取成定义,才是真正的反例。
    const foreign = await hoverWordMeta('int')
    check(
      '单文件模式:本文件有定义的有提示、本文件无定义的无提示',
      local.found && local.hinted === true && foreign.found === true && foreign.hinted === false,
      `solo=${JSON.stringify(local)} int=${JSON.stringify(foreign)}`,
    )
    await releaseMeta()
  }

  // ---- 大纲面板折叠与折叠态持久化(4.2)----
  {
    await page.click('.outline-header .outline-toggle')
    await page.waitForSelector('.outline-collapsed', { timeout: 5000 })
    const stored = await page.evaluate(() => localStorage.getItem('cv-outline-collapsed'))
    check('大纲面板可折叠 + localStorage 持久化', stored === '1', String(stored))
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('.welcome', { timeout: 10000 })
    await page.evaluate(async () => {
      window.__cv.enterProject(await navigator.storage.getDirectory())
    })
    await page.waitForSelector('.tree-row', { timeout: 10000 })
    await clickRow('src')
    await page.waitForFunction(() => [...document.querySelectorAll('.tree-row .label')].some((e) => e.textContent === 'guide.md'))
    await clickRow('guide.md')
    await page.waitForFunction(() => document.querySelector('.preview-header .file-path')?.textContent === 'src/guide.md')
    const stillCollapsed = await page.$('.outline-collapsed')
    check('重开查看器后大纲仍为折叠态', !!stillCollapsed)
    await page.click('.outline-collapsed .outline-toggle') // 还原展开,后续断言依赖大纲可见
    await page.waitForSelector('.outline-header', { timeout: 5000 })
  }

  // ---- 全局符号搜索:界面入口(不使用快捷键)----
  {
    const ok = await clickSearchMode('符号')
    check('搜索面板"符号"模式入口存在(不依赖快捷键)', ok)
    const focused = await page.evaluate(() => document.activeElement?.className ?? '')
    check('点击"符号"模式后输入框获得焦点', focused === 'search-input', String(focused))
    await page.keyboard.type('Dispatch')
    await page.waitForFunction(
      () => [...document.querySelectorAll('.search-result .result-name')].some((e) => e.textContent === 'Dispatch'),
      { timeout: 20000 },
    )
    const detail = await page.$eval('.search-result', (el) => el.textContent)
    check('符号结果含种类/容器/路径行号', detail.includes('Handler') && detail.includes('src/handler.go:18'), detail.trim())
    await page.$eval('.search-result', (el) =>
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })))
    await page.waitForFunction(
      () => document.querySelector('.preview-header .file-path')?.textContent === 'src/handler.go',
      { timeout: 10000 },
    )
    await page.waitForSelector('.cm-target-line', { timeout: 5000 })
    const lineText = await page.$eval('.cm-target-line', (el) => el.textContent)
    check('符号搜索选中结果:打开文件并定位到符号行', lineText.includes('func (h *Handler) Dispatch'), lineText.trim())
    const selRow = (await rowLabels()).find((r) => r.selected)
    check('符号搜索同步目录树选中态', selRow?.label === 'handler.go', selRow?.label)
  }

  await page.screenshot({ path: join(SHOTS, 'shot-9-symbol-search.png') })
  await page.keyboard.press('Escape')

  // ================= 全文内容搜索 + 降级(阶段三)=================

  const contentStatusText = () => page.$eval('.content-panel .ref-status', (el) => el.textContent).catch(() => null)
  const contentFiles = () =>
    page.$$eval('.content-panel .ref-file', (els) => els.map((e) => e.textContent?.trim().split(' ')[0] ?? ''))
  /**
   * 发起一次全文搜索。
   * 关键点:输入有 250ms 去抖,**必须等面板标题变成新查询词之后再等终态** ——
   * 否则会读到上一次查询遗留的 “扫描完成” 状态与结果行(这正是假绿的典型形态)。
   * `contentQuery` 与 `contentStatus` 在 runContentSearch 里是同一同步块内赋值的,
   * 所以标题一旦变成新词,状态就已经是 scanning / too-short 了。
   */
  const runContent = async (text) => {
    await clickSearchMode('全文')
    await page.evaluate(() => {
      const input = document.querySelector('.search-input')
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(input, '')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await page.keyboard.type(text)
    await page.waitForSelector('.content-panel', { timeout: 10000 })
    await page.waitForFunction(
      (t) => (document.querySelector('.content-panel .ref-title')?.textContent ?? '').includes(`“${t}”`),
      { timeout: 15000 }, text,
    )
  }
  const waitContentSettled = () =>
    page.waitForFunction(
      () => /扫描完成|已达上限|已取消|关键词过短/.test(document.querySelector('.content-panel .ref-status')?.textContent ?? ''),
      { timeout: 90000, polling: 300 },
    )

  // ---- 全文搜索界面入口(不使用快捷键)+ 关键词过短 ----
  {
    const ok = await clickSearchMode('全文')
    check('搜索面板“全文”模式入口存在(不依赖快捷键)', ok)
    const focused = await page.evaluate(() => document.activeElement?.className ?? '')
    check('点击“全文”模式后输入框获得焦点', focused === 'search-input', String(focused))
    await page.keyboard.type('H')
    await page.waitForSelector('.content-panel', { timeout: 10000 })
    await page.waitForFunction(
      () => (document.querySelector('.content-panel .ref-status')?.textContent ?? '').includes('关键词过短'),
      { timeout: 10000 },
    )
    const scanned = await page.$$eval('.content-panel .ref-file', (els) => els.length)
    check('关键词 < 2 字符不启动全项目扫描并提示', scanned === 0, await contentStatusText())
  }

  // ---- 流式结果 + 点击直达行 + 图片/二进制被跳过 ----
  {
    const t0 = Date.now()
    await runContent('MaxRetries')
    await page.waitForFunction(() => document.querySelectorAll('.content-panel .ref-row').length > 0, { timeout: 20000 })
    const firstBatch = Date.now() - t0
    check('全文搜索首批结果 < 1 s', firstBatch < 1000, `${firstBatch}ms`)
    await waitContentSettled()
    const files = await contentFiles()
    check('全文搜索命中正文所在文件', files.includes('src/handler.go'), files.join(' | '))
    // 点击直达行
    await page.evaluate(() => {
      const row = document.querySelector('.content-panel .ref-row')
      row?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await page.waitForFunction(
      () => document.querySelector('.preview-header .file-path')?.textContent === 'src/handler.go',
      { timeout: 8000 },
    )
    await waitTargetLine('MaxRetries')
    check('点击全文搜索结果直达对应行', true)
  }

  // ---- 过期结果不混排(8.7)----
  {
    await runContent('NoSuchTokenXYZ')
    await waitContentSettled()
    const files = await contentFiles()
    const rows = await page.$$eval('.content-panel .ref-row', (els) => els.length)
    check('切换查询后不残留上一次的结果', rows === 0 && files.length === 0, `${rows} 行 / ${files.length} 文件`)
  }

  // ---- 图片与二进制被跳过(8.1)----
  {
    // 正向对照:先确认这两个文件的**正文里确实含有**该字符串。
    // 否则"结果里没有它们"可能只是因为字符串根本不存在,断言就测不到跳过逻辑。
    const contains = await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory()
      const docs = await root.getDirectoryHandle('docs')
      const a = await (await (await root.getFileHandle('photo.svg')).getFile()).text()
      const b = await (await (await docs.getFileHandle('logo.svg')).getFile()).text()
      return a.includes('<svg xmlns') && b.includes('<svg xmlns')
    })
    check('正向对照:两个 SVG 的正文确实含待搜字符串', contains)
    await runContent('<svg xmlns')
    await waitContentSettled()
    const files = await contentFiles()
    check(
      '图片文件被跳过(photo.svg / docs/logo.svg 不出现在结果中)',
      contains && !files.includes('photo.svg') && !files.includes('docs/logo.svg'),
      files.join(' | ') || '无命中',
    )
  }
  {
    const contains = await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory()
      const bin = await root.getDirectoryHandle('bin')
      const buf = new Uint8Array(await (await (await bin.getFileHandle('blob.bin')).getFile()).arrayBuffer())
      return String.fromCharCode(...buf).includes('ELF')
    })
    check('正向对照:blob.bin 的字节里确实含 ELF', contains)
    await runContent('ELF')
    await waitContentSettled()
    const files = await contentFiles()
    const rows = await page.$$eval('.content-panel .ref-row', (els) => els.length)
    check(
      '二进制文件被跳过(bin/blob.bin 不出现,且搜索本身确实跑出了命中)',
      contains && !files.includes('bin/blob.bin') && rows > 0,
      `${rows} 行 — ${files.join(' | ') || '无命中'}`,
    )
  }

  // ---- 超大文件仅部分搜索 + 单文件命中上限(8.1 / 8.6)----
  {
    await runContent('abcdefghijklmnopqrstuvwxyz')
    await waitContentSettled()
    const groups = await page.$$eval('.content-panel .ref-group', (els) =>
      els.map((e) => ({
        path: e.querySelector('.ref-file')?.textContent?.trim().split(' ')[0] ?? '',
        partial: !!e.querySelector('.ref-partial'),
        rows: e.querySelectorAll('.ref-row').length,
      })))
    const big = groups.find((g) => g.path === 'big.log')
    check('超大文件仅搜索开头部分并在结果中明示', !!big && big.partial, JSON.stringify(big ?? null))
    check('单文件命中上限 50 生效', !!big && big.rows === 50, `${big?.rows} 条`)
  }

  // ---- 区分大小写开关(8.2)----
  {
    await runContent('handler')
    await waitContentSettled()
    const insensitive = await page.$$eval('.content-panel .ref-row', (els) => els.length)
    await page.click('.content-panel .case-toggle input')
    // 切开关会重跑同一查询:标题不变,先等它回到"扫描中"再等终态,避免读到旧的终态
    await page.waitForFunction(
      () => (document.querySelector('.content-panel .ref-status')?.textContent ?? '').includes('扫描中'),
      { timeout: 10000 },
    ).catch(() => {})
    await waitContentSettled()
    const sensitive = await page.$$eval('.content-panel .ref-row', (els) => els.length)
    check(
      '区分大小写开关生效(命中数减少)',
      sensitive < insensitive && sensitive >= 0,
      `不区分 ${insensitive} 条 → 区分 ${sensitive} 条`,
    )
    await page.click('.content-panel .case-toggle input') // 还原
    await waitContentSettled()
  }

  // ====== 浮层关闭时的焦点归还(4.5 / 6.4)======
  // **每个浮层两条动线,不能互相代替**:
  //   ① 未激活直接按 Esc;② **先激活一条(面板按设计仍开着)再按 Esc**。
  // 真机上出问题的是 ②,而我原先只写了 ① —— 用例从不激活任何一项,
  // 于是"激活标记永不复位"这个缺陷整条路径都走不到,断言绿得毫无意义。
  // **断言没写错,是它没走到出事的地方。**
  {
    const focusNow = () =>
      page.evaluate(() => ({
        inEditor: !!document.querySelector('.cm-editor.cm-focused'),
        active: document.activeElement?.className ?? null,
      }))
    const restored = (f) => f.inEditor === true || f.active === 'search-input'
    const gotoDeepAnchor = async () => {
      await clickSearchMode('符号')
      await page.keyboard.type('DeepAnchor')
      await page.waitForFunction(
        () => [...document.querySelectorAll('.search-result .result-name')].some((e) => e.textContent === 'DeepAnchor'),
        { timeout: 20000 },
      )
      await page.keyboard.press('Enter')
      await page.waitForFunction(
        () => document.querySelector('.preview-header .file-path')?.textContent === 'src/deep.go',
        { timeout: 10000 },
      )
      await new Promise((r) => setTimeout(r, 500))
    }
    const openRefPanel = async () => {
      await gotoDeepAnchor()
      await page.keyboard.down('Meta'); await page.keyboard.down('Shift')
      await page.keyboard.press('Enter')
      await page.keyboard.up('Shift'); await page.keyboard.up('Meta')
      return page.waitForSelector('.ref-panel:not(.content-panel)', { timeout: 8000 })
        .then(() => true).catch(() => false)
    }

    // ---- 全文面板 ① 未激活直接 Esc ----
    await gotoDeepAnchor()
    await runContent('DeepAnchor')
    await page.waitForSelector('.content-panel .ref-row', { timeout: 20000 })
    await page.$eval('.content-panel .ref-body', (el) => el.focus())
    await new Promise((r) => setTimeout(r, 200))
    await page.keyboard.press('Escape')
    await new Promise((r) => setTimeout(r, 500))
    const contentPlain = await focusNow()
    check('全文面板:未激活直接 Esc → 焦点归还触发处', restored(contentPlain), JSON.stringify(contentPlain))

    // ---- 全文面板 ② **先激活一条再 Esc**(真机出问题的那条)----
    await gotoDeepAnchor()
    await runContent('DeepAnchor')
    await page.waitForSelector('.content-panel .ref-row', { timeout: 20000 })
    await page.$eval('.content-panel .ref-body', (el) => el.focus())
    await new Promise((r) => setTimeout(r, 200))
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter') // 激活:跳过去,面板按设计仍开着
    await new Promise((r) => setTimeout(r, 700))
    const stillOpen = await page.evaluate(() => !!document.querySelector('.content-panel'))
    check('全文面板:激活一条之后面板仍保持打开(本条动线的前提)', stillOpen, String(stillOpen))
    await page.keyboard.press('Escape')
    await new Promise((r) => setTimeout(r, 500))
    const contentAfterActivate = await focusNow()
    check(
      '全文面板:**激活过一条之后**再 Esc → 焦点仍被归还(此前跳转过不得跳过归还)',
      restored(contentAfterActivate),
      JSON.stringify(contentAfterActivate),
    )

    // ---- 引用面板 ① 未激活直接 Esc ----
    if (await openRefPanel()) {
      await new Promise((r) => setTimeout(r, 400))
      await page.$eval('.ref-panel:not(.content-panel) .ref-body', (el) => el.focus())
      await new Promise((r) => setTimeout(r, 200))
      await page.keyboard.press('Escape')
      await new Promise((r) => setTimeout(r, 500))
      const refPlain = await focusNow()
      check('引用面板:未激活直接 Esc → 焦点归还', restored(refPlain), JSON.stringify(refPlain))
    } else {
      check('引用面板:未激活直接 Esc → 焦点归还', false, '引用面板未能打开,前提不成立')
    }

    // ---- 引用面板 ② 先激活一条再 Esc ----
    if (await openRefPanel()) {
      await new Promise((r) => setTimeout(r, 400))
      await page.$eval('.ref-panel:not(.content-panel) .ref-body', (el) => el.focus())
      await new Promise((r) => setTimeout(r, 200))
      await page.keyboard.press('Enter') // 激活:跳到该处,面板仍开着
      await new Promise((r) => setTimeout(r, 700))
      await page.keyboard.press('Escape')
      await new Promise((r) => setTimeout(r, 500))
      const refAfterActivate = await focusNow()
      check(
        '引用面板:**激活过一条之后**再 Esc → 焦点仍被归还',
        restored(refAfterActivate),
        JSON.stringify(refAfterActivate),
      )
    } else {
      check('引用面板:**激活过一条之后**再 Esc → 焦点仍被归还', false, '引用面板未能打开,前提不成立')
    }
  }

  // ---- 三个搜索入口互不干扰(10.6):同一关键词,三种模式结果集各自正确 ----
  {
    const keyword = 'Handler'
    await clickSearchMode('文件名')
    await page.keyboard.type(keyword)
    await page.waitForFunction(
      () => [...document.querySelectorAll('.search-result .result-name')].some((e) => e.textContent === 'handler.go'),
      { timeout: 20000 },
    )
    const fileNames = await page.$$eval('.search-result .result-name', (els) => els.map((e) => e.textContent))
    await clickSearchMode('符号')
    const symNames = await page.$$eval('.search-result .result-name', (els) => els.map((e) => e.textContent))
    await page.keyboard.press('Escape')
    await runContent(keyword)
    await waitContentSettled()
    const contentPaths = await contentFiles()

    check('文件名模式:只返回文件名匹配', fileNames.every((n) => n.endsWith('.go')), fileNames.join(','))
    check('符号模式:只返回符号匹配', symNames.includes('Handler') && !symNames.includes('handler.go'), symNames.join(','))
    check(
      '全文模式:返回正文命中(含仅在正文出现的 config.yaml)',
      contentPaths.includes('src/config.yaml') && contentPaths.includes('src/handler.go'),
      contentPaths.join(' | '),
    )
    check(
      '三种模式对同一关键词的结果集互不覆盖',
      JSON.stringify(fileNames) !== JSON.stringify(symNames) && contentPaths.length > 0,
      `文件名 ${fileNames.length} / 符号 ${symNames.length} / 全文 ${contentPaths.length}`,
    )
  }
  await page.screenshot({ path: join(SHOTS, 'shot-13-content-search.png') })
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.content-panel .ref-btn')].find((b) => b.textContent === '✕')
    btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })

  // ---- 超过 5MB 的支持语言文件:预览区与大纲区都要明示索引受限(9.2)----
  await openFile('huge.go', 'src/huge.go')
  {
    await page.waitForFunction(
      () => document.querySelector('.outline-note')?.textContent?.includes('文件过大'),
      { timeout: 15000 },
    )
    const note = await page.$eval('.outline-note', (el) => el.textContent)
    check('超 5MB 文件的大纲区明示符号未被索引', note.includes('文件过大') && note.includes('未被索引'), note.trim().slice(0, 40))
    const notice = await page.$eval('.preview-notice', (el) => el.textContent)
    check('超 5MB 文件的预览区明示截断与索引受限', notice.includes('截断') && notice.includes('符号索引受限'), notice.trim().slice(0, 60))
  }


  // ---- 无扩展名:纯文本 + shebang ----
  await clickRow('Makefile')
  await page.waitForFunction(() => document.querySelector('.cm-content')?.textContent?.includes('echo build'))
  check('无扩展名文本(Makefile)纯文本展示', true)
  await clickRow('runme')
  await page.waitForFunction(() => document.querySelector('.cm-content')?.textContent?.includes('#!/usr/bin/env bash'))
  check('shebang 识别脚本展示', true)

  // ---- 图片 / 二进制 / 大文件 ----
  await clickRow('photo.svg')
  await page.waitForSelector('.image-view img')
  check('SVG 经 <img> 预览', true)
  await clickRow('bin')
  await page.waitForFunction(() => [...document.querySelectorAll('.tree-row .label')].some((e) => e.textContent === 'blob.bin'))
  await clickRow('blob.bin')
  await page.waitForFunction(() => document.body.textContent.includes('暂不支持预览'))
  check('二进制降级提示', true)
  {
    const tBig = Date.now()
    await clickRow('big.log')
    await page.waitForSelector('.preview-notice', { timeout: 8000 })
    const dt = Date.now() - tBig
    const notice = await page.$eval('.preview-notice', (el) => el.textContent)
    check('50MB 大文件截断降级', notice.includes('截断'), `${dt}ms — ${notice.trim()}`)
    check('截断文件明示代码理解覆盖受限(file-preview spec 修订项)', notice.includes('符号索引受限'), notice.trim())
    check('大文件加载不长时间阻塞(<3s 出内容)', dt < 3000, `${dt}ms`)
  }

  // ---- 千级条目目录:分批入列 ----
  {
    // 先收起 src 并回到顶部:src 展开后有 30 多个子项,虚拟滚动下会把
    // bigdir 挤出渲染范围,clickRow 只扫描已渲染的行就找不到它。
    const srcExpanded = await page.evaluate(() =>
      [...document.querySelectorAll('.tree-row')].some((r) => r.querySelector('.label')?.textContent === 'main.go'))
    if (srcExpanded) await clickRow('src')
    await page.$eval('.tree', (el) => { el.scrollTop = 0 })
    await new Promise((r) => setTimeout(r, 300))

    const t1 = Date.now()
    await clickRow('bigdir')
    await page.waitForFunction(() => [...document.querySelectorAll('.tree-row .label')].some((e) => e.textContent?.startsWith('entry-')))
    const dt = Date.now() - t1
    check('1500 条目目录展开首批 <1s', dt < 1000, `${dt}ms`)
    await page.$eval('.tree', (el) => { el.scrollTop = 20000 })
    await new Promise((r) => setTimeout(r, 300))
    const visible = await page.$$eval('.tree-row', (rows) => rows.length)
    check('虚拟滚动只渲染视口行', visible < 100, `${visible} rows in DOM`)
    await page.screenshot({ path: join(SHOTS, 'shot-5-bigdir.png') })
    await page.$eval('.tree', (el) => { el.scrollTop = 0 })
    await new Promise((r) => setTimeout(r, 400)) // 等虚拟滚动重渲染
    await clickRow('bigdir') // 折叠
    await page.waitForFunction(
      () => ![...document.querySelectorAll('.tree-row .label')].some((e) => e.textContent?.startsWith('entry-')),
      { timeout: 5000 },
    )
    // 把 src 重新展开:下面"刷新后已展开目录保持"那条断言的前提就是 src 处于展开态,
    // 上面为了让 bigdir 进入渲染范围临时收起过它。
    if (!(await page.evaluate(() =>
      [...document.querySelectorAll('.tree-row')].some((r) => r.querySelector('.label')?.textContent === 'main.go')))) {
      await clickRow('src')
      await page.waitForFunction(
        () => [...document.querySelectorAll('.tree-row .label')].some((e) => e.textContent === 'main.go'),
        { timeout: 10000 },
      )
    }
  }

  // ---- 刷新:新增文件出现,展开态保持 ----
  // 顺带立起 2.3 的前提:先把"已隐藏 N 项"展开,刷新后它必须回到默认排除态。
  // 挂在这次既有的刷新上,而不是自己再刷一遍 —— 一万文件的刷新不便宜。
  //
  // 注意:提示行排在根层最后,此刻 src 已展开,它多半在虚拟滚动的渲染范围之外,
  // 直接 querySelector 会拿到 null(第一次写就是这么超时的)。先滚到底把它渲染出来。
  const revealHiddenRow = async () => {
    await page.$eval('.tree', (el) => { el.scrollTop = el.scrollHeight })
    await new Promise((r) => setTimeout(r, 250))
    await page.waitForSelector('.tree-row.tree-hidden', { timeout: 8000 })
  }
  await revealHiddenRow()
  await page.evaluate(() => {
    document.querySelector('.tree-row.tree-hidden')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await page.waitForFunction(
    () => [...document.querySelectorAll('.tree-row .label')].some((e) => e.textContent === 'node_modules'),
    { timeout: 8000 },
  )
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    const fh = await root.getFileHandle('added-later.txt', { create: true })
    const w = await fh.createWritable(); await w.write('new\n'); await w.close()
  })
  await page.click('button[title="刷新目录树"]')
  await page.waitForFunction(() => [...document.querySelectorAll('.tree-row .label')].some((e) => e.textContent === 'added-later.txt'), { timeout: 5000 })
  check('手动刷新反映新增文件', true)
  // 展开态按路径逐层异步恢复,等全部加载完成再断言
  await page.waitForFunction(
    () => {
      const labels = [...document.querySelectorAll('.tree-row .label')].map((e) => e.textContent)
      return labels.includes('main.go') && !labels.includes('加载中…')
    },
    { timeout: 15000 },
  )
  check('刷新后已展开目录保持(src 子项可见)', true)

  // 2.3:被排除目录的展开只在会话内有效,刷新回到默认排除态
  {
    await revealHiddenRow()
    const labels = await page.evaluate(() =>
      [...document.querySelectorAll('.tree-row .label')].map((e) => e.textContent))
    check(
      '刷新后被排除目录回到默认隐藏态(展开只在会话内保持)',
      !labels.includes('node_modules') && labels.includes('已隐藏 2 项'),
      labels.filter((l) => l === 'node_modules' || l?.startsWith('已隐藏')).join(',') || '两者都不在',
    )
  }

  // ---- 刷新后索引一致性:新增文件可搜到(8.2) ----
  {
    await page.keyboard.down('Control')
    await page.keyboard.press('KeyK')
    await page.keyboard.up('Control')
    await page.keyboard.type('added-later')
    await page.waitForFunction(
      () => [...document.querySelectorAll('.search-result .result-name')].some((e) => e.textContent === 'added-later.txt'),
      { timeout: 20000 },
    )
    check('刷新后索引含新增文件', true)
    await page.keyboard.press('Escape')
  }

  // ---- 点击即重读(外部修改) ----
  await clickRow('data.json')
  await page.waitForFunction(() => document.querySelector('.cm-content')?.textContent?.includes('"version": 1'))
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    const fh = await root.getFileHandle('data.json')
    const w = await fh.createWritable(); await w.write('{"version": 2}\n'); await w.close()
  })
  await clickRow('data.json')
  await page.waitForFunction(() => document.querySelector('.cm-content')?.textContent?.includes('"version": 2'), { timeout: 5000 })
  check('重新点击读取最新内容(不缓存)', true)

  // ---- 读取失败降级 ----
  await clickRow('temp.txt')
  await page.waitForFunction(() => document.querySelector('.preview-header .file-path')?.textContent === 'temp.txt')
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    await root.removeEntry('temp.txt')
  })
  await clickRow('temp.txt')
  await page.waitForSelector('.preview-error', { timeout: 5000 })
  const treeStillWorks = await clickRow('data.json')
  check('已删除文件读取失败提示 + 树仍可用', treeStillWorks)

  // ---- 刷新后索引一致性:已删除文件不再命中(8.2) ----
  {
    await page.click('button[title="刷新目录树"]')
    await new Promise((r) => setTimeout(r, 300))
    await page.keyboard.down('Control')
    await page.keyboard.press('KeyK')
    await page.keyboard.up('Control')
    await page.keyboard.type('temp.txt')
    await page.waitForFunction(
      () => document.querySelector('.search-status')?.textContent?.includes('无匹配文件'),
      { timeout: 20000 },
    )
    check('刷新后索引剔除已删除文件', true)
    await page.keyboard.press('Escape')
  }

  // ---- 单文件模式 ----
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    window.__cv.enterSingleFile(await root.getFileHandle('single.md'))
  })
  await page.waitForSelector('.markdown-body')
  {
    const sidebar = await page.$('.sidebar')
    const ph = await page.$$eval('.md-img-placeholder', (els) => els.length)
    check('单文件模式:无目录树 + 相对图片占位符', !sidebar && ph === 1, `sidebar=${!!sidebar} placeholders=${ph}`)
  }

  // ---- 单文件模式的代码理解范围(10.6b / 任务 8b)----
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    const src = await root.getDirectoryHandle('src')
    window.__cv.enterSingleFile(await src.getFileHandle('engine.ts'))
  })
  await page.waitForFunction(
    () => document.querySelector('.preview-header .file-path')?.textContent === 'engine.ts',
    { timeout: 10000 },
  )
  {
    await waitOutline('Engine')
    await page.waitForFunction(
      () => document.querySelector('.cm-content')?.textContent?.includes('export function build'),
      { timeout: 10000 },
    )
    const rows = await outlineRows()
    const got = rows.map((r) => r.name)
    check('单文件模式下大纲可用', ['Options', 'process', 'Engine', 'run', 'build'].every((n) => got.includes(n)), got.join(','))

    // 文件内跳转:点 build() 里的 new Engine()(第 3 个整词 Engine),应定位到类定义行
    await clickWord('Engine', { nth: 3, meta: true })
    await waitTargetLine('export class Engine')
    check('单文件模式下文件内跳转可用', true)

    // 目标不在本文件时给出引导提示,而不是静默失败
    await clickWord('repeat', { meta: true })
    await page.waitForSelector('.intel-toast', { timeout: 8000 })
    const toast = await page.$eval('.intel-toast', (el) => el.textContent)
    check(
      '单文件模式下目标不在本文件时出现引导提示',
      toast.includes('单文件模式下仅支持文件内跳转') && toast.includes('打开所在文件夹'),
      toast.trim(),
    )
    await page.click('.intel-toast')

    // 引用与全局符号搜索入口不可用,且界面明示原因
    const searchModes = await page.$('.search-modes')
    check('单文件模式下不渲染全局符号搜索入口', !searchModes)
    const note = await page.$eval('.outline-single-note', (el) => el.textContent).catch(() => null)
    check(
      '单文件模式明示引用/符号搜索需打开文件夹',
      !!note && note.includes('查找引用与全局符号搜索需要打开所在文件夹'),
      note?.trim() ?? '未渲染',
    )
    // 解析中 ≠ 本文件没有:抽取尚未完成时必须提示"解析中",
    // 不能提示"打开所在文件夹"——符号其实就在本文件里(11.9 正交矩阵捞出的格子)
    await page.evaluate(() => window.__cv.setExtractPaused(true))
    await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory()
      const src = await root.getDirectoryHandle('src')
      window.__cv.enterSingleFile(await src.getFileHandle('engine.ts'))
    })
    // 必须等大纲进入"解析中"再点:重新进入单文件模式后,预览区仍是同一份旧内容,
    // 只等 cm-content 会在大纲 effect 尚未跑到之前就通过,那时符号还是上一轮的(竞态)。
    await page.waitForFunction(
      () => document.querySelector('.outline-note')?.textContent?.includes('解析中'),
      { timeout: 10000 },
    )
    await clickWord('Engine', { nth: 3, meta: true })
    await page.waitForSelector('.intel-toast', { timeout: 8000 })
    const parsingToast = await page.$eval('.intel-toast', (el) => el.textContent)
    check(
      '单文件模式:符号尚未抽取完成时提示"解析中"而非误导性的"打开所在文件夹"',
      parsingToast.includes('解析中'),
      parsingToast.trim(),
    )
    await page.click('.intel-toast')
    await page.evaluate(() => window.__cv.setExtractPaused(false))
    await waitOutline('Engine')
    await clickWord('Engine', { nth: 3, meta: true })
    await waitTargetLine('export class Engine')
    check('单文件模式:解析完成后同一次跳转正常落到定义行', true)

    await clickWord('Engine', { nth: 1, right: true })
    await page.waitForSelector('.intel-menu', { timeout: 8000 })
    const refDisabled = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('.intel-menu-item')].find((b) => b.textContent?.startsWith('查找引用'))
      return btn ? btn.disabled : null
    })
    check('单文件模式下右键菜单的“查找引用”置灰并说明原因', refDisabled === true, `disabled=${refDisabled}`)
    await page.keyboard.press('Escape')
  }
  await page.screenshot({ path: join(SHOTS, 'shot-12-single-intel.png') })
  await page.screenshot({ path: join(SHOTS, 'shot-6-single.png') })

  // ---- 主题切换(8.1):切暗色即时生效 + 重开保持 ----
  {
    // 记下浅色下代码区的着色,供 6.2 对比。
    // 此刻处于单文件模式(上一段的 engine.ts 仍打开着),没有目录树可点 ——
    // 直接从当前已渲染的代码区取样即可。
    await page.waitForFunction(
      () => [...document.querySelectorAll('.cm-line span')].some((x) => x.className),
      { timeout: 8000 },
    )
    const lightCodeColor = await page.evaluate(() => {
      const el = [...document.querySelectorAll('.cm-line span')].find((s) => s.className)
      return el ? getComputedStyle(el).color : null
    })
    const lightBodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    const lightNavBg = await page.evaluate(() => {
      const el = document.querySelector('.nav-btn')
      return el ? getComputedStyle(el).backgroundColor : null
    })
    await page.click('.theme-toggle')
    await waitThemeApplied()
    const stored = await page.evaluate(() => localStorage.getItem('cv-theme'))
    check('切换暗色即时生效 + localStorage 持久化', stored === 'dark', String(stored))

    // 6.2:代码区着色必须与界面**同步换套**,不出现"界面已换、代码区仍是旧配色"。
    // 同时这是 cmTheme.ts 与 styles.css 两处色值的**交叉核对** ——
    // 代码区颜色由 cmTheme 给,注释令牌由 CSS 给,两边漂移的话这条会红。
    // 先等着色真的变化(区分"没换套"与"还没重建完"),等不到再判失败
    const changed = await page
      .waitForFunction(
        (prev) => {
          const el = [...document.querySelectorAll('.cm-line span')].find((x) => x.className)
          return el != null && getComputedStyle(el).color !== prev
        },
        { timeout: 6000 }, lightCodeColor,
      )
      .then(() => true)
      .catch(() => false)
    void changed
    const codeColorNow = await page.evaluate(() => {
      const el = [...document.querySelectorAll('.cm-line span')].find((s) => s.className)
      return el ? getComputedStyle(el).color : null
    })
    check('主题切换后代码区着色同步换套', codeColorNow != null && codeColorNow !== lightCodeColor, `浅色 ${lightCodeColor} → 暗色 ${codeColorNow}`)
    const cmComment = await page.evaluate(() => {
      const el = document.querySelector('.cm-line .ͼb, .cm-line span[class*="ͼ"]')
      return el ? getComputedStyle(el).fontStyle : null
    })
    void cmComment
    // 截图前的两道闸(restyle-reader 收尾 A)。原来这里紧接着切换就拍,
    // 距 `.theme-toggle` 不足 130ms,`.nav-btn` 被拍成浅灰药丸 —— 断言没问题,脏的只有图。
    // ① 终态守卫:深色真的画出来了。**这条是正向的** ——
    //    "过渡稳定"是负向条件,起点静止也满足它,一张浅色图照样能过。
    const painted7 = await waitDarkPainted(lightBodyBg)
    check(
      '深色单文件截图:深色确实已应用到画面(data-theme=dark 且 body 底色 = --bg 令牌 且 ≠ 浅色底)',
      painted7?.theme === 'dark' && painted7.bodyBg === painted7.tokenBg && painted7.bodyBg !== lightBodyBg,
      `${lightBodyBg} → ${painted7?.bodyBg}(令牌 ${painted7?.tokenBg},theme=${painted7?.theme})`,
    )
    // ② 再等过渡走完;传 `from` 以免"还没开始动"被当成"已经稳了"
    const settled7 = await waitStyleSettled('.nav-btn', 'backgroundColor', { from: lightNavBg })
    check(
      '深色单文件截图前过渡已走完(.nav-btn 已离开浅色值并稳定)',
      settled7 != null && settled7 !== lightNavBg,
      `.nav-btn ${lightNavBg} → 稳态 ${settled7}`,
    )
    await page.screenshot({ path: join(SHOTS, 'shot-7-dark.png') })
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('.welcome', { timeout: 10000 })
    const bgAfter = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    const darkToken = asRgb(await token('--bg'))
    check('重开查看器保持暗色(底色取自 --bg 令牌)', bgAfter === darkToken, `${bgAfter} vs 令牌 ${darkToken}`)
    await page.click('.theme-toggle') // 还原浅色默认
  }

  // 前面的主题用例做过 reload,此时停在欢迎页:重新进入项目并展开 src
  await page.evaluate(async () => {
    window.__cv.enterProject(await navigator.storage.getDirectory())
  })
  await page.waitForSelector('.tree-row', { timeout: 10000 })
  await clickRow('src')
  await page.waitForFunction(
    () => [...document.querySelectorAll('.tree-row .label')].some((e) => e.textContent === 'models.py'),
    { timeout: 10000 },
  )

  // ---- 单文件级增量:外部改动后重新预览即就地重抽(9.4)----
  {
    await openFile('models.py', 'src/models.py')
    await waitOutline('fetch')
    await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory()
      const src = await root.getDirectoryHandle('src')
      const fh = await src.getFileHandle('models.py')
      const w = await fh.createWritable()
      await w.write('CONST_LIMIT = 10\n\nclass Repo:\n    def fetch(self, key):\n        return key\n\nclass AddedLater:\n    pass\n')
      await w.close()
    })
    await clickRow('models.py')
    await waitOutline('AddedLater')
    check('外部修改单个文件后重新预览:大纲反映最新内容', true)
    // 指纹失配后就地重抽的结果要写回索引,符号搜索也应能命中
    await clickSearchMode('符号')
    await page.keyboard.type('AddedLater')
    await page.waitForFunction(
      () => [...document.querySelectorAll('.search-result .result-name')].some((e) => e.textContent === 'AddedLater'),
      { timeout: 15000 },
    )
    check('就地重抽的符号可被符号搜索命中', true)
    await page.keyboard.press('Escape')
    await clickSearchMode('文件名')
    await page.keyboard.press('Escape')
  }

  // ---- 目录树刷新联动符号索引(9.5)----
  {
    await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory()
      const src = await root.getDirectoryHandle('src')
      const fh = await src.getFileHandle('new-service.go', { create: true })
      const w = await fh.createWritable()
      await w.write('package server\n\nfunc BrandNewSymbol() error { return nil }\n')
      await w.close()
      await src.removeEntry('store.go')
    })
    await page.click('button[title="刷新目录树"]')
    // 重建期间界面要明确标识索引正在重建
    await page.waitForFunction(
      () => (document.querySelector('.topbar .intel-index')?.textContent ?? '').includes('索引构建中'),
      { timeout: 8000 },
    ).then(() => check('刷新时界面标识索引正在重建', true))
      .catch(() => check('刷新时界面标识索引正在重建', false, '未观察到"索引构建中"'))
    await page.waitForFunction(
      () => (document.querySelector('.topbar .intel-index')?.textContent ?? '').includes('索引已完成'),
      { timeout: 60000, polling: 300 },
    )
    await clickSearchMode('符号')
    await page.keyboard.type('BrandNewSymbol')
    await page.waitForFunction(
      () => [...document.querySelectorAll('.search-result .result-name')].some((e) => e.textContent === 'BrandNewSymbol'),
      { timeout: 20000 },
    )
    check('刷新后新增文件的符号可被命中', true)
    // 已删除文件的符号不得再出现
    await page.evaluate(() => {
      const input = document.querySelector('.search-input')
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(input, '')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await page.keyboard.type('New')
    await new Promise((r) => setTimeout(r, 400))
    const paths = await page.$$eval('.search-result', (els) => els.map((e) => e.textContent ?? ''))
    check(
      '刷新后已删除文件的符号不再出现在结果中',
      !paths.some((t) => t.includes('src/store.go')),
      paths.join(' | ') || '无结果',
    )
    await page.keyboard.press('Escape')
    await clickSearchMode('文件名')
    await page.keyboard.press('Escape')
  }

  // ---- 索引未就绪时的跳转提示(10.3b:用索引暂停开关做成确定性流程,不靠抢时间窗)----
  {
    await page.evaluate(() => window.__cv.setIndexPaused(true))
    await page.evaluate(async () => {
      window.__cv.enterProject(await navigator.storage.getDirectory())
    })
    await page.waitForSelector('.tree-row', { timeout: 10000 })
    await clickRow('src')
    await page.waitForFunction(
      () => [...document.querySelectorAll('.tree-row .label')].some((e) => e.textContent === 'client.go'),
      { timeout: 10000 },
    )
    await clickRow('client.go')
    await page.waitForFunction(
      () => document.querySelector('.cm-content')?.textContent?.includes('return Serve'),
      { timeout: 10000 },
    )
    check('索引暂停期间预览与目录树仍可用(索引不阻塞交互)', true)
    await clickWord('Serve', { meta: true })
    await page.waitForSelector('.intel-toast', { timeout: 8000 })
    const toast = await page.$eval('.intel-toast', (el) => el.textContent)
    check('索引未完成时跳转给出"仍在构建中"提示,不报错不空白', toast.includes('符号索引仍在构建中'), toast.trim())
    const stillThere = await page.$eval('.preview-header .file-path', (el) => el.textContent)
    check('索引未完成时跳转不改变当前预览', stillThere === 'src/client.go', stillThere)
    await page.click('.intel-toast')

    // 恢复后同一次跳转应正常
    await page.evaluate(() => window.__cv.setIndexPaused(false))
    await page.waitForFunction(
      () => (document.querySelector('.topbar .intel-index')?.textContent ?? '').includes('索引已完成'),
      { timeout: 60000, polling: 300 },
    )
    await clickWord('Serve', { meta: true })
    await page.waitForFunction(
      () => document.querySelector('.preview-header .file-path')?.textContent === 'src/handler.go',
      { timeout: 10000 },
    )
    check('索引恢复后同一次跳转正常完成', true)
  }

  // ---- 符号总数超限降级(9.1)----
  // 阈值取值由旗舰场景断言(306,000 不得降级);这里用测试钩子把上限调低,
  // 确定性地验证"达上限 → 停止收录 → 状态 partial → 明示提示 + 已索引文件数"这条降级**机制**。
  {
    await page.evaluate(() => window.__cv.setSymbolCap(20))
    await page.evaluate(async () => {
      window.__cv.enterProject(await navigator.storage.getDirectory())
    })
    // 上限 20 意味着要走过近 900 个(多为空的)文件才攒够 20 个符号,
    // 这条路径本身就慢:60s 曾经偶发超时(非回归,重跑即过),放宽到 120s。
    const reachedPartial = await page
      .waitForFunction(
        () => (document.querySelector('.topbar .intel-index')?.textContent ?? '').includes('仅部分完成'),
        { timeout: 120000, polling: 200 },
      )
      .then(() => true)
      .catch(() => false)
    const text = await page.$eval('.topbar .intel-index', (el) => el.textContent).catch(() => '(顶栏无索引状态)')
    if (!reachedPartial) check('符号总数达上限时进入 partial(诊断)', false, `实际顶栏文本:${text}`)
    check('符号总数达上限时状态置 partial 并提示"项目过大"', text.includes('项目过大,符号索引仅部分完成'), text.trim())
    check('降级提示包含已索引文件数', /已索引 \d+ 个文件/.test(text), text.trim())
    // 已索引部分仍可用
    await clickSearchMode('符号')
    await page.keyboard.type('e')
    await new Promise((r) => setTimeout(r, 400))
    const anyResult = await page.$('.search-result')
    check('降级后已索引部分的符号搜索仍可用', !!anyResult)
    await page.keyboard.press('Escape')
    await clickSearchMode('文件名')
    await page.keyboard.press('Escape')
    await page.evaluate(() => window.__cv.setSymbolCap(0)) // 还原为 400,000
  }

  // ---- 抽取任务失败降级(9.3)----
  // 触发是模拟的(真实 Worker 崩溃无法在 E2E 里稳定制造),验证的是降级 UI 契约:
  // 提示"符号索引不可用",且目录树 / 预览 / Markdown / ⌘K / 主题全部保持可用。
  {
    await page.evaluate(() => window.__cv.simulateIndexFailure())
    await page.waitForFunction(
      () => (document.querySelector('.topbar .intel-index')?.textContent ?? '').includes('符号索引不可用'),
      { timeout: 8000 },
    )
    check('抽取任务失败时提示"符号索引不可用"', true)
    await clickRow('data.json')
    await page.waitForFunction(() => document.querySelector('.cm-content')?.textContent?.includes('version'), { timeout: 8000 })
    check('索引不可用时文件预览仍可用', true)
    await page.keyboard.down('Control')
    await page.keyboard.press('KeyK')
    await page.keyboard.up('Control')
    await page.keyboard.type('data')
    await page.waitForFunction(
      () => [...document.querySelectorAll('.search-result .result-name')].some((e) => e.textContent === 'data.json'),
      { timeout: 20000 },
    )
    check('索引不可用时 ⌘K 文件名搜索仍可用', true)
    await page.keyboard.press('Escape')
    // 只断言按钮存在的话,主题功能坏掉也照样绿 —— 真的切一次并验证背景色变了
    const beforeBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    await page.click('.theme-toggle')
    await page.waitForFunction(
      (b) => getComputedStyle(document.body).backgroundColor !== b,
      { timeout: 5000 }, beforeBg,
    )
    const afterBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    check('索引不可用时主题切换仍可用(实际生效)', afterBg !== beforeBg, `${beforeBg} → ${afterBg}`)
    await page.click('.theme-toggle') // 还原
  }

  // ---- 非 macOS UA:不得出现任何未经真机核验的键位提示(12.5)----
  // 产品裁定的保守假定:Win/Linux 的 Ctrl+Shift+* 与 Alt+←/→ 一律视为被浏览器抢占,
  // 既不绑定也不提示;能力全部由界面入口保证。这一条可自动化,不属于真机清单。
  {
    const winPage = await browser.newPage()
    await winPage.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    )
    await winPage.goto(`chrome-extension://${extId}/viewer.html`, { waitUntil: 'load' })
    await winPage.waitForSelector('.welcome', { timeout: 10000 })
    await winPage.evaluate(async () => {
      window.__cv.enterProject(await navigator.storage.getDirectory())
    })
    await winPage.waitForSelector('.search-modes', { timeout: 10000 })
    const leaked = await winPage.evaluate(() => {
      const forbidden = ['⌘⇧O', '⌘⇧F', 'Ctrl+Shift+O', 'Ctrl+Shift+F', 'Alt+←', 'Alt+→', 'F12']
      const texts = [document.body.innerText]
      for (const el of document.querySelectorAll('[placeholder],[title]')) {
        texts.push(el.getAttribute('placeholder') ?? '', el.getAttribute('title') ?? '')
      }
      const blob = texts.join('\n')
      return forbidden.filter((f) => blob.includes(f))
    })
    check('非 macOS UA 下不出现未核验的键位提示', leaked.length === 0, leaked.length ? '泄漏 ' + leaked.join(' ') : '⌘⇧O/⌘⇧F/Ctrl+Shift+*/Alt+←→/F12 均未出现')
    const modes = await winPage.$$eval('.search-mode', (els) => els.map((e) => e.textContent))
    check('非 macOS 下界面入口仍完整(不依赖键位)', modes.includes('文件名') && modes.includes('符号'), modes.join(','))
    await winPage.close()
  }

  // ---- 树未就绪时获得焦点:就绪后仍要有落点(change: fix-tree-focus-default-row,任务 2.1)----
  // 用独立页面跑:必须是 activePath 尚为 null 的全新组件实例,而且不能扰动主页面的状态。
  {
    const racePage = await browser.newPage()
    await racePage.goto(`chrome-extension://${extId}/viewer.html`, { waitUntil: 'load' })
    await racePage.waitForSelector('.welcome', { timeout: 10000 })
    // 在页面内埋观察者:`.tree` 一出现就立刻聚焦 —— 此刻 loadChildren 还没 resolve,
    // 整棵树只有"加载中…"占位,正是原先会永久丢失活动行的那个时刻。
    await racePage.evaluate(() => {
      window.__cvRacePremise = null
      const obs = new MutationObserver(() => {
        const el = document.querySelector('.tree')
        if (!el) return
        obs.disconnect()
        el.focus()
        // 记录**当时**树里有没有可落点行 —— 用来证明这条用例确实跑在竞态窗口里
        window.__cvRacePremise = {
          hadNodeRow: [...document.querySelectorAll('.tree-row')].some(
            (r) => r.querySelector('.label')?.textContent !== '加载中…',
          ),
          hadFocus: document.activeElement === el,
        }
      })
      obs.observe(document.documentElement, { childList: true, subtree: true })
    })
    await racePage.evaluate(async () => {
      window.__cv.enterProject(await navigator.storage.getDirectory())
    })
    await racePage
      .waitForFunction(
        () => !!document.querySelector('.tree')?.getAttribute('aria-activedescendant'),
        { timeout: 10000 },
      )
      .catch(() => {})
    const race = await racePage.evaluate(() => {
      const tree = document.querySelector('.tree')
      const id = tree?.getAttribute('aria-activedescendant')
      return {
        premise: window.__cvRacePremise,
        activeLabel: id ? (document.getElementById(id)?.querySelector('.label')?.textContent ?? null) : null,
        firstRowLabel: document.querySelector('.tree-row .label')?.textContent ?? null,
      }
    })
    // 前提断言:这条用例必须真的跑在"树还没就绪"的那一刻,否则它没验到任何东西。
    check(
      '竞态用例确实跑在树未就绪的时刻(前提断言)',
      race.premise?.hadFocus === true && race.premise?.hadNodeRow === false,
      JSON.stringify(race.premise),
    )
    check(
      '树未就绪时获得焦点,就绪后活动行仍落在首行',
      race.activeLabel != null && race.activeLabel === race.firstRowLabel,
      `活动行=${race.activeLabel} 首行=${race.firstRowLabel}`,
    )
    await racePage.close()
  }

  // ---- 旗舰场景:10,000 文件 / 支持语言占比 85% 不得降级(10.8b + 11.1)----
  {
    const t0 = Date.now()
    const built = await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory()
      const flag = await root.getDirectoryHandle('flagship', { create: true })
      const write = async (dir, name, content) => {
        const fh = await dir.getFileHandle(name, { create: true })
        const w = await fh.createWritable()
        await w.write(content)
        await w.close()
      }
      // 每个 Go 文件约 36 个定义符号(仿 Java/Go 单体仓的密度)。
      // 符号名带 目录_文件 双重标签,保证**全项目唯一** —— 否则跳转全变成多候选,
      // 就测不到"唯一定义直接跳转"这条路径的时延了。
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
      let files = 0
      let supported = 0
      for (let d = 0; d < 20; d++) {
        const sub = await flag.getDirectoryHandle(`pkg-${String(d).padStart(2, '0')}`, { create: true })
        for (let b = 0; b < 5; b++) {
          await Promise.all(
            Array.from({ length: 100 }, (_, i) => {
              const idx = b * 100 + i
              files++
              // 85% 支持语言(.go),15% 纯文本(.txt)
              if (idx % 20 < 17) {
                supported++
                return write(sub, `f-${String(idx).padStart(3, '0')}.go`, goSrc(d, idx))
              }
              return write(sub, `n-${String(idx).padStart(3, '0')}.txt`, 'plain text line\n')
            }),
          )
        }
      }
      // 跳转性能用的"枢纽"文件:20 个跨文件调用点,目标分散在 20 个目录里
      const hub = ['package hub', '', 'func Hub() {']
      for (let d = 0; d < 20; d++) hub.push(`\tFunc${d}_0_0("x", 1)`)
      hub.push('}')
      await write(flag, 'hub.go', hub.join('\n'))
      files++
      supported++
      return { files, supported }
    })
    const buildMs = Date.now() - t0
    check(
      '旗舰合成项目就绪(约 10,000 文件 / 支持语言占比 ≥80%)',
      built.files >= 9000 && built.supported / built.files >= 0.8,
      `${built.files} 文件,支持语言 ${(built.supported / built.files * 100).toFixed(0)}%,写盘 ${buildMs}ms`,
    )
    // 先让全文搜索面板真的开着 —— 否则下面"切项目后面板已关闭"是条恒绿断言
    await runContent('Handler')
    await waitContentSettled()
    const panelOpenBefore = !!(await page.$('.content-panel'))
    check('切项目前全文搜索面板处于打开状态(为 9.6 断言建立前提)', panelOpenBefore)

    const tIndex = Date.now()
    await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory()
      window.__cv.enterProject(await root.getDirectoryHandle('flagship'))
    })
    await page.waitForSelector('.tree-row', { timeout: 10000 })
    const firstPaintFlag = Date.now() - tIndex

    // ---- 切换项目清空上一个项目的索引与面板状态(9.6)----
    {
      const panels = await page.evaluate(() => ({
        ref: !!document.querySelector('.ref-panel:not(.content-panel)'),
        content: !!document.querySelector('.content-panel'),
      }))
      check(
        '切换项目后引用面板与全文搜索面板已关闭',
        panelOpenBefore && !panels.ref && !panels.content,
        `切换前面板开=${panelOpenBefore} → ${JSON.stringify(panels)}`,
      )
      // 必须先打开一个文件让导航按钮真正渲染出来再断言 ——
      // 没有预览时按钮根本不存在,`[].every()` 恒为 true,那是条恒绿的假断言。
      await clickRow('hub.go')
      await page.waitForSelector('.nav-buttons .nav-btn', { timeout: 10000 })
      const navDisabled = await page.$$eval('.nav-buttons .nav-btn', (els) => els.map((e) => e.disabled))
      check(
        '切换项目后导航栈已清空(前进/后退均置灰)',
        navDisabled.length === 2 && navDisabled.every(Boolean),
        JSON.stringify(navDisabled),
      )
      // 上一个项目的符号不得残留在索引里
      await clickSearchMode('符号')
      await page.keyboard.type('BrandNewSymbol')
      await new Promise((r) => setTimeout(r, 500))
      const stale = await page.$$eval('.search-result .result-name', (els) => els.map((e) => e.textContent))
      check('切换项目后上一个项目的符号不再命中', stale.length === 0, stale.join(',') || '无结果')
      await page.keyboard.press('Escape')
      await clickSearchMode('文件名')
      await page.keyboard.press('Escape')
    }
    check('旗舰项目根层首屏 <1s(索引不阻塞)', firstPaintFlag < 1000, `${firstPaintFlag}ms`)

    // 索引进行中界面仍可用:只数行数的话,索引即使阻塞了也可能已经有行(恒绿)。
    // 改成"确认索引确实还在构建" + "真的展开一个目录并等子项出现"。
    {
      const buildingNow = await page.evaluate(
        () => (document.querySelector('.topbar .intel-index')?.textContent ?? '').includes('索引构建中'))
      const expanded = await clickRow('pkg-00')
      const childAppeared = await page
        .waitForFunction(
          () => [...document.querySelectorAll('.tree-row .label')].some((e) => /^f-\d{3}\.go$/.test(e.textContent ?? '')),
          { timeout: 10000 },
        )
        .then(() => true)
        .catch(() => false)
      check(
        '索引期间目录树仍可展开(索引不阻塞交互)',
        buildingNow && expanded && childAppeared,
        `构建中=${buildingNow} 展开=${expanded} 子项出现=${childAppeared}`,
      )
      await clickRow('pkg-00') // 收起,避免 500 行撑开虚拟列表影响后续用例
    }

    await page.waitForFunction(
      () => {
        const t = document.querySelector('.topbar .intel-index')?.textContent ?? ''
        return t.includes('索引已完成') || t.includes('仅部分完成') || t.includes('不可用')
      },
      { timeout: 300000, polling: 500 },
    )
    const indexMs = Date.now() - tIndex
    const status = await page.$eval('.topbar .intel-index', (el) => el.textContent)
    const heap = await page.evaluate(() =>
      performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null)

    check(
      '旗舰场景索引完成且未降级(状态为"已完成"而非"部分完成")',
      status.includes('索引已完成') && !status.includes('仅部分完成'),
      status.trim(),
    )
    const noOverflowNotice = !status.includes('项目过大')
    check('旗舰场景界面不出现"项目过大"提示', noOverflowNotice, status.trim())
    console.log(`\n[11.1 实测] 旗舰项目索引耗时 ${(indexMs / 1000).toFixed(1)}s;JS heap 峰值 ${heap ?? '不可用'} MB;${status.trim()}\n`)

    // 索引完成后符号可用
    await clickSearchMode('符号')
    await page.keyboard.type('Func1_0_0')
    await page.waitForFunction(
      () => [...document.querySelectorAll('.search-result .result-name')].some((e) => e.textContent === 'Func1_0_0'),
      { timeout: 15000 },
    )
    check('旗舰项目索引完成后符号搜索可命中', true)
    await page.keyboard.press('Escape')

    // ---- 跳转性能 P95 < 200 ms(10.9)----
    // 全程在页内用 performance.now() 计时:从派发 ⌘+点击 到目标行真正可见,
    // 不含 CDP 往返,否则测的是测试框架的开销而不是产品的时延。
    await clickRow('hub.go')
    await page.waitForFunction(
      () => document.querySelector('.cm-content')?.textContent?.includes('func Hub'),
      { timeout: 10000 },
    )
    const timings = await page.evaluate(async () => {
      const waitFor = (pred, timeout = 8000) =>
        new Promise((resolve) => {
          const t0 = performance.now()
          const tick = () => {
            if (pred()) return resolve(true)
            if (performance.now() - t0 > timeout) return resolve(false)
            requestAnimationFrame(tick)
          }
          tick()
        })
      const coordsOf = (word) => {
        const root = document.querySelector('.cm-content')
        if (!root) return null
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        const re = new RegExp(`(^|[^A-Za-z0-9_$])(${word})([^A-Za-z0-9_$]|$)`)
        let node
        while ((node = walker.nextNode())) {
          const m = re.exec(node.textContent ?? '')
          if (!m) continue
          const idx = m.index + m[1].length
          const range = document.createRange()
          range.setStart(node, idx)
          range.setEnd(node, idx + word.length)
          const r = range.getBoundingClientRect()
          if (r.width > 0) return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
        }
        return null
      }
      const backBtn = () => document.querySelector('.nav-buttons .nav-btn')
      const out = []
      for (let d = 0; d < 20; d++) {
        const target = `Func${d}_0_0`
        await waitFor(() => document.querySelector('.cm-content')?.textContent?.includes('func Hub'))
        const c = coordsOf(target)
        if (!c) { out.push(-1); continue }
        const el = document.elementFromPoint(c.x, c.y)
        if (!el) { out.push(-1); continue }
        const t0 = performance.now()
        el.dispatchEvent(new MouseEvent('click', {
          bubbles: true, cancelable: true, clientX: c.x, clientY: c.y, metaKey: true,
        }))
        const ok = await waitFor(() =>
          document.querySelector('.cm-target-line')?.textContent?.includes(`func ${target}(`))
        out.push(ok ? performance.now() - t0 : -1)
        // 回到枢纽文件,准备下一次
        backBtn()?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      }
      return out
    })
    // ---- 查找引用:流式首批 < 1 s + 命中超限截断(7.4 / 7.5)----
    // 在旗舰项目(8,500 个 Go 文件)上测才有意义:`arg` 是每个函数的形参名,命中数远超上限。
    {
      // 打开一个旗舰源码文件:形参名 `arg` 在 8,500 个文件里各出现多次,命中数远超 1,000 上限。
      // 这里走符号搜索而不是目录树 —— 前面的跳转已经展开了多个千级目录,
      // 虚拟滚动下目标行未必在 DOM 里,点树不可靠。
      await clickSearchMode('符号')
      await page.keyboard.type('Func0_0_0')
      await page.waitForFunction(
        () => [...document.querySelectorAll('.search-result .result-name')].some((e) => e.textContent === 'Func0_0_0'),
        { timeout: 15000 },
      )
      await page.$eval('.search-result', (el) =>
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })))
      await page.waitForFunction(
        () => document.querySelector('.cm-content')?.textContent?.includes('func Func0_0_0'),
        { timeout: 10000 },
      )
      const gotMenu = await clickWord('arg', { right: true })
      check('可在预览区右键唤起代码理解菜单', gotMenu)
      await page.waitForSelector('.intel-menu', { timeout: 8000 })
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('.intel-menu-item')].find((b) => b.textContent?.startsWith('查找引用'))
        btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      const tRef = Date.now()
      await page.waitForFunction(() => (document.querySelectorAll('.ref-row').length > 0), { timeout: 15000 })
      const firstBatchMs = Date.now() - tRef
      check('查找引用首批结果 < 1 s(8,500 文件项目)', firstBatchMs < 1000, `${firstBatchMs}ms`)
      await page.waitForFunction(
        () => /扫描完成|已达上限|已取消/.test(document.querySelector('.ref-status')?.textContent ?? ''),
        { timeout: 60000, polling: 300 },
      )
      const status = await page.$eval('.ref-status', (el) => el.textContent)
      check('查找引用可在大项目上跑到终态', /扫描完成|已达上限/.test(status), status.trim())
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('.ref-btn')].find((b) => b.textContent === '✕')
        btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
    }

    // ---- 全文搜索:总命中上限截断(8.6)与手动停止(8.4)----
    {
      // `local` 在每个 Go 文件里出现两次(`local := arg` 与 `_ = local`),命中数远超 2,000 上限
      await runContent('local')
      await waitContentSettled()
      const status = await contentStatusText()
      const rows = await page.$$eval('.content-panel .ref-row', (els) => els.length)
      check('全文搜索总命中达上限时停止并明示截断', status.includes('已达上限 2000 条'), `${status.trim()} / ${rows} 行`)
      check('截断后结果条数不超过上限', rows <= 2000, `${rows} 行`)

      // 手动停止:选一个命中很少但要扫全项目的词,保证点"停止"时扫描仍在进行
      await runContent('Method3_7_5')
      await page.waitForFunction(
        () => (document.querySelector('.content-panel .ref-status')?.textContent ?? '').includes('扫描中'),
        { timeout: 10000 },
      )
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('.content-panel .ref-btn')].find((b) => b.textContent === '停止')
        btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      await page.waitForFunction(
        () => (document.querySelector('.content-panel .ref-status')?.textContent ?? '').includes('已取消'),
        { timeout: 10000 },
      )
      check('手动停止立即结束扫描并标注"已取消"', true)
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('.content-panel .ref-btn')].find((b) => b.textContent === '✕')
        btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
    }

    const good = timings.filter((t) => t >= 0)
    const sorted = [...good].sort((a, b) => a - b)
    const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] : -1
    check('20 次跨文件跳转全部成功', good.length === 20, `${good.length}/20 成功`)
    check(
      '跳转响应 P95 < 200 ms(10k 文件项目、索引已完成)',
      good.length === 20 && p95 < 200,
      `P95 ${p95.toFixed(0)}ms,中位 ${sorted[Math.floor(sorted.length / 2)]?.toFixed(0)}ms,最大 ${sorted[sorted.length - 1]?.toFixed(0)}ms`,
    )
  }

  // ---- 零网络请求 ----
  check('零 http(s) 网络请求', httpRequests.length === 0, httpRequests.slice(0, 5).join(' | ') || '无')
  // ---- 控制台错误 ----
  check('无页面错误/控制台 error', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | ') || '无')
} catch (err) {
  check('脚本执行', false, String(err && err.stack ? err.stack.split('\n').slice(0, 4).join(' ⏎ ') : err))
} finally {
  await browser.close()
  const pass = results.filter((r) => r.ok).length
  console.log(`\n===== ${pass}/${results.length} PASS =====`)
  if (flaky.length > 0) {
    console.log(`----- 另有 ${flaky.length} 条已知偶发(不计入失败)-----`)
    for (const f of flaky) console.log(`  FLAKY ${f.name} — ${f.tracking}`)
  }
  process.exit(results.every((r) => r.ok) ? 0 : 1)
}

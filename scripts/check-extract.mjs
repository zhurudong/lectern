// 符号抽取自查(任务 3.9 / 11.4):逐语言跑样例,断言
//   ① 该收的定义齐全  ② 形参与局部变量不在结果中  ③ 行号与实际一致
// 并按任务 11.4 的口径统计 C/C++ 的误收率与漏收率。
// 用 esbuild(vite 自带)把 TS 源打成临时 ESM 后直接在 node 里跑。
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PROJECT } from './paths.mjs'

const out = join(mkdtempSync(join(tmpdir(), 'cv-extract-')), 'extract.mjs')
await build({
  entryPoints: [join(PROJECT, 'src/intel/extract.ts')],
  bundle: true,
  format: 'esm',
  outfile: out,
  platform: 'node',
  logLevel: 'error',
})
const { extractSymbols } = await import(out)

const results = []
const check = (name, ok, extra = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`)
}

// 每个样例:源码 + 期望收到的符号(name@line)+ 绝不允许出现的名字(形参/局部变量)
const CASES = [
  {
    lang: 'python',
    src: `CONST_X = 42
mutable_top = 1

class Greeter:
    prefix = "hi"

    def __init__(self, name, times):
        local_var = 1
        self.stored = name

    def greet(self, loud=False):
        def inner_helper(q):
            return q
        return inner_helper(loud)

def top_level(a, b):
    tmp = a + b
    return tmp
`,
    expect: ['CONST_X@1', 'mutable_top@2', 'Greeter@4', 'prefix@5', '__init__@7', 'greet@11', 'inner_helper@12', 'top_level@16'],
    forbid: ['name', 'times', 'loud', 'q', 'a', 'b', 'local_var', 'tmp', 'self'],
  },
  {
    lang: 'java',
    src: `package demo;

public class Service {
    private int counter;
    public static final String NAME = "svc";

    public Service(int seed) { this.counter = seed; }

    public String handle(String request, int retries) {
        int localTmp = retries + 1;
        return request + localTmp;
    }
}

interface Runner { void run(String arg); }

enum Color { RED, GREEN }
`,
    expect: ['Service@3', 'counter@4', 'NAME@5', 'Service@7', 'handle@9', 'Runner@15', 'run@15', 'Color@17', 'RED@17', 'GREEN@17'],
    forbid: ['seed', 'request', 'retries', 'localTmp', 'arg'],
  },
  {
    lang: 'go',
    src: `package main

import "fmt"

type Handler struct {
	Name string
}

type Runner interface {
	Run(ctx int) error
}

const MaxRetries = 3

var globalCounter int

func Serve(addr string, timeout int) error {
	localVar := addr
	fmt.Println(localVar, timeout)
	return nil
}

func (h *Handler) Handle(req string) string {
	inner := func(z int) int { return z }
	_ = inner
	return h.Name + req
}
`,
    expect: ['Handler@5', 'Name@6', 'Runner@9', 'Run@10', 'MaxRetries@13', 'globalCounter@15', 'Serve@17', 'Handle@23'],
    forbid: ['addr', 'timeout', 'localVar', 'req', 'ctx', 'inner', 'z', 'h', 'main'],
  },
  {
    lang: 'cpp',
    src: `#include <stdio.h>
#define MAX_SIZE 1024
#define SQUARE(x) ((x)*(x))

typedef unsigned int Uint;

namespace app {

struct Point {
    int x;
    int y;
};

enum Color { RED, GREEN };

class Widget {
public:
    int width;
    void resize(int newWidth, int newHeight);
};

}

void app::Widget::resize(int newWidth, int newHeight) {
    int localTmp = newWidth;
    width = localTmp + newHeight;
}

int compute(int a, int b) {
    int sum = a + b;
    return sum;
}
`,
    expect: ['MAX_SIZE@2', 'SQUARE@3', 'Uint@5', 'app@7', 'Point@9', 'x@10', 'y@11', 'Color@14', 'RED@14', 'GREEN@14', 'Widget@16', 'width@18', 'resize@19', 'resize@24', 'compute@29'],
    // 宏形参 x 与 Point 的字段 x 同名,单独在 forbid 里判会误伤 —— 见下方 cppMacroParam 专项断言
    forbid: ['newWidth', 'newHeight', 'localTmp', 'a', 'b', 'sum'],
  },
  {
    lang: 'typescript',
    src: `export interface Options { name: string; retries: number }

type Alias = string | number

enum Level { Low, High }

export const TOP_CONST = 42
let mutableTop = 1

export function process(input: string, count: number): string {
    const localOnly = input.repeat(count)
    return localOnly
}

export const arrowFn = (p1: number, p2: number) => p1 + p2

export class Engine {
    private field = 1
    run(taskName: string, opts: Options) {
        let inner = taskName
        for (const loopVar of []) { void loopVar }
        return inner
    }
}
`,
    expect: ['Options@1', 'Alias@3', 'Level@5', 'TOP_CONST@7', 'mutableTop@8', 'process@10', 'arrowFn@15', 'Engine@17', 'field@18', 'run@19'],
    forbid: ['input', 'count', 'localOnly', 'p1', 'p2', 'taskName', 'opts', 'inner', 'loopVar'],
  },
  {
    lang: 'rust',
    src: `use std::fmt;

pub const MAX: u32 = 10;
static GLOBAL: i32 = 0;

pub struct Point {
    x: i32,
    y: i32,
}

enum Color { Red, Green }

pub trait Shape {
    fn area(&self) -> f64;
}

type Alias = u32;

impl Point {
    pub fn new(a: i32, b: i32) -> Point {
        let local = a + b;
        Point { x: a, y: b }
    }
}

pub fn free_fn(arg: i32) -> i32 {
    let inner = arg;
    inner
}

mod submod {
    pub fn helper() {}
}
`,
    expect: ['MAX@3', 'GLOBAL@4', 'Point@6', 'x@7', 'y@8', 'Color@11', 'Red@11', 'Green@11', 'Shape@13', 'area@14', 'Alias@17', 'new@20', 'free_fn@26', 'helper@32', 'submod@31'],
    // 形参 a/b/arg、局部变量 local/inner、impl 目标类型的重复 Point、字段初始化 x/y:全部不收
    forbid: ['a', 'b', 'arg', 'local', 'inner', 'self', 'u32', 'i32', 'f64'],
  },
  {
    lang: 'php',
    src: `<?php
namespace App;

const MAX = 10;

interface Shape {
    public function area(): float;
}

trait Greet {
    public function hello() { return "hi"; }
}

class Point implements Shape {
    public int $x = 0;
    private $y;
    const SCALE = 2;

    public function __construct($a, $b) {
        $local = $a;
        $this->x = $a;
    }

    public function area(): float {
        $tmp = 1.0;
        return $tmp;
    }
}

enum Suit {
    case Hearts;
    case Spades;
}

function free_fn($arg) {
    $inner = $arg;
    return $inner;
}
`,
    // 类属性保留 PHP 的 `$` 拼写($x/$y),与源码一致
    expect: ['App@2', 'MAX@4', 'Shape@6', 'area@7', 'Greet@10', 'hello@11', 'Point@14', '$x@15', '$y@16', 'SCALE@17', '__construct@19', 'area@24', 'Suit@30', 'Hearts@31', 'Spades@32', 'free_fn@35'],
    // 形参 $a/$b/$arg、局部 $local/$tmp/$inner、成员访问 $this、返回类型 float:不收
    forbid: ['$a', '$b', '$arg', '$local', '$tmp', '$inner', '$this', 'float'],
  },
]

for (const c of CASES) {
  const syms = extractSymbols(c.src, c.lang)
  const got = syms.map((s) => `${s.name}@${s.line}`)
  const missing = c.expect.filter((e) => !got.includes(e))
  check(`[${c.lang}] 定义齐全且行号正确(${c.expect.length} 项)`, missing.length === 0, missing.length ? '缺失: ' + missing.join(', ') : got.join(' '))
  const leaked = c.forbid.filter((f) => syms.some((s) => s.name === f))
  check(`[${c.lang}] 形参与局部变量未被收录`, leaked.length === 0, leaked.length ? '误收: ' + leaked.join(', ') : `已排除 ${c.forbid.length} 项`)
}

// C/C++ 头文件原型(任务 3.10):纯声明头文件的大纲不得为空
{
  const header = `#ifndef DEMO_H
#define DEMO_H

typedef struct Node Node;

int helper(int a, int b);
void reset(void);

struct Config {
    int size;
    void apply(int v);
};

#endif
`
  const syms = extractSymbols(header, 'c')
  const got = syms.map((s) => `${s.name}@${s.line}`)
  const expect = ['DEMO_H@2', 'Node@4', 'helper@6', 'reset@7', 'Config@9', 'size@10', 'apply@11']
  const missing = expect.filter((e) => !got.includes(e))
  check('[cpp] 纯声明头文件的原型进入大纲(自由函数 + 类成员)', missing.length === 0, missing.length ? '缺失: ' + missing.join(', ') : got.join(' '))
  const leaked = ['a', 'b', 'v'].filter((f) => syms.some((s) => s.name === f))
  check('[cpp] 原型的形参未被收录', leaked.length === 0, leaked.length ? '误收: ' + leaked.join(', ') : '已排除 a/b/v')
  const helper = syms.find((s) => s.name === 'helper')
  check('[cpp] 自由函数原型的种类标为"声明"(15)', helper?.kind === 15, `kind=${helper?.kind}`)
}

// C/C++ 宏形参专项:#define SQUARE(x) 的 x 不得作为宏被收录
{
  const syms = extractSymbols(CASES[3].src, 'cpp')
  const macroParam = syms.filter((s) => s.name === 'x' && s.line === 3)
  check('[cpp] #define 的宏形参未被收录', macroParam.length === 0, `第 3 行收到 ${macroParam.length} 项`)
}

// 容器名解析
{
  const syms = extractSymbols(CASES[1].src, 'java')
  const handle = syms.find((s) => s.name === 'handle')
  check('[java] 方法的容器名为所属类', handle?.container === 'Service', String(handle?.container))
  const cppSyms = extractSymbols(CASES[3].src, 'cpp')
  const outOfLine = cppSyms.find((s) => s.name === 'resize' && s.line === 24)
  check('[cpp] 类外定义取末段为名、限定段为容器', outOfLine?.container === 'app::Widget', `${outOfLine?.name} / ${outOfLine?.container}`)
  const goSyms = extractSymbols(CASES[2].src, 'go')
  const field = goSyms.find((s) => s.name === 'Name')
  check('[go] 结构体字段的容器名为结构体', field?.container === 'Handler', String(field?.container))
  // Go 方法的容器是接收者类型(在 Parameters 里,不在祖先链上)
  const method = goSyms.find((s) => s.name === 'Handle')
  check('[go] 方法的容器名为接收者类型', method?.container === 'Handler', String(method?.container))
  const ifaceMethod = goSyms.find((s) => s.name === 'Run')
  check('[go] 接口方法的容器名为接口', ifaceMethod?.container === 'Runner', String(ifaceMethod?.container))
  // Rust:impl 块内方法的容器为目标类型;结构体字段的容器为结构体
  const rustSyms = extractSymbols(CASES[5].src, 'rust')
  const rustMethod = rustSyms.find((s) => s.name === 'new')
  check('[rust] impl 方法的容器名为目标类型', rustMethod?.container === 'Point', String(rustMethod?.container))
  const rustField = rustSyms.find((s) => s.name === 'x' && s.line === 7)
  check('[rust] 结构体字段的容器名为结构体', rustField?.container === 'Point', String(rustField?.container))
  // PHP:类方法的容器为类;类属性的容器为类
  const phpSyms = extractSymbols(CASES[6].src, 'php')
  const phpMethod = phpSyms.find((s) => s.name === '__construct')
  check('[php] 类方法的容器名为类', phpMethod?.container === 'Point', String(phpMethod?.container))
  const phpField = phpSyms.find((s) => s.name === '$x')
  check('[php] 类属性的容器名为类', phpField?.container === 'Point', String(phpField?.container))
}

// Markdown 标题大纲:围栏代码块内的 # 不得计入
{
  const md = `# 一级
正文
\`\`\`sh
# 这是注释不是标题
\`\`\`
## 二级
### 三级
`
  const syms = extractSymbols(md, 'markdown')
  const names = syms.map((s) => `${s.name}@${s.line}/L${s.level}`)
  check('[markdown] 标题层级正确且跳过围栏内的 #', names.join(' ') === '一级@1/L1 二级@6/L2 三级@7/L3', names.join(' '))
}

// 不支持的语言返回空
check('[yaml] 不支持的语言返回空结果', extractSymbols('a: 1\nb: 2\n', 'yaml').length === 0)

// —— 任务 11.4 的 C/C++ 可判定指标 ——
{
  const src = CASES[3].src
  const syms = extractSymbols(src, 'cpp')
  // 人工标注的真定义(见 expect),误收 = 收到但不在标注集合里的
  const annotated = new Set(CASES[3].expect)
  const gotKeys = syms.map((s) => `${s.name}@${s.line}`)
  const wrong = gotKeys.filter((k) => !annotated.has(k))
  const missed = [...annotated].filter((k) => !gotKeys.includes(k))
  const falseRate = syms.length ? wrong.length / syms.length : 0
  const missRate = annotated.size ? missed.length / annotated.size : 0
  console.log(`\n[C/C++ 指标] 总符号 ${syms.length} / 误收 ${wrong.length}(${(falseRate * 100).toFixed(1)}%)${wrong.length ? ' → ' + wrong.join(', ') : ''} / 漏收 ${missed.length}(${(missRate * 100).toFixed(1)}%)${missed.length ? ' → ' + missed.join(', ') : ''}`)
  check('[cpp] 误收率 ≤ 5%(任务 11.4 指标①)', falseRate <= 0.05, `${(falseRate * 100).toFixed(1)}%`)
  check('[cpp] 定义漏收率 ≤ 15%(任务 11.4 指标③)', missRate <= 0.15, `${(missRate * 100).toFixed(1)}%`)
}

const pass = results.filter((r) => r.ok).length
console.log(`\n===== ${pass}/${results.length} PASS =====`)
process.exit(results.every((r) => r.ok) ? 0 : 1)

// 重目录排除(design.md D1 / D2)。
//
// **这是排除判定的唯一一份实现。** 三个消费者——目录树遍历、文件名索引 Worker、
// 符号索引派发——全部 import 这里的函数,而**不是各自维护一份同样的名单**:
// 规则重复出现在多处实现,就是接缝的物理形态(本项目已在别处吃过两次亏)。
//
// 为什么按**目录名**匹配而不解析 `.gitignore`:
// - `.gitignore` 会排除掉用户**明确想读**的东西(构建产物有时正是要读的对象),
//   而我们是阅读器不是构建工具;
// - 最关键的是**用户能不能解释"为什么这个目录不见了"**。固定名单可以
//   ("因为它叫 node_modules"),`.gitignore` 的规则链不行 ——
//   一个看得见却解释不了的排除,只完成了一半。
//
// 纯函数,无 DOM / FSA 依赖,所以主线程与 Worker 都能直接引用。

/**
 * 默认排除的目录名。
 *
 * 从一开始就带上各生态的常见重目录,**不能只放 `node_modules` 就收工** ——
 * 那会让 Rust / Python 用户在下一轮重复同一个惊喜。
 */
export const EXCLUDED_DIRS: readonly string[] = [
  '.git',
  'node_modules',
  'target', // Rust
  '.venv', // Python
  '__pycache__',
  'dist',
  'build',
  '.next',
  '.cache',
]

const EXCLUDED = new Set(EXCLUDED_DIRS)

/** 该**目录名**是否属于默认排除项(只看名字,不做路径深度或内容推断) */
export function isExcludedDirName(name: string): boolean {
  return EXCLUDED.has(name)
}

/**
 * 路径(相对项目根的路径段)是否落在任何一个被排除的目录之内。
 * 用于判断"这个文件是否处在项目级索引范围之外"。
 */
export function isInExcludedPath(path: readonly string[]): boolean {
  // 末段可能是文件名,只需检查它前面的目录段;但目录本身传进来时末段也是目录名,
  // 因此整条路径都检查一遍最省心,且不会误判(文件名与排除名重合的概率可忽略,
  // 且即便重合,该文件确实位于同名目录语义之下也不影响索引正确性)。
  return path.some((seg) => EXCLUDED.has(seg))
}

/** 相对路径字符串版本(Worker 侧拿到的是 `a/b/c.ts` 形式) */
export function isInExcludedRelPath(relPath: string): boolean {
  return relPath.split('/').some((seg) => EXCLUDED.has(seg))
}

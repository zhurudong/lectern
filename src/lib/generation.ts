// 全局代次(design.md D2):文件名索引、符号索引、全文搜索共用同一个失效标记。
//
// 原先 searchStore.ts 各自持有局部 token,三套索引各自失效会漂移;提为模块级单一代次后,
// "切换项目 / 刷新目录树 → generation++ → 所有在途回包统一作废" 由同一个机制保证。

let current = 0

export function generation(): number {
  return current
}

/** 项目切换、目录树刷新时调用:使所有在途任务与回包过期 */
export function nextGeneration(): number {
  return ++current
}

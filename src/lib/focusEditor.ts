// 把焦点交给代码编辑器(fix-jump-focus-handoff 1.1)。
//
// **为什么需要"等就绪"而不是直接 focus**:导航会换文件,CodeView 随之**异步重挂** ——
// 在 `blur()` 或 `navigate()` 那一刻去 focus,拿到的可能是**上一份文档的编辑器**,
// 甚至什么都没有。所以这里逐帧等到编辑器真的在位再交接。
//
// **为什么是"交接"而不是"抢"**:只有调用方明确表示"这次动作的落点是代码"时才调它
// (搜索跳转、候选选中)。像目录树 Enter 那种"用户还要继续在树里浏览"的动线
// **不该调** —— 那会把用户从他正在用的面板里踢走。
const MAX_FRAMES = 60 // 约 1 秒:够覆盖一次换文件重挂,又不会长期跟用户抢焦点

/** 只允许一个交接在跑:新的一次开始时,旧的立刻作废 */
let runToken = 0

/**
 * @param handOverFrom 发起交接时**自己正持有焦点**的那个元素。
 *
 * 让位守卫默认认为"焦点已在某个具体元素上 = 名花有主,不要抢"。
 * 但有一种情况不是抢:**当前持有者自己要把焦点交出去** ——
 * 比如大纲面板上按 Enter,意思就是"带我去那段代码"。
 * 这时把发起者传进来,守卫才分得清"别人占着"与"占着的人正在交出"。
 */
export function focusEditorWhenReady(handOverFrom?: Element | null): void {
  const token = ++runToken
  let frames = 0
  let stable = 0
  const tick = () => {
    if (token !== runToken) return // 已被更新的一次交接取代
    const ae = document.activeElement
    // **别人已经明确接管了焦点,就让位。**
    //
    // 这个轮询会持续约 1 秒。若这期间弹出了候选面板(它会把焦点移进自己),
    // 继续轮询就会把焦点抢回编辑器 —— 用户看到的是"面板弹出来了但键盘用不了"。
    // 实测代价:这条正是我加完交接后弄红「多候选弹出后焦点落在面板内」的原因。
    //
    // 判据:焦点既不在 body(无人接管)、也不在某个代码区上,就说明有别的东西
    // 主动要了焦点 —— 那时**交接的前提已经不成立**,不该再坚持。
    const isHandOver = !!handOverFrom && (ae === handOverFrom || handOverFrom.contains(ae))
    if (
      !isHandOver &&
      ae &&
      ae !== document.body &&
      !(ae instanceof HTMLElement && ae.classList.contains('cm-content'))
    ) {
      return
    }
    const el = document.querySelector('.cm-content')
    if (el instanceof HTMLElement) {
      if (ae === el) {
        // 连续两帧都还在它身上才算稳:重挂会把刚设上的焦点冲掉,
        // 只看一帧会得到"设过了"的假象。
        if (++stable >= 2) return
      } else {
        stable = 0
        el.focus()
      }
    }
    if (++frames < MAX_FRAMES) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

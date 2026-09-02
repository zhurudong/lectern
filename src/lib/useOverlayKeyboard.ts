import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'

// 临时浮层的键盘与焦点管理(fix-overlay-keyboard-focus 1.1)。
//
// **三处需要:多候选面板、引用面板、全文搜索结果面板**(帮助面板那一包落地时也复用这里)。
// 抽象是**由重复驱动的** —— 当初大纲没抽,是因为那时只有两处且数据模型不同;
// 现在条件变了,结论跟着变。这不是推翻那条原则,正是在执行它。
//
// 它管三件事,少一件浮层就"能弹出但用不了":
//   1. **移入**:浮层打开时把焦点接过来,否则键盘事件根本不会到达它;
//   2. **选中**:维护当前项并保证可见(超出视口要滚回来);
//   3. **归还**:关闭时把焦点还回触发处 —— 不还的话焦点掉到 body,
//      用户下一次 Tab 会从页面开头重来,而他刚才明明在代码区某一行上。
export interface OverlayKeyboard {
  /** 挂到浮层容器上(容器需 tabIndex={-1}) */
  containerRef: { current: HTMLDivElement | null }
  /** 当前选中项下标 */
  selected: number
  setSelected: (i: number) => void
  onKeyDown: (e: KeyboardEvent) => void
  /** 供 aria-activedescendant 使用 */
  activeId: string
  /**
   * 激活某一项(键盘 Enter 与鼠标点击**共用这一条**)。
   * 走这条路会标记"本次是激活而非取消",于是**跳过通用的焦点归还** ——
   * 因为激活的落点由调用方显式指定(通常是代码区),不该被归还逻辑覆盖。
   */
  activate: (index: number) => void
  /** 关闭并归还焦点:Esc、✕、点背景**共用这一条**,不要各自调 onClose */
  close: () => void
}

export function useOverlayKeyboard(opts: {
  open: boolean
  count: number
  idPrefix: string
  onActivate: (index: number) => void
  onClose: () => void
  /**
   * **激活一项之后,这个浮层会不会因此关闭?**
   *
   * 只有"激活即关闭"的浮层(如候选面板)才需要跳过通用归还 ——
   * 因为那一次关闭的成因是激活,落点由调用方另行指定。
   *
   * 而"激活后仍保持打开"的浮层(引用、全文)**永远不该置这个标记**:
   * 它们的关闭永远是用户按取消键,与之前跳转过几次无关。
   *
   * **标记必须描述"这一次关闭的成因",MUST NOT 描述"这个面板历史上发生过什么"。**
   * (缺了这条约束时的真实后果:全文面板跳转过一次之后,标记永久为真,
   *  此后每次按 Esc 都跳过归还,焦点落空 —— 而它是唯一"激活后不关闭"的浮层,
   *  所以偏偏只有它出问题,看起来像个案。)
   */
  closesOnActivate?: boolean
}): OverlayKeyboard {
  const { open, count, idPrefix, onActivate, onClose, closesOnActivate = false } = opts
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [selected, setSelected] = useState(0)
  const returnToRef = useRef<Element | null>(null)
  /** 本次关闭是否由"激活某一项"引起 —— 是的话不做通用归还 */
  const activatedRef = useRef(false)

  // 打开:记住触发处 → 移入焦点 → 选中第一项;
  // 卸载(关闭):把焦点还回去。归还写在 cleanup 里,所以 Esc / 点击 ✕ / 点背景
  // 三条关闭路径**共用同一段归还逻辑**,不必各自记得调用。
  // 焦点接管属于 DOM 提交的一部分,不能延后到被动 effect:
  // 面板节点一旦可见/可查询,键盘就必须已经归它。否则测试或快速输入能在
  // `useEffect` 下一帧执行前把按键送给旧编辑器,形成"面板弹出但键盘无效"。
  useLayoutEffect(() => {
    if (!open) return
    returnToRef.current = document.activeElement
    activatedRef.current = false
    setSelected(0)
    containerRef.current?.focus()
    return () => {
      // 激活(选中并前往某处)时,落点由调用方显式指定 —— 通用归还会把它覆盖掉。
      //
      // **候选面板此前"碰巧是对的"**:归还目标是触发处,而触发处恰好是编辑器。
      // 换一个触发来源(比如从搜索框弹出候选)就会把焦点还给一个已经消失的元素,
      // 而且**同样不会有断言发现**。所以这里把"落点"从巧合改成显式。
      if (activatedRef.current) return

      // **只有"焦点因浮层消失而无处可去"时,才谈得上归还。**
      //
      // 判据用的是 `activeElement` 是否已掉回 body:浮层被卸载时,原本持有焦点的
      // 那个内部元素也跟着消失,浏览器会把焦点退回 body —— 那正是该接住它的时刻。
      // 反过来,若用户早已把焦点移去别处(点了目录树、Tab 去了别的面板),
      // `activeElement` 会是一个真实元素,这时再拉回触发处就不是归还,是**抢**。
      //
      // 不能用"容器是否还包含 activeElement"来判:cleanup 跑到这儿时容器往往
      // 已经脱离文档,`contains` 恒为 false,于是**一次都不会归还**(实测踩过)。
      // 归还的两种正当情形:
      //   ① 焦点已因浮层消失而无处可去(掉回 body);
      //   ② **关闭前焦点就在浮层里** —— 那是持有者自己在交棒,不是别人占着。
      //
      // **MUST NOT 因为"焦点当前另有归属"就跳过归还** —— 那个"归属"往往正是浮层自己。
      // (同一半判据缺失已在大纲激活处出现过一次;这里是第二个现场。)
      // 卸载时只兜"焦点已无处可去"这一种(掉回 body)。
      // **不再用"关闭前焦点在浮层内"放宽** —— 那会在别人已接管焦点后仍抢回来。
      // 用户主动关闭的那条路径由 `close()` 在关闭时刻处理,不依赖这里。
      const ae = document.activeElement
      if (ae && ae !== document.body) return
      const back = returnToRef.current
      // 触发处可能已经不在文档里了(比如换了文件、那一行被卸载)——
      // 那就什么也不做,总好过把焦点扔到一个已消失的节点上。
      if (back instanceof HTMLElement && document.contains(back)) back.focus()
    }
  }, [open])

  // 结果是流式追加的(引用扫描边扫边出),选中项要跟着夹紧,不能越界
  useEffect(() => {
    if (count > 0 && selected >= count) setSelected(count - 1)
  }, [count, selected])

  // 选中项必须可见 —— 否则"选中了"对用户是不可见的,等于没选
  useEffect(() => {
    if (!open) return
    document.getElementById(`${idPrefix}-${selected}`)?.scrollIntoView({ block: 'nearest' })
  }, [selected, open, idPrefix])

  const move = (delta: number) => {
    if (count === 0) return
    setSelected(Math.min(count - 1, Math.max(0, selected + delta)))
  }

  /**
   * 关闭浮层,并**在关闭那一刻就地归还焦点**。
   *
   * 为什么不在卸载时归还:卸载时容器往往已脱离文档,判不出"焦点原本在不在里面";
   * 而一旦为此放宽判据,它就会在**别的元素已经接管焦点之后**仍然抢回去
   * —— 实测代价:候选面板刚拿到焦点,就被一个正在卸载的面板把焦点拉回编辑器。
   *
   * 关闭时刻没有这两个问题:容器还在、焦点归属是确定的。
   *
   * **不看"此刻 activeElement 是否还在容器内"** —— `close()` 只可能被
   * Esc / ✕ / 点背景这三条"用户主动关闭"的路径调用(激活走的是 `activate()`,
   * 从不调这里),能走到这儿本身就代表交接已经发起,不需要再用当前归属确认一遍。
   * 真机踩过这个判据的坑:点击结果行跳转后,面板容器仍持有焦点,
   * 但用户随后点击右上角「✕」按钮关闭 —— 原生 `<button>` 在 mousedown
   * 时会先把焦点抢到它自己身上(它在 `.ref-header` 里,是容器的兄弟节点,
   * 不被 `contains` 判进去),`inside` 因此判成 false,归还被跳过;
   * 紧接着 `onClose()` 卸载整个面板(连同那颗按钮),浏览器就把焦点摔到了 body。
   */
  const close = () => {
    const back = returnToRef.current
    onClose()
    if (back instanceof HTMLElement && document.contains(back)) back.focus()
  }

  const activate = (index: number) => {
    // 只有"激活即关闭"的浮层才标记;否则这一次激活与将来某次关闭无关
    if (closesOnActivate) activatedRef.current = true
    onActivate(index)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); move(1); return
      case 'ArrowUp': e.preventDefault(); move(-1); return
      case 'Home': e.preventDefault(); setSelected(0); return
      case 'End': e.preventDefault(); if (count > 0) setSelected(count - 1); return
      case 'Enter':
        e.preventDefault()
        if (count > 0) activate(selected)
        return
      case 'Escape':
        e.preventDefault()
        close()
        return
    }
  }

  return {
    containerRef,
    selected,
    setSelected,
    onKeyDown,
    activeId: `${idPrefix}-${selected}`,
    activate,
    close,
  }
}

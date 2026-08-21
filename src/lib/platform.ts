// 平台判定(design.md D7 / 任务 12.5)。
//
// **保守假定口径(产品裁定 2026-08-17)**:当前只有 macOS 真机可核验快捷键。
// Windows/Linux 的 `Ctrl+Shift+O`(Chrome 书签管理器)与 `Alt+←/→`(浏览器前进后退)
// 一律**假定被浏览器抢占**:该平台不绑定、也不在 UI 上提示任何未经真机核验的键位 ——
// 提示一个按了没反应的键位比不提示更糟。这些平台的能力全部由界面入口保证。
//
// 判定基于 userAgent(而非已废弃的 navigator.platform),以便 E2E 用 UA 覆盖来断言
// "非 macOS 下不出现未核验键位提示"。

export function isMac(): boolean {
  return /Mac OS X|Macintosh/i.test(navigator.userAgent)
}

/**
 * 该平台是否绑定并提示补充键位。
 *
 * spec 分两档:
 * - **已知被浏览器占用**(Win/Linux 的 `Ctrl+Shift+O`、`Alt+←/→`):MUST NOT 绑定、MUST NOT 提示。
 * - **尚未真机核验但无已知冲突**(macOS 的 `⌘⇧O`/`⌘⇧F`/`⌥←⌥→`):MAY 绑定并提示,
 *   前提是每项能力都另有界面入口(本项目满足:模式切换按钮、导航按钮、右键菜单)。
 *
 * ⚠️ macOS 这一档是**待核验态**:任务 12.1–12.4 真机核验若发现某个键位被浏览器或系统抢占,
 * 该键位 MUST 解绑、其界面提示 MUST 一并撤除。
 */
export function verifiedShortcuts(): boolean {
  return isMac()
}

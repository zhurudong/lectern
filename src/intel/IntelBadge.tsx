import { mode } from '../state'
import { identifyByName, intelLevelByName, isApproximateHighlight, languageLabel } from '../lib/filetypes'
import { indexState, indexedFiles } from './indexStore'

// 预览区能力标识(code-intelligence spec「代码理解的支持范围与能力明示」):
// 语言名 + "可跳转 / 仅高亮" 徽标 + 索引状态。
// spec 明确要求 MUST NOT 让用户通过"点了没反应"来推断能力边界,所以这一条始终可见。

function indexStatusText(): { text: string; cls: string } | null {
  switch (indexState.value) {
    case 'building':
      return { text: `索引构建中 ${indexedFiles.value}`, cls: 'building' }
    case 'done':
      return { text: '索引已完成', cls: 'done' }
    case 'partial':
      return { text: '索引仅部分完成', cls: 'partial' }
    case 'unavailable':
      return { text: '符号索引不可用', cls: 'unavailable' }
    default:
      return null
  }
}

export function IntelBadge({ fileName }: { fileName: string }) {
  const level = intelLevelByName(fileName)
  const langId = identifyByName(fileName)?.language
  const status = mode.value === 'project' ? indexStatusText() : null

  const capability =
    level === 'full'
      ? { text: '可跳转', cls: 'full', title: '该语言支持大纲、跳转到定义与查找引用(基于名称与语法树的启发式匹配,不做类型推断)' }
      : level === 'outline-only'
        ? {
            text: '仅大纲', cls: 'outline',
            title: langId === 'sql'
              ? 'SQL 提供常见对象定义与顶层语句大纲,可定位到文件内对应行;不支持定义跳转、查找引用与全局符号搜索'
              : 'Markdown 仅提供标题大纲,不支持定义跳转、查找引用与全局符号搜索',
          }
        : isApproximateHighlight(langId)
          ? {
              // 第三档:高亮本身就是近似的,必须说清楚,不能让用户以为是专用高亮
              text: '近似高亮',
              cls: 'approx',
              title:
                '单文件组件按 HTML 超集近似高亮:<script> / <style> 块正确,模板指令(v-if / {#if} 等)不保证准确;不参与代码理解',
            }
          : { text: '仅高亮', cls: 'none', title: '该语言不参与代码理解,仅提供语法高亮与预览' }

  return (
    <span class="intel-badge">
      <span class="intel-lang">{languageLabel(langId)}</span>
      <span class={`intel-cap intel-cap-${capability.cls}`} title={capability.title}>
        {capability.text}
      </span>
      {status && <span class={`intel-index intel-index-${status.cls}`}>{status.text}</span>}
    </span>
  )
}

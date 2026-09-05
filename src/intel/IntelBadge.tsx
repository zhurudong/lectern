import { t } from '../i18n'
import { mode } from '../state'
import { identifyByName, intelLevelByName, isApproximateHighlight } from '../lib/filetypes'
import { langLabel } from './kindLabel'
import { indexState, indexedFiles } from './indexStore'

// 预览区能力标识(code-intelligence spec「代码理解的支持范围与能力明示」):
// 语言名 + "可跳转 / 仅高亮" 徽标 + 索引状态。
// spec 明确要求 MUST NOT 让用户通过"点了没反应"来推断能力边界,所以这一条始终可见。

function indexStatusText(): { text: string; cls: string } | null {
  switch (indexState.value) {
    case 'building':
      return { text: t('intel.idxBuilding', { n: indexedFiles.value }), cls: 'building' }
    case 'done':
      return { text: t('intel.idxDone'), cls: 'done' }
    case 'partial':
      return { text: t('intel.idxPartial'), cls: 'partial' }
    case 'unavailable':
      return { text: t('index.unavailable'), cls: 'unavailable' }
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
      ? { text: t('intel.capFull'), cls: 'full', title: t('intel.capFullTitle') }
      : level === 'outline-only'
        ? { text: t('intel.capOutline'), cls: 'outline', title: t('intel.capOutlineTitle') }
        : isApproximateHighlight(langId)
          ? {
              // 第三档:高亮本身就是近似的,必须说清楚,不能让用户以为是专用高亮
              text: t('intel.capApprox'),
              cls: 'approx',
              title: t('intel.capApproxTitle'),
            }
          : { text: t('intel.capNone'), cls: 'none', title: t('intel.capNoneTitle') }

  return (
    <span class="intel-badge">
      <span class="intel-lang">{langLabel(langId)}</span>
      <span class={`intel-cap intel-cap-${capability.cls}`} title={capability.title}>
        {capability.text}
      </span>
      {status && <span class={`intel-index intel-index-${status.cls}`}>{status.text}</span>}
    </span>
  )
}

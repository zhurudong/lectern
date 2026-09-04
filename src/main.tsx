import { render } from 'preact'
import { App } from './app'
import { caretLine, enterProject, enterSingleFile, rootHandle, setProjectView, viewportLine } from './state'
import { lastNavKey } from './intel/navStack'
import { __setSymbolCap, __simulateIndexFailure } from './intel/indexStore'
import { __setIndexPaused, __setExtractPaused } from './intel/pool'
import {
  compareTarget,
  compareStats,
  __setCompareOverride,
  openComparePicker,
  chooseCompareTarget,
  exitCompare,
} from './preview/compareStore'
import './styles.css'

render(<App />, document.getElementById('app')!)

// 调试/自动化验证入口:允许用任意目录句柄(如 OPFS)直接进入项目模式,
// 绕过原生文件选择对话框做端到端走查(scripts/e2e.mjs)。
// __CV_TEST_HOOK__ 是构建期常量(vite.config.ts define),仅 --mode development 为真;
// 正式构建中该分支为死代码被移除,产物不携带钩子(最小暴露面)。
if (__CV_TEST_HOOK__) {
  ;(window as unknown as Record<string, unknown>).__cv = {
    enterProject,
    enterSingleFile,
    setProjectView,
    rootHandle,
    lastNavKey,
    // caret 行:E2E 用它精确判断"落在第几行"。
    // **不能靠 DOM getSelection** —— CM6 的选区只在编辑器持有焦点时反映到 DOM,
    // 而大纲激活等入口的焦点有意留在别处,那时读 DOM 会得到 null。
    caretLine,
    viewportLine, // 3.0c 的前提断言要证明"caret 行 ≠ 视口顶行",两个都得读得到
    setSymbolCap: __setSymbolCap,
    simulateIndexFailure: __simulateIndexFailure,
    setIndexPaused: __setIndexPaused,
    setExtractPaused: __setExtractPaused,
    // 文件对比(C1)的 E2E 入口:
    //  - compareTarget / compareStats:读对比态与差异统计(读不到 MergeView 私有块结构,故走这里)
    //  - setCompareOverride:注入 4.4 / 7.4 / 8.4 的"红过一次"证据(强开控件 / 跳过焦点归还 / 退回默认 scanLimit)
    //  - chooseCompareTarget:直接进对比态(task 6.3 要求截断断言走"直接进对比"而非先普通预览)
    compareTarget,
    compareStats,
    setCompareOverride: __setCompareOverride,
    openComparePicker,
    chooseCompareTarget,
    exitCompare,
  }
  const gitParams = new URLSearchParams(location.search)
  const requestedGitFixture = gitParams.get('git-fixture')
  if (gitParams.get('git-visual-demo') === '1' || requestedGitFixture) {
    void import('./git/devFixture').then(async ({ createGitVisualFixture, fingerprintGitVisualFixture }) => {
      const fixture = await createGitVisualFixture((requestedGitFixture ?? 'normal') as Parameters<typeof createGitVisualFixture>[0])
      const initial = await fingerprintGitVisualFixture(fixture.root)
      document.documentElement.dataset.gitFixtureVariant = fixture.variant
      if (fixture.ambiguousPrefix) document.documentElement.dataset.gitAmbiguousPrefix = fixture.ambiguousPrefix
      document.documentElement.dataset.gitFixtureInitialHash = initial
      document.documentElement.dataset.gitFixtureCurrentHash = initial
      window.setInterval(() => {
        void fingerprintGitVisualFixture(fixture.root).then((hash) => {
          document.documentElement.dataset.gitFixtureCurrentHash = hash
        })
      }, 750)
      enterProject(fixture.root)
      setProjectView('changes')
    })
  }
}

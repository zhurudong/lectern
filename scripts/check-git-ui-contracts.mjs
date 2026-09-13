import { readFile } from 'node:fs/promises'
import { Chunk } from '@codemirror/merge'
import { Text } from '@codemirror/state'
import { PROJECT } from './paths.mjs'
import { join } from 'node:path'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function pass(name, detail = '') {
  console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`)
}

const diffSource = await readFile(join(PROJECT, 'src/git/UnifiedDiff.tsx'), 'utf8')
const pickerSource = await readFile(join(PROJECT, 'src/git/RefPicker.tsx'), 'utf8')
const comparisonSource = await readFile(join(PROJECT, 'src/git/GitComparison.tsx'), 'utf8')
const appSource = await readFile(join(PROJECT, 'src/app.tsx'), 'utf8')
const stylesSource = await readFile(join(PROJECT, 'src/styles.css'), 'utf8')
const fixtureSource = await readFile(join(PROJECT, 'src/git/devFixture.ts'), 'utf8')
const workerSource = await readFile(join(PROJECT, 'src/git/gitWorker.ts'), 'utf8')
// 0.3.4 起 UI 文案迁入 i18n 表(src/i18n/messages.ts);面向用户的措辞契约改为
// "组件引用了对应的键 + 键在 zh 表里承载既定措辞",而不是断言组件源码里的字面串。
const messagesSource = await readFile(join(PROJECT, 'src/i18n/messages.ts'), 'utf8')

function assertNoMergeControls(source) {
  assert(/mergeControls:\s*false/.test(source), 'Unified diff must explicitly disable merge controls')
  assert(!/mergeControls:\s*true/.test(source), 'A merge control was enabled')
}

assertNoMergeControls(diffSource)
pass('unified diff explicitly disables merge controls')

let mergeNegativeFailed = false
try {
  assertNoMergeControls(diffSource.replace('mergeControls: false', 'mergeControls: true'))
} catch {
  mergeNegativeFailed = true
}
assert(mergeNegativeFailed, 'merge-control negative control did not fail')
pass('negative control fails when merge controls are temporarily enabled, then production source remains restored')

assert(/EditorState\.readOnly\.of\(true\)/.test(diffSource), 'Unified diff is not state-level read-only')
assert(/diffConfig:\s*\{\s*timeout:\s*\d+\s*\}/.test(diffSource), 'Unified diff needs a bounded timeout')
assert(!/scanLimit:\s*500/.test(diffSource), 'Unified diff still uses CodeMirror default scanLimit')
pass('read-only state and timeout-based diff fidelity are explicit')

const base = Array.from({ length: 5000 }, (_, index) => `line ${index} ${'x'.repeat(20)}`)
const target = [...base]
for (let index = 700; index < 4300; index += 311) target[index] = `line ${index} ${'y'.repeat(20)}`
const defaultChunks = Chunk.build(Text.of(base), Text.of(target), { scanLimit: 500 })
const boundedChunks = Chunk.build(Text.of(base), Text.of(target), { timeout: 900 })
assert(boundedChunks.length === 12, `bounded sparse fixture expected 12 chunks, got ${boundedChunks.length}`)
let fidelityNegativeFailed = false
try {
  assert(defaultChunks.length === boundedChunks.length, 'default scanLimit merged sparse changes')
} catch {
  fidelityNegativeFailed = true
}
assert(fidelityNegativeFailed, 'scanLimit negative control did not fail')
pass('>32 KB sparse-change negative control fails with scanLimit 500 and passes with bounded timeout', `${defaultChunks.length} → ${boundedChunks.length} chunks`)

assert(
  /refpick\.localSnapshot/.test(pickerSource) && /['"]refpick\.localSnapshot['"]:\s*'本地快照'/.test(messagesSource),
  'Remote-tracking refs lack local-snapshot wording',
)
assert(
  /refpick\.enterSha/.test(pickerSource) && /['"]refpick\.enterSha['"]:\s*'输入 Commit SHA'/.test(messagesSource),
  'Commit SHA entry is missing',
)
assert(/disabled=\{side === 'base'\}/.test(pickerSource), 'Worktree is not target-only in the picker')
assert(/swapDisabled = target\.kind === 'worktree'/.test(comparisonSource), 'Worktree swap guard is missing')
pass('five-source picker contracts and worktree target-only boundary are present')

const gitUiSource = `${diffSource}\n${pickerSource}\n${comparisonSource}`
assert(!/\bAI\b|解释当前改动|智能解读|ai-panel/i.test(gitUiSource), 'Git comparison contains an AI action or placeholder')
pass('Git comparison ships no AI action or dead AI placeholder')

for (const variant of [
  'non-repo',
  'external-gitdir',
  'sha256',
  'missing-object',
  'corrupt-object',
  'no-merge-base',
  'multiple-merge-bases',
  'ambiguous-sha',
  'binary',
  'large-file',
  'worktree',
]) {
  assert(fixtureSource.includes(`'${variant}'`), `Development E2E fixture is missing ${variant}`)
}
assert(/debugDelayMs/.test(workerSource), 'Slow-worker E2E hook is missing from the worker')
assert(/__CV_TEST_HOOK__\s*&&\s*request\.request\.debugDelayMs/.test(workerSource), 'Slow-worker hook is not development-gated')
assert(/git-slow-initial/.test(comparisonSource), 'Git UI does not expose the deterministic stale-generation fixture')
pass('hostile repository, worktree and stale-generation E2E fixtures remain available')

assert(/sidebarWidth=\{sidebarWidth\}/.test(appSource), 'Git comparison does not receive the shared project sidebar width')
assert(/onSidebarResizeStart=\{onResizeStart\}/.test(appSource), 'Git comparison does not receive the shared project resize handler')
assert(/--git-sidebar-width/.test(comparisonSource), 'Git comparison does not expose the shared width to its layout')
assert(/class="resizer git-change-resizer"/.test(comparisonSource), 'Git change navigation has no drag resizer')
assert(/grid-template-columns:\s*min\(var\(--git-sidebar-width, 280px\), 60%\) 5px/.test(stylesSource), 'Git change navigation does not use the shared sidebar width')
assert(!/grid-template-columns:\s*(?:220|205|182)px/.test(stylesSource), 'Git layout still contains a second hard-coded sidebar width')
pass('file and change views share one persisted, resizable sidebar geometry')

assert(/gitSessionRoot === root/.test(appSource), 'Git session is not retained for the current project root')
assert(/hidden=\{activeProjectView !== 'changes'\}/.test(appSource), 'Git view is unmounted instead of hidden during a view switch')
assert(/class="preview" hidden=\{activeProjectView === 'changes'\}/.test(appSource), 'File preview is unmounted instead of hidden during a view switch')
assert(!/stopGitWorker/.test(appSource), 'App still stops the Git worker when project-view visibility changes')
assert(/useEffect\(\(\) => \(\) => client\.dispose\(\), \[client\]\)/.test(comparisonSource), 'Git worker is not disposed with its project-bound component')
assert(/key=\{root\}/.test(appSource), 'Git component is not reset at a project-root boundary')
pass('project view toggles preserve one Git component and project boundaries dispose it')

assert(/const \[refreshSeq, setRefreshSeq\] = useState\(0\)/.test(comparisonSource), 'Explicit compare generation is missing')
assert(/\[client, root, base, target, compareMode, refreshSeq\]/.test(comparisonSource), 'Explicit compare generation does not trigger comparison')
assert(/git\.refresh/.test(comparisonSource) && /['"]git\.refresh['"]:\s*'重新比较'/.test(messagesSource), 'Explicit recompare action is missing from the localized UI')
pass('explicit recompare retains endpoints and mode while intentionally rebuilding results')
// AI is a separate, opt-in build, never a Git comparison action.
function assertAiBoundary(source) {
  assert(/const AiTerminalEntry = __AI_TERMINAL__/.test(source), 'AI import must be build-gated')
  assert(/__AI_TERMINAL__ && AiTerminalEntry &&/.test(source), 'AI entry must be build-gated')
}
assertAiBoundary(appSource)
let aiNegativeFailed = false
try { assertAiBoundary(appSource.replaceAll('__AI_TERMINAL__', 'true')) }
catch { aiNegativeFailed = true }
assert(aiNegativeFailed, 'AI build-gate negative control did not fail')
pass('AI terminal import and entry are opt-in, with a negative control')

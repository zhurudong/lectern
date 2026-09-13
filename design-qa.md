# Git comparison design QA

## Comparison target

- source visual reference: `exec-4ff0c574-f25a-4878-ad09-ce4f5e906d11.png` (local evidence, not committed)
- source interaction reference: `lectern-branch-interaction-2.png` (local evidence, not committed)
- implementation URL: `http://127.0.0.1:4173/viewer.html?git-visual-demo=1`
- implementation screenshots:
  - `/private/tmp/lectern-git-comparison-light.png`
  - `/private/tmp/lectern-git-ref-picker-light.png`
  - `/private/tmp/lectern-git-comparison-dark.png`
  - `/private/tmp/lectern-git-ref-picker-dark.png`
  - `/private/tmp/lectern-git-sha-error-light.png`
- source pixels: 1487 × 1058; its upper 1487 × ~808 region is the primary page and the bottom strip contains two separate state examples
- implementation pixels / CSS viewport: 1487 × 850 at density 1
- normalization: compared the full-width primary page region at 1:1 horizontal scale; the source-only bottom specimen strip was treated as state documentation, not persistent runtime UI
- state: light theme, review mode, `main` → current worktree, modified text file selected, target ref picker open

## Full-view comparison evidence

The source and implementation were opened together in one comparison input after each capture. Both use the selected three-track composition: 220 px grouped M/A/D navigation, fluid unified diff, and 250 px factual inspector. The global top bar, 56 px comparison command row, warm Lectern tokens, divider cadence, selected-row treatment, and anchored picker hierarchy align with the selected direction. The implementation intentionally uses real fixture paths and OIDs rather than reproducing the mock's sample values.

## Focused-region comparison evidence

The command group and anchored ref picker were readable in the full-size combined input and received a focused pass. The final implementation shows `基准 [main · SHA] ⇄ 目标 [当前工作区 · HEAD SHA] [审查改动]`; the target picker is directly anchored below the target control and groups current worktree, local branches, remote-tracking branches with textual `本地快照` badges, tags, and inline Commit SHA input. No separate image assets exist in the source; standard control glyphs and the existing Lectern wordmark remain consistent with the product shell.

## Findings

No actionable P0/P1/P2 difference remains.

- [P3] Hunk navigation occupies a compact 34 px row below the file header instead of sharing the exact source header line.
  - Location: `.git-hunk-toolbar` / `UnifiedDiff.tsx`.
  - Evidence: the source places previous/next controls in the file header; the implementation keeps hunk count, persistent approximate warning, and both controls together immediately below it.
  - Impact: one additional divider row, without changing task hierarchy or above-the-fold reachability.
  - Follow-up: merge the toolbar into `git-file-header` only if later user testing values vertical density over keeping the approximate warning persistent.

## Required fidelity surfaces

- Fonts and typography: existing Lectern `--sans` and system monospace stacks are reused; sizes, weights, truncation, code line height and small-label hierarchy match the reader shell and remain legible in both themes.
- Spacing and layout rhythm: primary tracks, 56/44/34 px header rhythm, borders, picker width/elevation and row density follow the selected visual. At 900 px and 760 px, body/workspace scroll widths equal client widths; the facts rail hides at the first breakpoint and the command row wraps at the second.
- Colors and tokens: all surfaces use existing warm light/dark Lectern tokens. Added, modified and deleted states retain letters as non-color signals. Dark diff backgrounds, focus rings, disabled swap and error/approximate notices were visually checked.
- Image quality and asset fidelity: the target contains no product imagery, illustration, avatar or non-standard logo asset. Screenshots were captured losslessly; no raster placeholder or generated asset is used by the implementation.
- Copy and content: `本地快照`, `当前工作区`, `审查改动`, `直接比较`, `近似结果，可能遗漏细节`, read-only disclosure and SHA errors describe actual local behavior. No AI action or placeholder is present.
- Accessibility and states: selectors expose expanded/current state, mode is a named native combobox, files expose current state, live loading/error text is present, Escape restores picker focus, focus rings are visible, and worktree swap is disabled with a reason.

## Comparison history

### Iteration 1 — blocked

- [P2] Worktree files were routed to metadata because `regular-observed` was treated as a different object type from Git `regular`.
- [P2] Target picker was shifted left of its trigger, worktree target omitted the HEAD short SHA, and mode appeared as a two-button segmented control rather than the selected compact dropdown.
- fixes made:
  - normalized `regular-observed` to regular content for text diff routing;
  - anchored the target picker at `left: 0`;
  - added `HEAD <short SHA>` to the worktree selector;
  - changed comparison mode to a labeled native select.

### Iteration 2 — passed

- post-fix evidence: `/private/tmp/lectern-git-ref-picker-light.png`
- browser console errors: none
- primary interactions tested: open/close picker and focus restoration, ref filtering groups, invalid SHA preserving current results, branch/tag selection, review/direct mode, immutable endpoint swap, worktree swap guard, hunk navigation, text input/paste immutability, dark theme, 900 px and 760 px responsive layouts
- remaining differences are P3 or content-fixture differences only.

## Implementation checklist

- [x] Match selected three-column structure and Lectern visual tokens.
- [x] Match the separately selected anchored picker interaction.
- [x] Render real Git data and all five local source types.
- [x] Verify light, dark, error, focus and narrow-window states.
- [x] Remove every AI action and placeholder from this change.

## Follow-up polish

- Consider folding hunk controls into the file header after observing real repositories with approximate-diff warnings.

final result: passed

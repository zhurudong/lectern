## Context

See [proposal.md](./proposal.md) for motivation. Navigation spans the search box, code-intelligence overlays, the navigation stack, shared application state, and CodeMirror. The target view may remount asynchronously when a navigation crosses files. Focus and caret are separate browser resources: one can be correct while the other is stale.

Temporary result panels are always mounted through Preact. Their DOM can become observable before a passive effect runs, so focus acquisition cannot depend on `useEffect` if the panel must be keyboard-ready as soon as it appears.

## Goals / Non-Goals

**Goals:**

- Route every code-location navigation through one target payload carrying line and optional word/column caret hints.
- Preserve the caller-specific focus destination while placing the editor caret at the target.
- Make temporary panels own focus before paint and return it at the explicit close boundary.
- Verify the complete user path and separately prove its fixture and preconditions.

**Non-Goals:**

- Compiler-grade symbol resolution or type analysis.
- A global rule that every navigation must focus the editor; result lists and the file tree intentionally retain focus in their own workflows.
- Hiding known intermittent failures by weakening assertions.

## Decisions

### One navigation target payload

`targetLine` carries the line plus an optional symbol word or column. CodeMirror applies selection, scroll, and highlight in one dispatch. A word/column hint is preferred over line start so a follow-up reference lookup operates on the intended symbol.

Alternative rejected: a second caret-setting channel. Two channels would race and could leave scroll, highlight, and selection describing different targets.

### Record caret and viewport separately

Navigation history records the caret line when known and falls back to the viewport top only when no caret exists. Selection changes caused by editor blur are ignored unless the transaction is an explicit navigation.

Alternative rejected: always recording the viewport top. It restores what happened to be visible rather than where the reader was operating.

### Explicit focus handoff with ownership guard

Navigation workflows explicitly name their destination. `focusEditorWhenReady` waits for an asynchronously remounted editor, but stops if another concrete control has acquired focus. The initiating control may be supplied as the handoff owner so an intentional transfer is not mistaken for stealing.

Alternative rejected: always restore to the trigger. That works only when trigger and intended destination happen to be the same element.

### Acquire overlay focus in the layout phase

Opening a temporary selection panel focuses its container in `useLayoutEffect`, after DOM mutation but before paint and user input. Passive `useEffect` is too late: the panel can already be visible and observable while keystrokes still go to the previous control.

Alternative rejected: make tests wait longer while retaining passive focus. Waiting would conceal the same user-visible race rather than remove it.

### Return focus at explicit close time

`Escape`, close-button, and backdrop paths share `close()`. It decides ownership while the panel is still attached, closes it, and returns focus only when the panel itself held focus. Unmount cleanup is only a fallback for focus already dropped to `body`. `closesOnActivate` describes whether activation itself closes the panel; it does not record panel history.

Alternative rejected: infer ownership only during unmount. By then the container may be detached, so containment checks are no longer meaningful.

## Risks / Trade-offs

- [A delayed editor mount can outlive the initiating interaction] → Handoff is bounded and tokenized; a newer handoff cancels the older one.
- [Focus can be stolen from another panel] → Every frame checks whether another concrete element has taken ownership.
- [A test can pass because defaults match expected positions] → Fixtures keep targets away from file start and assert their own shape before navigation assertions.
- [Intermittent failures can be misattributed to the current change] → Compare repeated runs against a frozen baseline; do not use a single probabilistic red or green as causal evidence.

## Migration Plan

1. Land the shared navigation payload and overlay focus semantics without changing external data.
2. Rebuild the extension and run invariant, type, OpenSpec, and full-browser gates.
3. Freeze the final production bundle, record its checksum, and run behavior-only verification through the real folder picker.
4. Roll back by reverting this change as one unit; no persisted-data migration is required.

# Git comparison manual verification

Use this checklist before a release that includes Git comparison. It exercises
the repository shapes that OPFS automation cannot faithfully reproduce.

## Automated evidence recorded on 2026-09-02

The development-only OPFS suite uses real SHA-1 loose objects and the same
probe/ref/object/graph/worktree/worker/UI path as production. In the in-app
browser it covered:

- non-repository, external gitdir, SHA-256, missing and corrupt object;
- invalid and generated ambiguous Commit SHA without endpoint mutation;
- no common history and multiple best merge bases with distinct recovery text;
- binary and over-5-MB metadata-only rendering;
- tracked modification, untracked addition, tracked deletion and ignored-file
  exclusion, including the visible FSA permission/symlink caveat;
- a 2,000 ms obsolete worker generation superseded in 651 ms, with no stale
  overwrite after the old delay elapsed.

This evidence does not close the real-system-directory gate below. The current
automation environment cannot drive `showDirectoryPicker`: it emits no
injectable filechooser event, and the native picker is outside the permitted
Codex UI-control surface.

## Standard system clone

1. Open a normal SHA-1, non-bare clone at its repository root.
2. Switch from **文件** to **变更**.
3. Confirm local branches, tags and remote-tracking refs load; every remote ref
   says **本地快照**.
4. Compare a branch to the current worktree in both **审查改动** and
   **直接比较** modes.
5. Open modified, added, deleted and binary files. Confirm text uses a read-only
   unified diff and binary files use the metadata view.
6. Hash the worktree and `.git` before and after; the hashes must be identical.

The real File System Access path must read the ordinary `.git` directory
without a new browser permission. Any failure here blocks release even if the
OPFS fixture passes.

## Linked worktree

1. Open the linked worktree root.
2. Its `.git` is a file whose `gitdir:` commonly points outside that selected
   root. Lectern must show **Git 对象库位于已授权目录之外**; it must not call the
   result “not a Git repository” or request a broader directory silently.
3. If a controlled fixture keeps the linked gitdir inside the authorized root,
   confirm it opens and compares normally.

## Submodule

1. Open a submodule working directory directly.
2. Confirm the same in-root vs authorization-external `gitdir:` rule above.
3. In a parent repository comparison, confirm a gitlink change renders factual
   old/new OIDs in the metadata view, never as a text file.

## Invariants

- Keep DevTools Network open for the entire flow: there must be no HTTP(S)
  request.
- No accept/reject/revert controls may appear in any diff.
- Typing, pasting, dragging and IME composition must not change diff content.
- Closing the ref picker with Escape returns focus to its opening selector.
- Returning to **文件** restores the previously selected file and reading
  position.

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

## Real FSA evidence recorded on 2026-09-04

Chrome on macOS opened controlled repositories through the native
`showDirectoryPicker` flow against the 0.3.3 release candidate:

- a normal SHA-1 repository exposed the current worktree, three local branches,
  one `origin/main` remote-tracking ref marked **本地快照**, one Tag and the
  Commit SHA input; review/direct comparison returned one modified, two added
  and one deleted path, with `binary.bin` routed to the metadata-only view;
- Escape closed the anchored ref picker and restored focus to its opening
  target selector; switching back to **文件** restored the previously selected
  `modified.txt` preview;
- a linked worktree and a directly opened submodule both reported
  **Git 对象库位于已授权目录之外**, rather than “not a Git repository” or a broader
  permission request;
- comparing the parent repository's `main` and `updated-submodule` commits
  rendered the gitlink as one modified metadata entry with old OID
  `f0ea50e5ec72` and new OID `2020206f36d7`, never as text;
- the complete fixture-tree SHA-256 was
  `7623719a9fb96aaa1dc5ecaa4e53d955bfda59030cd36296fc2425a81df3ea47`
  both before and after the browser flow. Both repositories remained clean.

The production build's automated invariant checker separately remained green
for zero network symbols, zero write symbols and empty extension permissions.

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

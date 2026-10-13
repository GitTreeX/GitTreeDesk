# 06 · Merge, Rebase & Conflicts

> Status: 🚧 Planned · Scope: v1 · Engineering: [`../spec.md`](../spec.md) §F4 (Merge/Rebase/…), AD-12

## Merge

- Entry: right-click a branch (branch picker, graph ref chips) → **"Merge into current branch"**.
- Options: `--no-ff` (merge commit), `--squash` (squashed changes staged, no commit), `--ff-only`.
- Result: a summary toast (fast-forward / merge commit created / conflicts); on conflicts the operation banner appears (below).

## Rebase

- **Rebase current onto…** — pick any ref; a dirty working tree is auto-stashed first (restored after).
- **Interactive rebase** — from the graph (right-click a commit → "Interactive rebase from here") or the branch picker:
  - A list editor shows the commits to be replayed with one row per commit. Row actions: **pick / reword / edit / squash / fixup / drop** (row buttons).
  - Reordering is done with move up/down in v1; drag-and-drop reordering is [Later].
  - During the rebase, the operation banner offers **Continue / Skip / Abort**; stopping on an `edit` row behaves like a pause — amend or run commands, then Continue.
- Both rebases run in the background with progress; the graph refreshes as commits are replayed.

## Cherry-pick & revert

- **Cherry-pick** — one commit or a range (`A..B`) from the graph or the commit details panel; option `--no-commit` (changes staged, stop before committing).
- **Revert** — same entries, same options; revert of a merge commit requires choosing the mainline (the dialog explains which parent is which).
- Conflicts follow the same banner flow.

## Reset

Right-click a commit → **Reset current branch to here**:

| Mode | What happens |
|---|---|
| **Soft** | Branch pointer moves; index and working tree untouched (changes stay staged). |
| **Mixed** | Branch pointer moves; index reset; changes remain in the working tree (unstaged). |
| **Hard** | Everything reset — **working-tree changes are lost**. Requires confirmation; the dialog names the commits that will be dropped, and a **backup ref is created first**. |

## Conflicts

Whenever an operation stops on conflicts (merge, rebase, cherry-pick, revert, stash apply):

1. An **operation banner** appears at the top of the repository section and in the graph: **Continue / Skip / Abort**, plus a live count of unresolved files.
2. The **Conflicts group** (page 03) lists the files. For each file:
   - **Ours / Theirs / Both** resolution actions,
   - **Open in editor** (shows conflict markers with syntax highlighting),
   - **Open in external merge tool** — configurable command in settings (e.g. Beyond Compare, WinMerge, KDiff3).
3. Resolved files are marked (a "Mark resolved" action, or automatically when staged).
4. **Continue is validated**: if unresolved files remain, a dialog lists them instead of letting Git fail mid-way.
5. **Abort** restores the pre-operation state exactly; **Skip** (rebase/cherry-pick) skips the current commit.

## Conflicts via merge tool inside the editor

The built-in editor shows standard conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`) with actions in the gutter: *Accept ours / Accept theirs / Accept both*. The full 3-way merge editor is [Later].

## Safety nets

- Before every destructive operation — reset `--hard`, rebase (incl. interactive), history rewrite, stash drop, branch delete, worktree force-remove — GitTreeDesk creates a **backup ref** under `refs/gitreedesk/backup/…` pointing at the state that is about to be replaced. Backup refs are invisible in normal branch/tag lists.
- After the operation, the toast offers **Undo** (restores the backup ref). Undo stays available later from the repository context menu → **"Restore from backup…"**, which lists recent backups with their operation, time, and target ref.
- The backup/undo history is also recorded in the repository's operation log (Output panel).

## Blocked operations

While an operation is in progress, GitTreeDesk blocks conflicting ones (e.g. starting a rebase during a merge) and explains why in a dialog that offers the legal next actions (continue / abort first).

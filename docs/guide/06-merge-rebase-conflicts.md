# 06 · Merge, Rebase & Conflicts

> Status: ✅ Implemented · Scope: v1 · Engineering: [`../spec.md`](../spec.md)

## Merge

- Entry: right-click a branch in the **branch picker** → **"Merge into current branch"**. From the graph, merge actions come from the branch/ref rows' own menus (page 09).
- Options: `--no-ff` (merge commit), `--squash` (squashed changes staged, no commit), `--ff-only`.
- Result: a summary toast (fast-forward / merge commit created / conflicts); on conflicts the operation banner appears (below).

## Rebase

- **Rebase current onto…** — pick any ref; a dirty working tree is auto-stashed first (restored after).
- **Interactive rebase** — from the graph (right-click a commit → "Interactive rebase from here") or the branch picker:
  - A list editor shows the commits to be replayed with one row per commit. Row actions: **pick / reword / edit / squash / fixup / drop** (row buttons).
  - Reorder by dragging a row's handle, or with its move up/down buttons — the buttons stay so the plan is keyboard-operable. A line marks where the dragged row lands.
  - During the rebase, the operation banner offers **Continue / Skip / Abort**; stopping on an `edit` row behaves like a pause — amend or run commands, then Continue.
- Both rebases run in the background without blocking the window; Git's output for the whole run lands in the Output panel and the graph refreshes when the rebase finishes or stops.

## Cherry-pick & revert

- **Cherry-pick** — from the graph or the commit details panel. One commit at a time, or **Ctrl/Cmd-click** several rows and pick the whole selection in one go; the dialog lists the commits in the order they run, oldest first. Option `--no-commit` (changes staged, stop before committing). Picking a range given as `A..B` from the UI is [Later].
- **Revert** — same entries, same options, single or as a selection; a batch is undone from the newest commit so an earlier change does not reappear. Revert of a merge commit requires choosing the mainline (the dialog explains which parent is which).
- Conflicts follow the same banner flow. In a batch, **Skip** drops the commit that stopped it and runs the ones still queued.

## Reset

Right-click a commit → **Reset current branch to here**:

| Mode | What happens |
|---|---|
| **Soft** | Branch pointer moves; index and working tree untouched (changes stay staged). |
| **Mixed** | Branch pointer moves; index reset; changes remain in the working tree (unstaged). |
| **Hard** | Everything reset — **working-tree changes are lost**. Requires confirmation; the dialog names the commits that will be dropped, and a **backup ref is created first**. |

## Conflicts

Whenever an operation stops on conflicts (merge, rebase, cherry-pick, revert):

1. An **operation banner** appears at the top of the repository section and in the graph: **Continue / Skip / Abort**, plus a live count of unresolved files.
2. The **Conflicts group** (page 03) lists the files. For each file:
   - **Ours / Theirs / Both** resolution actions,
   - **Open in editor** (shows conflict markers with syntax highlighting),
   - **Open in external merge tool** — configurable command in settings (e.g. Beyond Compare, WinMerge, KDiff3).
3. Resolved files are marked (a "Mark resolved" action, or automatically when staged).
4. **Continue is validated**: if unresolved files remain, a dialog lists them instead of letting Git fail mid-way.
5. **Abort** restores the pre-operation state exactly; **Skip** (rebase/cherry-pick) skips the current commit.

A conflicting **stash apply/pop** is the exception: it does not start an operation, so no banner appears. The stash entry is kept, the conflicted files are left in the working tree with their markers, and a notice tells you what happened (page 07).

## Conflicts via merge tool inside the editor

The built-in editor shows standard conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`) with actions in the gutter: *Accept ours / Accept theirs / Accept both*. The full 3-way merge editor is [Later].

## Safety nets

- Before every destructive operation — reset `--hard`, rebase (incl. interactive), history rewrite, stash drop, branch delete, worktree force-remove — GitTreeDesk creates a **backup ref** under `refs/gitreedesk/backup/…` pointing at the state that is about to be replaced. Backup refs are invisible in normal branch/tag lists.
- After the operation, the toast offers **Undo** (restores the backup ref). Undo stays available later from the repository context menu → **"Restore from backup…"**, which lists recent backups with their operation, time, and target ref.
- The backup/undo history is also recorded in the repository's operation log (Output panel).

## Blocked operations

While an operation is in progress, GitTreeDesk blocks conflicting ones (e.g. starting a rebase during a merge) and explains why in a dialog that offers the legal next actions (continue / abort first).

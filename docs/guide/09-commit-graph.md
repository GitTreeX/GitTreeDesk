# 09 · Commit Graph

> Status: 🚧 Planned · Scope: v1 · Engineering: [`../spec.md`](../spec.md) §F5

## Opening

- One graph **tab per repository**: open from the repo row's context menu, the command palette ("Open commit graph"), or the repo details panel. Up to ~5 graph tabs stay alive (LRU); reopening is instant.
- The graph covers all refs by default: local branches, remote branches, tags, and HEAD.

## What you see

- Commit rows with lanes, colored per line of development; ref chips (`HEAD`, branch names, `origin/…`, tags) on the commits they point to.
- Subject, author, relative date per row.
- **Incoming / outgoing markers** relative to the current branch's upstream — which commits are not yet pushed, which are not yet pulled.
- The current branch's tip is highlighted; clicking any row opens the **details panel** (right side): full message, author and committer with timestamps, and the changed files with per-file stats. Clicking a file opens that commit's diff for the file in the editor area.

## Loading behavior & scale

- The first page loads 1 000 commits; scrolling down streams older history in chunks of 2 000 — the graph never blocks on full history.
- For very large repositories a "huge repo mode" caps the loaded window (windowed queries + total count) and says so in the toolbar; [Later] a setting to raise the window.
- Performance target: smooth scrolling (60 fps) with 5 000+ loaded rows; first paint within ~1.5 s on a 10 k-commit repository.

## Filters

Toolbar filters (combinable): refs multi-select (branches/remotes/tags), author, path, date range, message text search, and **"only reachable from current branch"** (hides unrelated history). Filter state is per tab and remembered.

## Actions on a commit

Right-click any commit (or use the details panel):

| Action | Notes |
|---|---|
| Checkout commit | detached HEAD with "Create branch here" banner |
| Create branch here / Create tag here | picker dialogs |
| Cherry-pick / Revert | with the `--no-commit` option (page 06) |
| Reset current branch to here | soft / mixed / hard (page 06) |
| Rebase current onto this commit | |
| Interactive rebase from here | list editor (page 06) |
| **Edit commit…** | message / author / date rewrite with backup + undo (page 04) |
| Copy SHA / Copy ref name | |
| Select for compare | then right-click another commit → "Compare with selected" — a two-commit diff opens in the editor area |

## Keyboard

- `↑` / `↓` move through rows, `Enter` opens details, `Esc` closes the details panel.
- `Ctrl/Cmd+F` focuses the filter bar; typing filters messages live.

## Edge cases

- Detached HEAD: the graph shows the detached position as a chip at that commit; branch-only actions are hidden.
- Reflog entries (commits unreachable from any ref) are not shown in v1. [Later]
- After a history rewrite (amend / rebase / edit commit) the graph refreshes automatically. The pre-rewrite state stays recoverable through backup refs — they are **not** shown as ordinary refs; use "Restore from backup…" (page 06).

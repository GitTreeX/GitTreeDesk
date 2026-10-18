# 09 · Commit Graph

> Status: ✅ Implemented · Scope: v1 · Engineering: [`../spec.md`](../spec.md)

## Opening

- One graph **tab per repository** (titled `<repository> (Graph)`): open it from the **Graph button in the activity bar** (it acts on the active repository), the graph toolbar's repository picker, the **Source Control section header button** of that repository, the command palette ("Open commit graph"), the repo row's context menu, or any folder/file row in the Explorer whose path belongs to a repository. Up to ~5 graph tabs stay alive (LRU); reopening is instant.
- The toolbar's **repository picker** switches to another repository's graph with one click (type to filter, Enter picks the first match) and makes that repository the active one, so the status bar and Source Control follow along. Next to it a **…** button opens the repository action menu (the same list as the Repos view row menu, without the graph entry) so everyday actions stay reachable from the graph.
- The graph covers all refs by default: local branches, remote branches, tags, and HEAD.
- The **scope switch** at the left of the toolbar turns the same pane into the workspace-wide activity timeline (see *Workspace timeline* below).

## What you see

- Commit rows with lanes, colored per line of development; ref chips (`HEAD`, branch names, `origin/…`, tags) on the commits they point to.
- Subject, author, relative date per row; at `comfortable` row height a second, smaller line shows the commit body collapsed onto one line, so commits that carry an explanation stay readable in the list.
- **Incoming / outgoing markers** relative to the current branch's upstream — which commits are not yet pushed, which are not yet pulled.
- The current branch's tip is highlighted; clicking any row opens the **details panel** (right side): full message, author and committer with timestamps, and the changed files with per-file stats. Clicking a file opens that commit's diff for the file in the editor area.

## Loading behavior & scale

- The first page loads 1 000 commits; scrolling down streams older history in chunks of 2 000 — the graph never blocks on full history.
- In a repository with more history than the window, loading stops at the newest window of commits and the toolbar says so ("Huge repository — showing the newest 10 000 commits"); filters narrow the window to the part you care about. The window itself is a setting: Settings → Git → "Commit graph window" (`graph.windowSize`, 1 000 – 200 000 commits, 10 000 by default); raising it resumes streaming where it stopped.
- The **lane column sizes itself**: a handful of lanes gets the natural width, and a branching-heavy repository compresses the lane spacing instead of pushing the commit text off-screen (the commit text keeps its column).
- **Resizable**: drag the right edge of the lane column to set your own width; the width is remembered across sessions. Filters that reduce the lane count (e.g. "current branch only") free the space again.
- **Row height**: `compact` / `normal` / `comfortable`, switchable from the graph toolbar or Settings → Appearance ("Commit graph density"); `normal` is the default.
- **Line style**: `smooth` / `straight` for the lane connectors — a lane change either bends into a smooth S-curve or stays a straight polyline — switchable from the graph toolbar or Settings → Appearance ("Commit graph line style"); `smooth` is the default.
- Performance target: smooth scrolling (60 fps) with 5 000+ loaded rows, and the first page of a 10 000-commit repository painting within 1.5 s.

## Filters

Toolbar filters (combinable): refs multi-select (branches/remotes/tags), author, path, date range, message text search, and **"only reachable from current branch"** (hides unrelated history). Filter state is per tab and remembered.

## Workspace timeline (all checked repositories)

The graph toolbar starts with a **scope switch**: `Repository` shows one repository's lanes, `Workspace` folds the recent commits of **every checked repository** into one timeline. The choice is remembered across sessions, and the command palette ("Open Workspace Activity Timeline") takes you there from any repository.

- **Scope**: the same per-repository checkboxes that feed Source Control (page 01). The toolbar shows how many repositories are folded in; un-checking one in the Repos view drops its commits from the timeline.
- **Rows**: relative time, a repository chip, subject and author, grouped under a header per day. Only each repository's **HEAD** is walked, so the timeline answers "what has been happening in the repositories I follow" rather than every branch.
- **Window**: last 7 / 30 / 90 / 365 days (default 30), plus message and author filters and a **Reload** button; row height follows the same density setting as the graph.
- **Stated limits**: a repository with more commits than the window reads says so; a repository that cannot be read is named in a warning strip while the rest still show; with nothing checked the timeline points back at the Repos checkboxes; an empty window says that too.
- **Click a row** to open that repository's graph tab with the commit selected, scrolled into view and its details panel open — the tab is back in `Repository` scope.
- The timeline refreshes itself when a repository in scope moves its HEAD (commit, checkout, pull).

## Actions on a commit

Right-click any commit (or use the details panel):

| Action | Notes |
|---|---|
| Checkout commit | detached HEAD with "Create branch here" banner |
| Create branch here / Create tag here | picker dialogs |
| Cherry-pick / Revert | one commit or a multi-selected batch, with the `--no-commit` option (page 06) |
| Reset current branch to here | soft / mixed / hard (page 06) |
| Rebase current onto this commit | |
| Interactive rebase from here | list editor (page 06) |
| **Edit commit…** | message / author / date rewrite with backup + undo (page 04) |
| Copy SHA / Copy ref name | |
| Select for compare | then right-click another commit → "Compare with selected" — a two-commit diff opens in the editor area |

**Ctrl/Cmd-click** rows to select several commits; the menu then offers cherry-pick, revert and commit editing for the whole selection.

## Keyboard

- `↑` / `↓` move through rows, `Enter` opens details, `Esc` closes the details panel.
- `Ctrl/Cmd+F` focuses the filter bar; typing filters messages live.

## Edge cases

- Detached HEAD: the graph shows the detached position as a chip at that commit; branch-only actions are hidden.
- Reflog entries (commits unreachable from any ref) are not shown in v1. [Later]
- After a history rewrite (amend / rebase / edit commit) the graph refreshes automatically. The pre-rewrite state stays recoverable through backup refs — they are **not** shown as ordinary refs; use "Restore from backup…" (page 06).

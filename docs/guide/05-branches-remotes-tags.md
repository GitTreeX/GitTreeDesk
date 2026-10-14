# 05 · Branches, Remotes & Tags

> Status: ✅ Implemented · Scope: v1 · Engineering: [`../spec.md`](../spec.md)

## Branches

Branch commands live in the **branch picker** (status bar; also the repo row's context menu and the command palette).

| Action | Behavior |
|---|---|
| **Checkout** | Switching branches. A dirty working tree is guarded — GitTreeDesk offers **auto-stash first** rather than failing. Checking out a commit instead of a branch enters detached HEAD with a clear banner offering "Create branch here". |
| **Create** | From any ref (branch, tag, commit — picker with search). Optionally set upstream at creation. |
| **Rename** | Local branches only; renames the upstream tracking if present (with a hint that the remote branch itself is not renamed). |
| **Delete** | The current branch cannot be deleted. Deleting an unmerged branch warns and creates a backup ref first (undo available — page 06). |
| **Set upstream** | Whenever a branch has no upstream, push offers "publish & set upstream". |
| **Compare with current** | Opens the diff of the branch against the checked-out branch in the editor area. |
| **Copy branch name** | Context menu. |

The branch picker shows for each entry: name, ahead/behind vs upstream, last commit subject and relative date; typing filters (fuzzy).

## Remotes

Managed per repository (repo context menu → Remotes):

- **Add / remove / edit URL** per remote. Default remote for pushes is `origin`; settings can override.
- **Fetch** — single repo or batch:
  - options: **prune** (delete stale remote-tracking branches) and **follow tags**;
  - batch entry points: right-click in Repos view → "Fetch selected"; command palette → **"Fetch all repositories"**. Progress and failures are reported per repository (15 failures never hide 15 successes).
- **Pull** — strategy per repository, resolved from settings:
  - `ff-only` (default: safe; fails loudly when histories diverged),
  - `merge`,
  - `rebase`;
  - per-repo override via workspace settings (page 12). A dirty tree is auto-stashed first when necessary, and the stash is restored after.
- **Push** — branch picker, "publish & set upstream" for new branches. When remote history has diverged, plain force is **not** offered; **force-with-lease** appears behind a double confirmation that names the branch and remote. Pushing tags has its own action.

## Tags

- **List** — grouped local / remote; search; shows annotated vs lightweight and the target commit.
- **Create** — on any commit (graph, details panel, or branch picker): annotated (message) or lightweight; optional "push after creation".
- **Delete / push** — with the same per-remote safety as branches; deleting a pushed tag warns.
- **Checkout** — checks out the tag's commit (detached HEAD, with "Create branch here").

## Batch operations across repositories

- Multi-select repositories in the Repos view → **Fetch selected / Pull selected**, with a result summary (per repo: updated / up-to-date / failed, expandable to raw output).
- The command palette exposes "Fetch all repositories in workspace" with the same summary dialog.
- Batch results are non-blocking: you can keep working; the summary stays in the Output panel.

## Edge cases

- **Authentication failures** surface as typed errors ("credential required for `<remote>`", "SSH key rejected") with a "Details" drawer showing the raw Git output — see page 13 for troubleshooting.
- **Detached HEAD** blocks branch-only actions (rename/delete) and suggests creating a branch.
- **Bare repositories** in the workspace can be fetched/pushed and browsed in the graph, but have no working tree — changes/commit features are unavailable.

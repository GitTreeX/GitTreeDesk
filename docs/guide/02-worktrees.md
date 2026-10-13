# 02 · Worktrees

> Status: 🚧 Planned · Scope: v1 · Engineering: [`../spec.md`](../spec.md)

A **worktree** is an additional working directory attached to the same repository — e.g. `__worktree__/mobile-app_worktree-feat-dark-mode` is a second checkout of `app/mobile-app` on a feature branch. GitTreeDesk treats worktrees as first-class: they are detected, grouped, created, and removed from the UI.

## How worktrees appear

- In the **Repos view**, every linked worktree is nested under its main repository — one repository node, several working trees. A worktree row shows `<branch> @ <path>`; the main working tree carries a `main` marker.
- In the **Explorer view**, worktree folders look like normal folders and carry the worktree glyph; the Repos view is the primary place to work with them.
- Worktrees **outside the workspace root** are hidden by default; enable "Show external worktrees" in view options to include them (greyed, absolute path shown).
- A worktree row behaves like a repository row everywhere: badges, changes, commit box, graph, terminal — every operation (pages 03–11) works against that worktree's working tree and its branch.

## Creating a worktree

Context menu on a repository → **"New worktree…"**. The dialog:

| Field | Behavior |
|---|---|
| Source repository | Pre-filled from the context menu |
| Branch | **New branch** (type a name) or **existing branch** (picker). An existing branch that is already checked out in another worktree is blocked with a clear message — Git does not allow the same branch in two worktrees. |
| Base ref | For a new branch: the starting point (default: the repository's current HEAD). |
| Target path | Pre-filled from the path template (below); editable. The path is created if missing. |

**Path template** (default matches the `__worktree__` convention):

```
{worktreeRoot}/{repo}_{branch-slug}
```

- `{worktreeRoot}` — defaults to `<workspace>/__worktree__`; configurable in settings.
- `{branch-slug}` — the branch name with `/` replaced by `-`.
- Example: branch `worktree/feat-dark-mode` on repo `mobile-app` → `__worktree__/mobile-app_worktree-feat-dark-mode`.

A freshly created `__worktree__` folder is automatically attached to its parent repository (and excluded from ordinary discovery noise). After creation the tree focuses the new worktree row.

## Removing, pruning, locking

| Action | Behavior |
|---|---|
| **Remove** | Refuses on a dirty worktree; "Force remove" appears with a confirmation, and a backup ref is created first (safety nets, page 06). The folder is deleted, branch untouched. |
| **Prune** | Cleans up worktree records whose folders are already gone (`git worktree prune`). Runs manually from the repo context menu, and automatically after fetch. |
| **Lock / Unlock** | Protects a worktree from prune/remove (for removable drives, long-running experiments). Locked state shows on the row. |
| **Move** | [Later] |

## Edge cases

- A worktree whose folder was deleted manually still appears greyed as "prunable" until pruned.
- A worktree checked out on a detached HEAD shows `detached @ <short-sha>`.
- Worktree folders are never mistaken for separate repositories: repository identity is the shared git directory, so `mobile-app` and its worktrees are always one node with multiple working trees.
- Opening a terminal or a file "in the worktree" uses that worktree's path — never the main checkout.

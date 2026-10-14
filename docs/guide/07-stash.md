# 07 · Stash

> Status: ✅ Implemented · Scope: v1 · Engineering: [`../spec.md`](../spec.md)

## Creating a stash

Entry points: Source Control view toolbar (per repository), repository context menu, or command palette.

| Option | Default | Meaning |
|---|---|---|
| Message | empty | Description shown in the stash list (e.g. "wip before rebase"). |
| Include untracked | off | New files are stashed too. |
| Keep index | off | Staged changes stay staged in the working tree after stashing. |
| Path subset | — | Select files/folders first, then "Stash selected paths" — only those changes are stashed. |

After creating, the working tree is clean for the stashed paths and the repository badges update.

## The stash list

- Lives in the repository's details panel; also summarized as the `⚑n` badge (page 01).
- Each entry: message, source branch, relative date, and the file count. Expanding an entry lists its files; clicking a file opens that stash's diff for the file.
- Stashes are **repository-level** (shared by all worktrees of the repository), and applying one targets the current worktree's working tree.

| Action | Behavior |
|---|---|
| **Apply** | Applies without removing the entry. |
| **Pop** | Applies and removes the entry on success; if applying hits conflicts, the entry is **kept** and the conflict flow starts (page 06) — nothing is silently lost. |
| **Drop** | Removes the entry; a backup ref is created first (undo available, page 06). |
| **Show** | Opens the full diff of the stash in the editor area. |

## Interaction with other operations

- Checkout, pull, and rebase can run "**auto-stash**" when the working tree is dirty. The temporary stash uses a generated message (`autostash: <operation>`), and is **restored automatically** when the operation finishes.
- If the automatic restore conflicts, the stash entry is kept and a banner asks you to resolve it later — automatic flows never discard your changes.
- Stashing is blocked while an operation (merge/rebase/…) is in progress; the dialog offers Continue/Abort first.

# 01 · Workspace & Repository Tree

> Status: ✅ Implemented · Scope: v1 · Engineering: [`../spec.md`](../spec.md)

## Opening a workspace

- At first launch the **Welcome screen** shows recent workspaces and an "Open folder…" action. You can also use the menu (File → Open Folder…) or **drag a folder onto the window**.
- A workspace is just a folder — it does **not** need to be a Git repository. You will typically point it at a folder that *contains* many repositories (e.g. `E:\Projects\acme`).
- The recent list keeps the last 10 workspaces; each entry has a context menu with "Remove from list". Reopening a workspace happens in place — no restart.
- v1 is single-window: opening another workspace replaces the current one in the same window.

## What gets discovered

GitTreeDesk walks the folder and finds **Git repositories**, **linked worktrees**, and **submodules**, at any depth. Discovery rules:

| Rule | Default |
|---|---|
| Skipped directories | `node_modules`, `.git`, `.svn`, `.hg` (plus anything in `exclude`) |
| Symlinks | not followed |
| Maximum depth | 8 levels |
| Safety budget | 200 000 directories; if exceeded, a notice appears and you can raise the limit |

- Repositories nested inside another repository's working tree are supported and shown as parent/child.
- Linked worktrees kept in a separate folder (e.g. `__worktree__/`) are attached to their main repository instead of appearing as unrelated folders (details: page 02).
- **New repositories** created while the app is open are detected automatically — the tree updates without a manual refresh.
- If a folder should not be scanned, add it to `exclude` (below) — useful for backup folders, fixtures, or big data directories.

## Workspace configuration — `.gitreedesk/workspace.json`

Create this file in the workspace root to tune discovery and grouping. It contains no secrets and can be committed.

```jsonc
{
  "$schema": "https://gitreedesk.dev/schemas/workspace.json",
  "name": "acme",
  "exclude": ["content/中文文档", "**/fixtures/**"],
  "scan": { "maxDepth": 8, "followSymlinks": false },
  "groups": [{ "name": "Backend", "match": ["backend/*"] }]
}
```

- `exclude` — extra skip patterns (glob), relative to the workspace root.
- `groups` — optional; without it, groups are derived from the first path segment.
- Edits to this file are picked up automatically and the tree updates.

## Trust

The first time a workspace is opened, a prompt asks whether you trust it. Until trusted:

- Git **hooks are suppressed** for all operations in that workspace (a commit that would normally run a `pre-commit` hook runs without it — the commit panel shows an "hooks disabled" notice);
- workspace-defined **terminal quick commands are disabled**.

Trust is remembered per workspace root. Change it later from the command palette: **"Trust this workspace"** / **"Revoke trust"**.

## The two tree views

The sidebar's Tree activity hosts two coordinated views over the same repositories:

### Explorer view — the filesystem tree

- Folders exactly as on disk. Repository folders carry a badge (branch name or short SHA); worktree folders carry the worktree glyph.
- Directories load lazily; only expanded folders are watched.
- File and folder operations (context menu): new file, new folder, rename (F2), delete, reveal in OS file manager, copy path, **Open in VSCode**, **Open terminal here**. Delete moves items to the **OS trash** (reversible).
- **Compare two files**: select two files, then "Compare selected" opens them side by side in the diff viewer.
- JS/TS/JSON etc. open in the built-in editor (page 10).

### Repos view — the logical tree

- Repositories are first-class rows: name, current branch (or `detached @ <short-sha>`), and status badges.
- **Linked worktrees** and **submodules** appear nested under their main repository (pages 02 and 08).
- Worktrees located outside the workspace are hidden by default; enable "Show external worktrees" in view options to see them (greyed, with their absolute path).
- Groups: derived from the first path segment by default, or configured via `workspace.json` (`groups`).
- **Multi-select** repositories for batch actions: "Fetch selected", "Pull selected", "Open terminal for each".
- Context menu on a repo: copy path, reveal in OS, open terminal, open graph tab, plus the batch actions above.

## Badges & what is shown (display options)

Both views share one badge set. The badge types are the display toggles — each can be switched on/off in **View options**:

| Badge | Meaning | Toggle |
|---|---|---|
| `●` | Working tree is dirty (uncommitted changes) | ✔ |
| `↓n ↑n` | Behind / ahead of upstream | ✔ |
| `⚑n` | Stash count | ✔ |
| `⟳` | An operation is in progress (merge, rebase, …) | ✔ |
| `detached` | HEAD is detached | ✔ |
| `◇` | Submodules need attention (uninitialized or drifted) | ✔ |

**Quick filters** above the tree: "Only dirty", "Only ahead/behind", "Only worktrees".

**Per-repo checkboxes**: each repository row can be checked to include it in the **Source Control view** — with many repositories you can keep the changes list focused on the ones you are working on (page 03). "Select all / none" shortcuts are available in the view's toolbar.

## Keyboard in the trees

- `↑` / `↓` move, `←` / `→` collapse / expand, `Enter` opens (file, repo, worktree).
- `F2` renames, `Delete` deletes (trash), `Ctrl/Cmd+P` quick-opens any file in the workspace (respecting `exclude`).
- `Ctrl/Cmd+R` jumps to a repository by name.

## Notices & edge cases

- **Empty folder** — empty state with "Open another folder".
- **No repositories found** — the tree shows a hint (check `exclude` / `scan.maxDepth`, or the folder really has none).
- **Budget exceeded** — a dismissible notice explains the scan stopped early, with "Raise limit and rescan".
- **Repository added / removed on disk** while the app is open — the tree reflects it automatically within a few seconds.

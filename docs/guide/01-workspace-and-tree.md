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
  "name": "acme",
  "exclude": ["content/中文文档", "**/fixtures/**"],
  "scan": { "maxDepth": 8, "followSymlinks": false },
  "groups": [{ "name": "Backend", "match": ["backend/*"] }]
}
```

- `exclude` — extra skip patterns (glob), relative to the workspace root.
- `groups` — optional; without it, groups are derived from the first path segment.
- The file is read when the workspace opens; edits apply the next time you open it (or after a rescan).

## Trust

The first time a workspace is opened, a prompt asks whether you trust it — once per workspace root. Until trusted:

- Git **hooks are suppressed** for commits and history rewrites in that workspace (a commit that would normally run a `pre-commit` hook runs without it — the commit box shows **"Git hooks are disabled in this workspace"**);
- workspace-defined **terminal quick commands are disabled**.

Trust is remembered per workspace root. Change it later from the command palette: **"Trust This Workspace"** / **"Revoke Trust"**.

## The two tree views

The sidebar's Tree activity hosts two coordinated views over the same repositories:

### Explorer view — the filesystem tree

- Folders exactly as on disk. Repository folders carry a badge (branch name or short SHA); worktree folders carry the worktree glyph.
- Directories load lazily; only expanded folders are watched.
- File and folder operations (context menu): new file, new folder, reveal in OS file manager, **Open in VS Code**, **Open Terminal Here**, copy path (absolute), copy relative path, rename (F2), **Move to Trash** — grouped with dividers, and any row inside a repository also offers **Open Commit Graph**. Delete moves items to the **OS trash** (reversible).
- **Compare two files** — right-click a file and choose **Select for Compare** (the row is highlighted), then choose **Compare with Selected** on a second file. The pair opens side by side in the diff viewer: the alphabetically earlier path is always on the left, and the same pair reuses one tab however you pick it. Two images open as a 2-up preview; anything else shows why it cannot be compared. Both entries are also command-palette commands acting on the row under the cursor.
- JS/TS/JSON etc. open in the built-in editor (page 10).

### Repos view — the logical tree

- Repositories are first-class rows: name, current branch (or `detached @ <short-sha>`), and status badges.
- **Linked worktrees** and **submodules** appear nested under their main repository (pages 02 and 08).
- Worktrees located outside the workspace are hidden by default; enable "Show external worktrees" in view options to see them (greyed, with their absolute path).
- Groups: derived from the first path segment by default, or configured via `workspace.json` (`groups`).
- **Multi-select** repositories for batch actions: "Fetch selected", "Pull selected (fast-forward only)".
- Context menu on a repo: copy path, reveal in OS, open terminal, open graph tab, plus the batch actions above. The same menu opens from the **… button** on the repo row's right edge, so the common actions do not need a right-click.

## Badges & what is shown (display options)

Both views share one badge set. Each group of badges has its own **View options** toggle:

| Badge | Meaning | Toggle |
|---|---|---|
| `●` | Working tree is dirty (uncommitted changes) | Dirty state |
| `↓n ↑n` | Behind / ahead of upstream | Sync state |
| `⚑n` | Stash count | Stashes |
| `⟳` | An operation is in progress (merge, rebase, …) | Operation |
| `detached` | HEAD is detached | Detached HEAD |
| `◇` `⧉` `main` `bare` | Repository kind: submodules need attention, locked or prunable worktree, main worktree, bare repository | Repository badges |

**Quick filters** above the tree: "Only dirty", "Only ahead/behind", "Only worktrees".

**Per-repo checkboxes**: each repository row can be checked to include it in the **Source Control view** — with many repositories you can keep the changes list focused on the ones you are working on (page 03) — and in the **workspace activity timeline** (page 09). "Select all / none" shortcuts are available in the view's toolbar.

## Keyboard in the trees

- `↑` / `↓` move, `←` / `→` collapse / expand, `Enter` opens a file in Explorer or toggles the row's children in either tree.
- `F2` renames, `Delete` deletes (trash), `Ctrl/Cmd+P` quick-opens any file in the workspace (respecting `exclude`).
- `Ctrl/Cmd+R` jumps to a repository by name.

## Notices & edge cases

- **Empty folder** — empty state with "Open another folder".
- **No repositories found** — the tree shows a hint (check `exclude` / `scan.maxDepth`, or the folder really has none).
- **Budget exceeded** — a dismissible notice explains the scan stopped early, with "Raise limit and rescan".
- **Repository added / removed on disk** while the app is open — the tree reflects it automatically within a few seconds.

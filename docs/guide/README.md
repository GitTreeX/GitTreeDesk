# GitTreeDesk — User Guide & Feature Reference

> Status: 🚧 Planned — nothing is implemented yet. This guide describes the intended v1 behavior.
> English is canonical. [`README.zh-CN.md`](./README.zh-CN.md) is the synced Chinese mirror.
> Engineering reference: [`../spec.md`](../spec.md) (architecture, key decisions, performance budgets).

## How this guide drives development

This folder is both the user manual and the development backlog. The workflow:

1. **Edit** the page covering the feature you want (or add a section / a new page).
2. **Ask the AI**: "implement `<page>` § `<section>`".
3. The AI implements it, verifies the behavior, and updates that page's **Status** line.

Rules for edits:

- Write intended behavior in the present tense, as the finished product behaves: "Clicking X opens Y."
- Defaults, interactions, error messages, and edge cases are **part of the requirement** — include or change them explicitly.
- Mark post-v1 ideas inline with `[Later]`.
- If an edit contradicts [`../spec.md`](../spec.md), the AI must flag the conflict and propose a spec update instead of silently diverging.
- Code comments, identifiers, and commit messages **never cite document numbering** (`F4`, `AD-12`, page numbers). These documents are transitional and may be deleted once the behavior ships, which would leave unresolvable references in the code history — describe the behavior instead ("stage a single hunk from the diff view", not "per F7").
- Edit whichever language is more comfortable; the AI keeps the other version in sync.

Status legend: 🚧 Planned · 🔨 In progress · ✅ Implemented

## What is GitTreeDesk

A workspace-first multi-repo Git workbench. Open **any folder** — it does not need to be a Git repository — and manage every Git repository, worktree, and submodule inside it from one tree: full Git operations, a commit graph, file browsing with diffs and light editing, and integrated terminals. It is deliberately *not* a general-purpose IDE; where deeper code intelligence is needed, a one-click "Open in VSCode" escape hatch is provided.

## Prerequisites

| | |
|---|---|
| Git | **≥ 2.23** required (≥ 2.36 recommended). Read from `PATH`; can be overridden in settings. A warning appears if the version is too old or Git is missing. |
| OS | Windows 10+ · macOS 11+ · Linux (AppImage / deb) |

## Getting started

1. **Install** GitTreeDesk for your platform (installer, or portable zip on Windows).
2. **First launch** shows the Welcome screen: recent workspaces, "Open folder…", and a drop zone — you can also drag a folder onto the window.
3. **Open a workspace root.** Any folder works; it does not need to be a Git repository. Example: `E:\Projects\acme`.
4. **Trust prompt.** The first time a workspace is opened, a prompt asks whether you trust it. Until trusted, GitTreeDesk suppresses Git hooks (`core.hooksPath` override) and disables workspace-defined terminal quick commands. Trust is remembered per workspace; you can change it later via the command palette ("Trust this workspace" / "Revoke trust").
5. **Repositories appear progressively.** If the workspace was opened before, the full tree shows instantly from cache and statuses refresh in the background; otherwise the tree streams in as discovery walks the folders (see page 01).

## The window at a glance

```
┌ Titlebar: workspace name · window controls ─────────────────────────────┐
│ Activity │ Primary sidebar           │ Editor area (tabs)              │
│ bar      │  ▸ Explorer               │  • file  • diff  • graph        │
│  Tree    │  ▸ Repos                  │  • settings  • keyboard refs    │
│  SCM     │  ▸ Source Control         │                                 │
│  Graph   │  ▸ Graph                  ├─────────────────────────────────┤
│  Term    │                           │ Secondary sidebar: details      │
│  ⚙       │                           │ (commit, file, repo) — toggle   │
├──────────┴───────────────────────────┴─────────────────────────────────┤
│ Bottom panel: Terminal │ Output (Git operation logs)   — collapsible   │
├─────────────────────────────────────────────────────────────────────────┤
│ Status bar: repo · branch · sync state · operation · terminals · theme  │
└─────────────────────────────────────────────────────────────────────────┘
```

- **Activity bar** switches the sidebar between Tree, Source Control, Graph, Terminal, and Settings.
- The **status bar** always shows the active repository (branch, ahead/behind, operation state) — clicking it opens the repo/branch picker.
- Everything is reachable from the **command palette** (Ctrl/Cmd+Shift+P) and has a default shortcut (page 12).

## Five-minute tour

1. Open your workspace and switch the sidebar to **Tree**.
2. In the **Repos view**, find a repository with a `●` badge (uncommitted changes) and click it.
3. The **Source Control** view shows its changes — click a file to see the diff, stage files (or single hunks), type a commit message (or press the ✨ generate button), and **Commit**.
4. Open the **Graph** tab for that repository; right-click your new commit — branches, tags, cherry-pick, revert, and more live there.
5. Press `` Ctrl+` `` to open a **terminal** at the repository root and run your usual commands.

## Page index

| # | Page | Covers | Status |
|---|------|--------|--------|
| — | [01 Workspace & Tree](./01-workspace-and-tree.md) | Opening workspaces, repository discovery, trust, Explorer & Repos views, badges, filters | 🚧 |
| — | [02 Worktrees](./02-worktrees.md) | Display, create, remove, prune, lock — worktrees as first-class citizens | 🚧 |
| — | [03 Changes & Diff](./03-changes-and-diff.md) | Multi-repo changes list, staging, discarding, diff viewer, file history | 🚧 |
| — | [04 Commit & Messages](./04-commit-and-messages.md) | Commit, amend, history rewrite (message/author/date), commit message generation (offline + LLM) | 🚧 |
| — | [05 Branches, Remotes & Tags](./05-branches-remotes-tags.md) | Branch operations, remotes, fetch/pull/push, tags, batch operations | 🚧 |
| — | [06 Merge, Rebase & Conflicts](./06-merge-rebase-conflicts.md) | Merge, rebase (incl. interactive), cherry-pick, revert, reset, conflict resolution, safety nets | 🚧 |
| — | [07 Stash](./07-stash.md) | Creating, listing, applying and dropping stashes | 🚧 |
| — | [08 Submodules](./08-submodules.md) | Submodule display, status, one-click update, sync | 🚧 |
| — | [09 Commit Graph](./09-commit-graph.md) | Per-repo commit graph, filters, commit actions, large-repo handling | 🚧 |
| — | [10 Editor](./10-editor.md) | File viewing and light editing, TypeScript hints, diffs, Open in VSCode | 🚧 |
| — | [11 Terminal](./11-terminal.md) | Shell profiles, per-directory cascading config, quick commands | 🚧 |
| — | [12 Settings & Keyboard](./12-settings-and-keyboard.md) | Settings UI, config files, default shortcuts, command palette, keymap customization | 🚧 |
| — | [13 FAQ & Troubleshooting](./13-faq.md) | Common problems, recovery procedures, how to request features | 🚧 |

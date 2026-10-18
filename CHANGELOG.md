# Changelog

English is canonical; [简体中文](CHANGELOG.zh-CN.md) is the synced mirror.
Archives for every version are published on the [releases page](https://github.com/GitTreeX/GitTreeDesk/releases).

## 0.2.0

The first release packaged for all three platforms — everything below ships in it.

**Workspace and repositories**

- Open any folder as a workspace. Repositories and worktrees are discovered as folders expand, cached in SQLite, and shown in one tree with per-repository status.
- Worktrees are managed from the tree: create one on a new or existing branch, remove a dirty one with a backup first, prune stale records, lock and unlock, or move the folder — uncommitted changes come along.
- Repositories view with branch, upstream, ahead/behind and dirty-state badges; push to one of several remotes.
- Submodules: status for each one in the tree, one-click recursive update with streamed output, URL sync, and add or deinitialize a submodule.
- Per-workspace trust prompt: untrusted roots suppress Git hooks and workspace-defined terminal commands.
- Workspace activity timeline in the graph pane: recent commits from the checked repositories, grouped by day, each row jumping into that repository's commit graph.

**Changes, commits, history**

- Multi-repository Source Control view: stage per file, hunk or single line, discard, amend, hook output surfaced in the Output panel.
- Merge, rebase (interactive rebase has a list editor where you drag a row to reorder it), cherry-pick, revert (one commit or a Ctrl/Cmd-selected batch), reset, stash, and conflict resolution in the editor and the diff view.
- Commit graph: lanes, ref chips, incoming/outgoing markers, paged and streamed history with a configurable window size, combinable filters, resizable lane column, commit details with per-file stats, history rewrite with backup refs and undo.
- Commit message drafts generated offline from the staged diff, or through a configured LLM provider.

**Editing and terminals**

- Monaco editor with syntax highlighting, TypeScript hints, and a split diff view with per-file history that follows the file across renames. Any two workspace files can be marked (Select for Compare / Compare with Selected) and opened side by side in that same diff viewer.
- Integrated terminals bound to a repository or worktree, with profiles, quick commands, and scrollback.

**Shell and settings**

- Command palette covering every action, keyboard shortcuts, an editable `keybindings.json`, and a keyboard reference page that detects conflicts and records key presses.
- Settings for theme, accent color, UI and graph density, Git binary path, LLM provider, and log verbosity.
- English and Simplified Chinese interfaces; the About dialog links to the project homepage and the release page.

**Packaging**

- Windows: NSIS installer and portable zip. macOS: dmg and zip for arm64 and x64, unsigned while notarization is deferred. Linux: AppImage and deb.
- Three-platform CI that packages, boots the packaged build headlessly, and reports performance budgets.

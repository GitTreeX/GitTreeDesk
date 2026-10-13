> 🚧 **WIP / Early Development**
>
> GitTreeDesk is in early development. Features, APIs, configuration, and project structure may change without notice.
> It is not production-ready yet. Feedback and experiments are welcome.

---

# GitTreeDesk

> A workspace-first multi-repo Git workbench for monorepos and worktrees. Built with Electron.

GitTreeDesk lets you open **any folder as a workspace**, discover all Git repositories and worktrees inside it, and manage them from one tree.

## Why GitTreeDesk

VSCode is excellent for single-repo projects, but when you manage 100+ Git repositories under one large folder, it becomes slow and fragmented:

- File watchers struggle with huge directory trees
- Git status refreshes slowly across many repositories
- File browsing and Git operations are split across different views
- Worktree workflows are not first-class

GitTreeDesk takes a different approach: **not a general-purpose IDE, but a workspace-first Git workbench for many repositories.**

## Core Features

- 🌲 **Workspace-first** — Open any folder. The root does not need to be a Git repository.
- 🎯 **Multi-repo tree** — Discover and browse all Git repositories inside the workspace.
- 🌿 **Worktree-aware** — Detect, display, create, and remove Git worktrees.
- 🔀 **Full Git workflow** — Commit, branch, merge, rebase, stash, cherry-pick, fetch, pull, push.
- 📊 **Git Graph** — Visualize commit history across repositories.
- ✏️ **Monaco editor** — Syntax highlighting, TypeScript hints, and diff views.
- 🌍 **English-first i18n** — English by default, with i18n-ready architecture.
- 🌙 **Dark mode** — Follow system theme or switch manually.
- 🚀 **Performance-first** — Lazy loading, incremental updates, and SQLite caching.

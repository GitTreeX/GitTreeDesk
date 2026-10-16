# GitTreeDesk — Specification

> Status: **Draft v0.1** · 2026-10-13
> English is the canonical language of this document. `spec.zh-CN.md` is a courtesy translation kept in sync; when they disagree, this file wins.

## Overview

### Problem statement

Git work in a large multi-repo workspace (dozens to hundreds of repositories under one folder) is split across tools that each cover only part of the job:

- **VSCode** is optimized for a *single* repository. Opening a folder that contains 50+ repositories triggers whole-workspace file watchers, per-repository SCM providers, and TypeScript project resolution for everything that looks like a project. The "complete experience" is exactly what makes it slow.
- **Git GUIs** (SourceTree, Fork, GitKraken) give good per-repository Git operations, but no workspace-first browsing, no file tree over the whole folder, no integrated editor, and weak handling of Git worktrees spread across sibling directories.

GitTreeDesk combines the useful parts into one tool, and makes the *workspace* — not the repository — the unit of work.

### Positioning

**GitTreeDesk is a workspace-first multi-repo Git workbench, not a general-purpose IDE.**

Three principles drive design trade-offs:

1. **Workspace-first.** The folder the user opens is a workspace. It does not need to be a Git repository. It may contain any mix of Git repositories (nested at any depth), linked worktrees, submodules, and plain folders.
2. **Lazy and incremental by default.** Nothing is scanned, watched, parsed, or rendered until it is needed; everything already known is refreshed incrementally, never re-computed from scratch.
3. **Keyboard-first, honest UI.** Every operation is reachable from the command palette and a shortcut. Animations must never delay input, focus, or keyboard flow.

### Scope

**Goals (v1):**

- Open any folder as a workspace; discover all repositories, worktrees, and submodules inside it; present them in a tree with live status
- Multi-repo overview of changes; the user chooses which repositories and which change types are shown
- Worktrees are first-class: detected, grouped under their main repository, created and removed from the UI
- Complete Git workflow comparable to SourceTree: stage, commit, stash, branch, merge, rebase (incl. interactive), cherry-pick, revert, reset, tags, remotes, fetch/pull/push, submodule update, worktree CRUD, commit metadata editing, all with safety nets
- Native commit graph (Git Graph equivalent) per repository, with actions on commits, plus a workspace-wide activity timeline over the checked repositories
- Code viewing and light editing: syntax highlighting, best-effort TypeScript hints, and a one-click "Open in VSCode" escape hatch
- Changes list and diff view: staged/unstaged/untracked/conflicted, text and image diffs, hunk-level staging
- Integrated terminal: multiple shell profiles, per-directory cascading configuration, quick commands
- One-click commit message generation from the staged diff (offline heuristics, optional LLM)
- Modern, themeable UI; dark mode is first-class (follow system or manual); keyboard-friendly
- Cross-platform: Windows, macOS, Linux
- English-first with i18n architecture from day one

**Non-goals (v1):**

- Extension/plugin platform, marketplace.
- Full language services (project-wide TS/refactoring). Covered by the "Open in VSCode" escape hatch.
- Hosting-platform integrations (PRs, issues, CI status). *Later.*
- Remote development, cloud sync, accounts, telemetry.
- A VSCode-grade 3-way merge editor. v1 resolves conflicts via ours/theirs + editor with markers + external merge tool.
- Running builds/tests/tasks, debuggers, problem panels.

### Reference scenario (acceptance scenario)

A representative workspace used as the acceptance target: `acme/` — ~55 Git repositories nested 2–3 levels under groups (`app/`, `backend/`, `website/`, …), linked worktrees kept in a sibling `__worktree__/` folder (`mobile-app_worktree-feat-dark-mode`, …), non-Git folders mixed in, a noisy `node_modules/` at the root, and at least one CJK-named directory (`content/中文文档`).

Acceptance for v1:

- Opening this workspace shows the first full tree within the performance budget and streams in repository status without blocking the UI.
- Every repository in the tree is fully operable (all the Git operations).
- `__worktree__` entries appear grouped under their main repository, not as unrelated folders.
- The CJK-named directory and CJK paths inside repositories are correctly displayed and operable.

### Glossary

| Term | Meaning |
|---|---|
| **Workspace** | The root folder the user opens. Not necessarily a Git repository. |
| **Repository** | A Git repository whose `.git` (directory or gitdir-pointer file) is found inside the workspace. |
| **Main worktree** | The working tree where the repository was originally created. |
| **Linked worktree** | An additional working tree created via `git worktree add`, possibly outside the workspace root. |
| **Submodule** | A repository registered via `.gitmodules`; may or may not be initialized. |
| **Git dir / common dir** | For linked worktrees the per-worktree git dir differs from the shared `common dir`. Repository identity is keyed on the common dir. |
| **Group** | A virtual folder in the Repos view; configured explicitly or derived from the first path segment. |
| **Badge** | A status indicator rendered next to a repository row (dirty, ahead/behind, stash, in-progress operation, …). |
| **Operation state** | An in-progress Git operation detected from git-dir state files (`MERGE_HEAD`, `rebase-merge/`, `CHERRY_PICK_HEAD`, …). |

---

## Key decisions (ADRs)

Decisions with the alternatives that were considered and rejected. They are binding for v1; changing one requires updating the affected sections.

| Decision | Rationale | Rejected alternatives |
|----------|-----------|----------------------|
| **Greenfield Electron application** (current stable Electron; the major version is pinned in `package.json` and upgraded deliberately). | The performance pain is architectural in VSCode (whole-workspace watchers, SCM provider per repo, TS project graph). A greenfield shell lets discovery, watching, and status refresh be designed for the multi-repo case from the start. | **Fork code-oss**: million-LOC fork, heavy upstream-merge burden, the perf problems are architectural and cannot be fixed inside a fork, ~80% of the codebase is irrelevant. **VSCode extension**: cannot fix the watcher/scan root cause; at most an interim UX probe. |
| **Git engine = system `git` CLI**, spawned with argument arrays; porcelain output parsed. | Correctness: worktree, submodule, LFS (filters), credential helpers, hooks, and edge-case behavior are 100% identical to the command line — the same strategy as VSCode, SourceTree, Fork. Performance comes from a concurrency pool, index-fingerprint skips, and caching. | **isomorphic-git**: as of 2026-10 its command index lacks rebase, cherry-pick, worktree, submodule, hooks, LFS — disqualifying for the worktree and Git-operation goals; also slow on large repositories. **libgit2 bindings** (nodegit/koffi): worktree/submodule/filter gaps, hooks don't run, per-platform native packaging. **Hybrid** (native reads + CLI writes): two engines, doubled consistency cost; revisit only if profiling proves it necessary. |
| **Git binary strategy**: prefer system Git (`git` on PATH, overridable in settings). Require ≥ 2.23; warn below 2.36. Detect via `git --version` at startup. On Windows, also probe `%ProgramFiles%\Git\cmd\git.exe`. Bundling a portable Git is an open question. | Users of Git GUIs already have Git; bundling adds tens of MB and update burden. The version floor covers `git switch/restore` (2.23) and stable porcelain behavior. | Bundling Git for Windows / shipping our own builds — later, only if real users hit missing-Git walls. |
| **Renderer stack**: React 19 + TypeScript, Vite, Tailwind CSS v4, Radix UI primitives (shadcn-style vendored components), Zustand for state, TanStack Virtual for trees/lists, Lucide icons. | Hot-update-friendly; Zustand fits high-frequency status patches; Radix gives accessible primitives without a heavyweight component kit. | Ant Design / MUI: heavy theming cost, dated visual language, conflicts with the UI goals. |
| **Editor = Monaco**, bundled locally (no CDN loader — must work fully offline). TypeScript hints via Monaco's built-in TS worker in v1; a tsserver/LSP bridge is *Later*. `monaco-languageclient` is explicitly not a v1 dependency. | Monaco is the VSCode editor core: highlighting for 100+ languages, diff editor, TS language service in a worker. Project-wide LSP is a large sub-project by itself; the "Open in VSCode" button covers the power-user case in v1. | CodeMirror 6: lighter but weaker TS story and weaker diff. |
| **Terminal = node-pty + @xterm/xterm**, pty host running in an Electron `utilityProcess` (crash of the pty host must not take down the app), data streamed to the renderer over a `MessagePort`. | Standard, proven pairing (used by VSCode's terminal stack). utilityProcess isolation is the same idea as VSCode's pty host. | Running pty in the main process: a native crash kills the window. |
| **Persistence split**: user-authored configuration lives in **JSON files** (portable, diffable, optionally committed); **SQLite (better-sqlite3) holds only disposable caches/indexes** — deleting it must never lose user data. | Users can inspect/version their config; caches are free to be rebuilt. Avoids the classic mistake of hiding user settings in a binary DB. | All-in-SQLite: opaque config, sync/hand-edit hostile. |
| **Watcher strategy**: no recursive watch over the whole workspace. Watch (a) each repository's git dir, depth-limited, (b) directories expanded in the file tree (LRU-capped), (c) the workspace root shallowly (depth 2) for discovery of new repositories. Interval polling is only a fallback (default 60 s, configurable; disabled per-repo when watchers are healthy). | The workspace tree can have hundreds of thousands of directories; per-repo git-dir watching is bounded by repository count, not workspace size. This is the core performance decision that makes the greenfield shell pay off. | Whole-workspace recursive watching (chokidar/@parcel/watcher over the root): the exact VSCode failure mode this product exists to avoid. |
| **Commit message generation**: offline heuristic pipeline first (repo convention detection + staged-diff analysis → editable draft); optional LLM provider (OpenAI-compatible endpoint) explicitly opt-in, key stored via OS keychain (`safeStorage`). Draft is always user-editable; auto-commit never happens. | Works with zero setup and zero network; LLM quality is an enhancement, not a dependency. Privacy: diffs leave the machine only when the user opts in. | LLM-only: hard dependency on network + key, poor offline story. Template-only: too little value. |
| **i18n**: `react-i18next`, English source strings as keys-as-text, namespaced locale JSON, `Intl` for dates/numbers. v1 ships `en` + `zh-Hans`; adding a locale is config-only. No hardcoded user-visible strings anywhere (enforced by lint rule). | English-first per README; the architecture must make translation mechanical, not a refactor. | Deferring i18n: guaranteed rewrite later. |
| **Repository identity = realpath of the git common dir.** All views (Explorer, Repos, SCM, Graph) key off this id, so a main worktree and all its linked worktrees are one entity with multiple working trees. | Worktree grouping falls out of identity for free; no name-based heuristics. | Path-based identity: worktrees would masquerade as unrelated repos. |
| **Safety nets for destructive operations.** Before reset --hard, rebase, interactive rebase, history rewrite, stash drop, branch delete, worktree remove: create `refs/gitreedesk/backup/<op>/<yyyymmdd-hhmmss>` pointing at the current HEAD (or the target ref), and append to an operation log (`.gitreedesk/oplog.json` in the git dir is *not* used; the log lives in SQLite + backup refs in the repo). Each affected UI action offers **Undo/restore from backup** for the session and later. | History rewriting is the single most dangerous feature class; a Git workbench without an undo path is a footgun. Backup refs are invisible to normal workflows (`refs/gitreedesk/*` is not listed by default) and cheap. | No backups: unacceptable. Full reflog UI: later refinement. |
| **Untrusted-workspace gating**: on first open, a workspace is *untrusted*. Untrusted workspaces run no workspace-configured commands (quick commands disabled) and Git hooks are suppressed via `-c core.hooksPath=<empty>`; the user can trust, and trust is remembered per workspace root in SQLite. | Opening a stranger's folder must not execute their `post-checkout` hook or terminal commands. | Trusting everything: a well-known class of vulnerability. |

---

## Architecture

### Process model & package layout

```
┌─────────────────────────── Electron app ───────────────────────────┐
│ Main process                                                        │
│   WindowManager · Menu/Shortcuts · Updater · SettingsService        │
│   WorkspaceService (discovery, registry, status scheduler)          │
│   GitService (spawn pool, porcelain parsers, op models, backups)    │
│   WatcherService (@parcel/watcher; per-repo git dirs + expanded)    │
│   CommitMessageService (heuristics + LLM providers)                 │
│   TrustStore · CacheDB (better-sqlite3, disposable)                 │
├─────────────────────────────────────────────────────────────────────┤
│ utilityProcess: PTY HOST (node-pty sessions, survive renderer       │
│   reload; MessagePort channel per terminal)                         │
├─────────────────────────────────────────────────────────────────────┤
│ Preload: contextBridge → typed `window.gtd` API (zod-validated)     │
├─────────────────────────────────────────────────────────────────────┤
│ Renderer (React, sandboxed, no Node): UI only                       │
│   Zustand stores (workspace/repo status/ops/terminals/settings)     │
│   Monaco (files, diffs) · Commit graph (canvas+DOM rows)            │
└─────────────────────────────────────────────────────────────────────┘
```

pnpm workspace layout (`apps/*` + `packages/*`, catalog-managed versions):

```
GitTreeDesk/
├── apps/
│   └── desktop/
│       ├── src/main/            # Electron main: service wiring, IPC handlers, menu, trust, updater
│       ├── src/pty-host/        # utilityProcess entry for node-pty
│       ├── src/preload/         # contextBridge API surface
│       ├── src/renderer/        # React app (Vite)
│       └── electron-builder.yml
├── packages/
│   ├── shared/                  # cross-process types, IPC contract, zod schemas, i18n key types
│   ├── git-core/                # git runner, porcelain parsers, op models, backup refs (pure Node, no Electron imports; unit-testable against real temp repos)
│   ├── workspace-core/          # discovery, repo registry, status scheduler, watcher planning
│   ├── terminal-core/           # profile detection, cascading config resolution, quick commands
│   ├── commit-msg/              # convention detection, offline drafts, LLM providers
│   └── ui/                      # shared React components, design tokens, badge set
├── docs/
└── scripts/                     # dev orchestration, packaging, fixture workspace generator
```

Rules: `git-core`, `workspace-core`, `terminal-core`, `commit-msg` never import Electron; the main process may import all of them; the renderer imports only `shared` and `ui`.

### Repository discovery & identity

*Scope: v1.*

Algorithm (runs in main, chunked so the UI can stream results):

1. BFS from the workspace root. Prune at any directory that contains `.git/` (directory) or `.git` (file → linked worktree or submodule pointer). Never descend into `.git`.
2. Skip by default: `node_modules`, `.git`, `.svn`, `.hg`, `.DS_Store`-style noise; skip rules are exactly the union of built-in defaults + workspace config excludes. Symlinks are not followed unless `scan.followSymlinks = true`.
3. Budgets: default `scan.maxDepth = 8`, `scan.maxEntries = 200000` directories; exceeding a budget stops discovery and surfaces a notice with the option to raise it.
4. Confirmation pass: candidate directories are confirmed as repositories in the git worker pool via one `git rev-parse --git-dir --show-toplevel --is-bare-repository --git-common-dir` per candidate; results populate the registry.
5. Worktree linking: for each confirmed repository, `git worktree list --porcelain` yields main + linked worktrees (path, branch, locked, prunable). Linked worktrees inside the workspace are matched by realpath and attached to the parent repo; ones outside are shown only if `view.showExternalWorktrees` is on.
6. Submodule detection: a repository containing `.gitmodules` is flagged; submodule status is read lazily on expand (`git submodule status`), never during initial scan.
7. Incremental discovery: the workspace root and first-level directories are watched shallowly; create/rename events re-run a scoped mini-scan of the affected subtree only.

Identity: `repoId` = realpath(git common dir), stable across moves of worktree folders; the registry stores `relPath`, `gitDir`, `commonDir`, `kind` (`repository | worktree | bare`), `parentRepoId`.

Nested repositories inside another repository's working tree are allowed and shown as parent/child; the parent's own `git status` behavior (embedded-repo warnings) is surfaced, not guessed at.

### Git execution layer (`git-core`)

*Scope: v1.*

- One primitive: `runGit(args, { cwd, env, signal, onStdout }) → { code, stdout, stderr }`. Spawn with argument arrays only — never shell interpolation; paths are passed after `--`.
- Environment hardening per call: `GIT_OPTIONAL_LOCKS=0` for read-only commands, `GIT_TERMINAL_PROMPT=0` (no hanging credential prompts; auth failures surface as structured errors for the UI), `LC_ALL=C` (stable parseable output), `GIT_PAGER=cat`. On Windows, `-c core.longpaths=true` is passed per command (no mutation of user config).
- Concurrency pool: default 6 concurrent processes per workspace, priority queue — interactive operations jump ahead of background status refreshes; background work is cancelable via `AbortSignal` (kills the process tree).
- Parsers live next to the calls: `status --porcelain=v2 -z --branch`, `for-each-ref`, `log` (streamed, NUL-delimited custom format), `worktree list --porcelain`, `submodule status`, `stash list`, `rev-list --count`. All parsers tested against fixture repositories including CJK paths, spaces, newlines in file names.
- Operation models: each mutating operation is defined once as `{ preconditions, command plan, backupRef?, conflictBehavior, postValidate }` so the UI (context menus, graph, palette) triggers the same code path. Conflict detection (exit codes + git-dir state files) is uniform.
- Credential flows: rely on the system credential helper / SSH agent first; optionally an in-app askpass helper (`GIT_ASKPASS`) with a secure prompt (credentials are never logged). Push/pull failures map to typed errors (auth / non-fast-forward / network / hook-rejected).
- Hooks: executed by Git itself, output streamed into the operation dialog; in untrusted workspaces suppressed via `core.hooksPath` override.

### Status model & refresh lifecycle

*Scope: v1.*

`RepoStatus` produced per repository:

```
head { ref, sha, detached, unborn } · upstream { ref, ahead, behind }
staged[] · unstaged[] · untracked[] · conflicted[]        (path + change kind; renames resolved)
operation: none | merge | rebase | rebase-interactive | cherry-pick | revert | bisect
stashCount · worktrees[] (branch, path, locked/ prunable) · submodulesPresent: bool
```

Refresh rules:

1. Event-driven first; a 250–300 ms debounce coalesces bursts (a big checkout fires thousands of events).
2. Cheap-skip: before re-running `git status`, stat `index` (mtime + size), `HEAD`, and the operation-state marker files; unchanged ⇒ reuse cached status.
3. Untracked files: `--untracked-files=normal` by default; `all` is a per-repo opt-in. Repositories with pathological untracked counts get a capped list plus "show more" instead of a frozen refresh.
4. Background warm-up: on workspace open, repositories are refreshed in priority order (visible rows first, expanded nodes, then the rest) at pool concurrency; results stream to the renderer in batches through a throttled channel (≤ 30 UI updates/s).
5. Safety-net polling (default 60 s, configurable, default off when watchers are healthy) covers network drives and platforms with watcher limits.

### File watching

*Scope: v1.*

- Implementation: `@parcel/watcher` (native backends: ReadDirectoryChangesW / FSEvents / inotify), one subscription set per repository:
  - the repo's git dir, `depth: 2`, interest filter: `HEAD`, `index`, `ORIG_HEAD`, `MERGE_HEAD`, `rebase-merge/**`, `rebase-apply/**`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`, `refs/**`, `packed-refs`, `stash`, `BISECT_*`.
  - the working tree only for directories currently expanded in the file tree (LRU cap ~2000 watched directories, released on collapse), interest: create/delete/rename/change.
- Workspace root shallow watch (`depth: 2`) for discovery only.
- Event routing: git-dir index/HEAD/refs → invalidate repo status; working-tree events → invalidate the explorer subtree and (if the repo's dirty state is likely affected) schedule a debounced status refresh.
- Degradation: on watcher error / network filesystem detection, that scope falls back to interval polling with backoff; the status bar shows a subtle "polling" indicator for affected repositories.
- Budgets: total watcher count is bounded (repositories × 1 + expanded dirs); on Linux, exceeding the inotify budget degrades the newest subscriptions to polling and notifies once.

### IPC contract

*Scope: v1.* All channels are typed in `packages/shared` and validated with zod on the main side. Naming: `domain:action`. Requests are `invoke` (promise); streams are events over a throttled channel; terminal data uses a dedicated `MessagePort`.

| Channel | Kind | Signature (draft) |
|---|---|---|
| `workspace:open` | invoke | `(rootPath) → WorkspaceDescriptor` |
| `workspace:scan` | event stream | `discovered: RepoRecord[]` (chunked), `scan:done` |
| `workspace:reposChanged` | event | registry diffs (added/removed/updated) |
| `git:status` | invoke | `(repoId, { refresh?: boolean }) → RepoStatus` |
| `git:statusChanged` | event (batched) | `{ repoId, status }[]` |
| `git:op:run` | invoke + progress events | `(repoId, OpRequest) → OpResult`; `git:op:progress` stream |
| `git:log:read` | invoke | `(repoId, LogQuery, page) → { commits, hasMore }` |
| `git:diff:read` | invoke | `(repoId, DiffRequest) → DiffPayload` (text/binary/image) |
| `fs:tree:read` | invoke | `(dirPath) → DirEntry[]` |
| `fs:file:read/write` | invoke | path + content/BLOB, external-change guard |
| `term:create/write/resize/dispose` | invoke + MessagePort | profile-resolved session |
| `commitmsg:generate` | invoke + stream | `(repoId, { provider }) → streamed draft` |
| `settings:get/set/onDidChange` | invoke + event | scoped (user/workspace) |
| `trust:query/grant` | invoke | workspace trust state |

### Persistence

*Scope: v1.*

**User-authored JSON** (never mutated with comments stripped; written atomically; JSON-schema-validated with editor autocomplete via `$schema`):

`.gitreedesk/workspace.json` (workspace root — may be committed):

```jsonc
{
  "$schema": "https://gitreedesk.dev/schemas/workspace.json",
  "name": "acme",
  "exclude": ["content/中文文档", "**/fixtures/**"],
  "scan": { "maxDepth": 8, "followSymlinks": false },
  "groups": [{ "name": "Backend", "match": ["backend/*"] }]
}
```

`.gitreedesk/terminal.json` (any directory — cascades, nearest wins per key; see the terminal section).

`.gitreedesk/settings.json` (workspace-scope settings overrides; user-scope lives in `userData/settings.json`).

`userData/keybindings.json` (user shortcut overrides).

**SQLite cache** (`userData/cache.db`, schema versioned, auto-migrated; corrupted ⇒ deleted and rebuilt, never a user-facing error):

```sql
CREATE TABLE workspaces   (id INTEGER PRIMARY KEY, root TEXT UNIQUE, name TEXT, last_opened_at INTEGER, trusted INTEGER);
CREATE TABLE repos        (id INTEGER PRIMARY KEY, workspace_id INT, rel_path TEXT, git_dir TEXT, common_dir TEXT,
                           kind TEXT, parent_repo_id INT NULL, name TEXT, UNIQUE(workspace_id, rel_path));
CREATE TABLE repo_cache   (repo_id INTEGER PRIMARY KEY, status_json TEXT, refs_json TEXT, updated_at INTEGER);
CREATE TABLE commits_cache(repo_id INT, sha TEXT, parents TEXT, author TEXT, ts INTEGER, subject TEXT, refs TEXT,
                           PRIMARY KEY(repo_id, sha));
CREATE TABLE ui_state     (key TEXT PRIMARY KEY, value TEXT);   -- recent workspaces/files, expanded nodes, graph prefs
CREATE TABLE oplog        (id INTEGER PRIMARY KEY, repo_id INT, op TEXT, backup_ref TEXT NULL, at INTEGER, undo_state TEXT);
```

### Security & trust model

*Scope: v1.*

- Renderer: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, strict CSP, `will-navigate`/`setWindowOpenHandler` deny-by-default; all external links open in the OS browser.
- All file and Git access goes through main-process services; renderer-supplied paths are resolved and validated against the workspace root (plus explicitly registered external worktree paths) before use.
- No shell string interpolation anywhere in the Git layer or terminal quick commands (argument arrays only). Quick commands are **never auto-run**.
- Untrusted workspace gating governs hooks, quick commands, and (future) tasks.
- LLM commit generation is off by default; enabling it requires explicit configuration, and each request shows a "sends staged diff to \<host\>" disclosure in the UI and in settings. API keys are stored with `safeStorage` (OS keychain); on Linux without a keyring, the app degrades to session-only keys with a clear notice rather than plaintext.
- Secrets never appear in logs, crash reports, or the operation log.

### i18n, theming, keyboard-first, motion

*Scope: v1.*

- **i18n**: react-i18next; English strings are the source (`t('workspace.emptyState')` with co-located `locales/en/…json`); locale namespaces per feature area; `Intl.DateTimeFormat`/`NumberFormat` for presentation; locale switch applies live without reload; a dev-only pseudo-locale (`en-XA`) inflates strings to catch truncation. Lint rule fails CI on string literals in JSX.
- **Theming**: three modes — `system | light | dark` (system is the default and follows OS live). Design tokens are CSS variables consumed by Tailwind v4; a Monaco theme pair (light/dark) is generated from the same tokens so editor and chrome never drift. Dark mode is designed first, not derived.
- **Keyboard-first** — invariants: every feature reachable via command palette; no operation is mouse-only; focus is never stolen (terminal/editor/dialog focus rules in the UX blueprint); animations ≤ 150 ms, interruptible, never gate focus or input; `prefers-reduced-motion` respected; visible focus rings everywhere.
- **a11y baseline**: Radix primitives, full tab order through all panels, all tree/list views navigable with arrows/Enter/Space, status conveyed by icon + color + tooltip (never color alone).

---

## Features

### Workspace open & recent list

*Scope: v1.* Welcome view with recent workspaces (from `ui_state`), "Open folder…" dialog, and drag-a-folder-onto-window. Single window per app instance in v1. Opening a workspace: register in SQLite → show cached tree immediately if present → start incremental scan + background status warm-up. First open shows the trust prompt. Workspace switching is in-place (no restart). Closing keeps watch state only for the active workspace; other workspaces are dropped.

### Trees: Explorer view & Repos view

*Scope: v1.*

Two coordinated views over the same registry:

- **Explorer view** — the real filesystem tree: folders as-is, repositories marked with a badge (branch name or short-sha), worktree folders marked with a worktree glyph. Lazy directory reads; expanded-directory watching. File operations: new file/folder, rename, delete (moves to OS trash via `shell.trashItem` — reversible), reveal in OS file manager, copy path, copy relative path, "Open in VSCode", "Open terminal here", "Compare two selected files"; rows inside a repository also offer "Open commit graph".
- **Repos view** — the logical view: groups (configured or derived from the first path segment), repositories as first-class rows showing name, current branch/ref, badges, and children nested: **linked worktrees** (with their own branch) and **submodules** (initialized or not) appear under their main repository; external worktrees appear greyed with their absolute path when enabled.

Badges & view options: each badge type is individually toggleable — `dirty dot`, `ahead/behind counts`, `stash count`, `in-progress operation`, `detached HEAD`, `submodules pending`. Quick filters: "only dirty", "only ahead/behind", "only worktrees", plus a per-repo checkbox set deciding which repositories contribute to the SCM view and to the workspace activity timeline. Repo rows support multi-select for batch operations (fetch all selected, pull all, open terminals) and carry a row action button that opens the same menu as the row context menu.

Both views render with virtualization (TanStack Virtual) and keyboard navigation (↑/↓, ←/→ collapse/expand, Enter open, Space stage-toggles in SCM only).

### Worktrees first-class

*Scope: v1.*

- **Display**: linked worktrees are nested under their main repository in the Repos view, labelled `<branch> @ <path>`; the main worktree shows a "main" marker.
- **Create**: dialog with source repository, new-or-existing branch picker (existing branch gets a "already checked out elsewhere" guard — Git forbids the same branch in two worktrees), base ref for new branches, target path with a configurable template. Default template: `{worktreeRoot}/{repo}_{branch-slug}` where `branch-slug` replaces `/` with `-` (e.g. `__worktree__/mobile-app_worktree-feat-dark-mode` — `worktreeRoot` defaults to `<workspace>/__worktree__`, path template itself is configurable). New `__worktree__` roots are auto-excluded from discovery noise and shown under the parent repo instead.
- **Remove / prune / lock / unlock** are exposed; **move** is *Later*. Remove refuses on a dirty worktree unless forced (with confirm + backup ref); pruning runs on demand and after fetch.
- Worktree rows are fully operable: every Git feature works on the worktree's repository context with that worktree's working tree.

### Git operations

*Scope: v1.* All operations are defined once in `git-core` and surfaced uniformly in context menus, buttons, command palette, and the graph. Every destructive operation gets a backup ref + Undo affordance.

**Files & staging**

| Op | Notes |
|---|---|
| Stage / unstage file | also directory granularity |
| Stage / unstage **hunk** | patch application to the index; from the diff view margin and SCM rows |
| Discard changes | modified/renamed: `restore` from index (confirm — irreversible, dialog explains); untracked: **moves file to OS trash** (reversible) |
| Stage all / unstage all | per repository |
| Add to `.gitignore` | from untracked row context menu (append pattern, staged immediately) |

**Commit**

- Commit staged (message box with the generation button), commit with sign-off, amend (keep message / edit message / include working tree), commit-and-push.
- Hook output (pre-commit/prepare-commit-msg) streamed into the commit panel; failures keep the message; untrusted-workspace hook suppression.
- GPG signing: *Later.*

**History editing — a given commit's message / author / date**

- HEAD commit: `commit --amend` with `--author`, `--date`, and (for committer date) `GIT_COMMITTER_DATE` env.
- Any earlier commit (or a batch, in one pass): scripted interactive rebase — rebase `--interactive` up to the target's parent with `GIT_SEQUENCE_EDITOR` marking targets as `edit` (sequence list, not a TTY), then per stop: `git commit --amend --author=… --date=… -m …` (non-interactive `GIT_EDITOR`), then `rebase --continue`. Preconditions: clean worktree (else offer auto-stash), backup ref created, hard warning when the branch is pushed ("rewrites published history" + explicit confirm). After completion: "Undo" restores the backup ref.
- Also supported from the graph context menu on a commit.

**Branch / remote / tags**

- Branch: create (from any ref), rename, delete (guards: unmerged → warning + backup; current branch undeletable), checkout (dirty-tree guard with auto-stash option; detached-HEAD warning with "create branch here" shortcut), set upstream, compare with current (opens diff scope).
- Remote: add/remove/edit URL, fetch (single repo / all repos, prune option, tag-follow option), pull (strategy per repository in workspace settings — `ff-only` by default, or `merge` / `rebase`), push (branch picker; the push dialog lists every remote of the repository with the default one preselected, and several remotes can be selected so **one action reaches them all**, each reporting its own result; set-upstream when publishing, `--force-with-lease` behind a double confirm when history diverged), push tags.
- Tags: list (grouped local/remote), create (annotated/lightweight), delete, push, checkout tag (detached).

**Merge / rebase / cherry-pick / revert / reset / stash / submodules**

- Merge into current: options `--no-ff`, `--squash`, `--ff-only`; conflict flow below.
- Rebase: current onto ref (auto-stash option); interactive rebase with a list editor (rows reorderable with buttons in v1; per-row actions: pick / reword / edit / squash / fixup / drop; drag-ordering is *Later*); continue / skip / abort.
- Cherry-pick: single or range (`A..B`), `--no-commit` option; revert same.
- Reset: `--soft | --mixed | --hard` to any ref (backup ref + confirm for `--hard`; dialog states exactly what will be lost).
- Stash: create (message, include-untracked, keep-index, path subset), list with expandable file lists and diffs, apply / pop / drop (drop creates a backup ref), show.
- Submodules: per-submodule status (initialized, commit drift, dirty), **"Update all" one-click** (`submodule update --init --recursive --jobs <n>` with streamed progress), sync URLs, open-as-repository (navigates the Repos view), add/deinit are *Later*.
- Conflicts (shared flow): operation-in-progress banner (continue/abort/skip), conflicted-file list with per-file **ours/theirs/both** resolution, "open in editor with markers", external merge tool launch (configurable command), mark-resolved, and a before-continue validation ("unresolved conflicts remain" list).

**Operation-in-progress detection** blocks conflicting operations (e.g., cannot rebase during a merge) with an explanatory dialog offering the legal actions.

### Commit graph

*Scope: v1, per repository plus a workspace-wide activity timeline.*

- Opened as a tab per repository (LRU-cached, ~5 alive) from the activity bar, the graph toolbar picker, the Source Control section header, the command palette, the repo row menu, or any Explorer row inside a repository. The toolbar switches the tab to another workspace repository through a repository picker (which also makes it the active checkout) and carries the shared repository action menu (without the graph entry). Data from `git log --all` (configurable default refs) streamed with a custom NUL-delimited format; lanes computed client-side; rendering = virtualized DOM rows + a canvas lane layer (targets 60 fps at 5 000+ loaded rows).
- Row density: `compact` / `normal` / `comfortable` row heights, switchable from the toolbar and from the Appearance settings group (`appearance.graphDensity`, default `normal`).
- Lane column: natural width while the lanes fit, compressed lane spacing rather than a gutter that swallows the commit text, user-resizable by dragging its edge, with the chosen width persisted in the UI state.
- Paging: first page 1 000 commits; older history loads in 2 000-row chunks on scroll; the loaded window stops at 10 000 commits and the toolbar states the cap ("huge repo" mode — `--skip/--max-count` for the window, `rev-list --count` for the total).
- Row content: lane graph, refs (local/remote/tags/HEAD with distinct chips), subject, author, relative date, "incoming/outgoing" markers relative to upstream and current branch; the `comfortable` row height adds a second, smaller line with the first line of the commit body.
- Filters: refs multi-select, author, path (with rename detection off in v1), date range, message text, and "only reachable from current branch".
- Commit details side panel: full message, author + committer (name/email/date), file list with stats; clicking a file opens the commit diff in the editor area.
- Commit actions (context menu, reusing the operation models): checkout, create branch/tag here, cherry-pick, revert, reset here *(soft/mixed/hard)*, copy SHA / ref name, rebase current onto this commit, interactive rebase from this commit, **edit message / author / date** (history editing), select for compare (diff two arbitrary commits).
- **Workspace activity timeline**: a toolbar scope switch (`graph.mode`, persisted in the UI state) replaces the tab body with one merged, virtualized, day-grouped list of recent commits from the repositories the Repos checkbox set selects; the command palette opens it directly. `git:activity` fans the read out over those checkouts (8 at a time), walking each `HEAD` with `--since` / `--author` / `--grep` and a per-repository cap, and reports `failures` and `truncated` so an unreadable or clipped repository is stated rather than silently dropped. Window and filters persist under `graph.activity`; the read is debounced and re-issued when a HEAD inside the scope moves. A row click opens that repository's graph tab and hands it `{gitDir, sha, token}`, so the tab selects, scrolls to and details the commit.

### Editor

*Scope: v1.*

- Monaco with local bundling; tabs (open editors list, dirty indicator, close/close-others), split view *Later*.
- Language features: highlighting for all bundled languages (lazy-loaded contributions); TypeScript/JavaScript hints via the built-in TS worker with best-effort configuration — nearest `tsconfig.json` `compilerOptions` + stdlib; no `node_modules` type resolution in v1 (documented limitation). The **"Open in VSCode"** button (`code --goto <path>:<line>[:<col>]`, command configurable; falls back to reveal-in-OS) is the explicit escape hatch for project-wide IntelliSense/refactoring.
- Save (Ctrl/Cmd+S): atomic write; external-change detection (mtime+hash on focus and before save) → conflict dialog (overwrite / reload / diff). Read-only guard for files > 10 MB (open read-only with confirm); binary files open with a preview (images) or offer open-externally.
- Minimal editing settings only: font size/family, tab size, insert-spaces, word wrap, minimap on/off. This is not an IDE: no format-on-save, no tasks, no multi-root workspaces, no extensions.

### Changes list & diff

*Scope: v1.*

- **SCM view** (activity bar): repository sections — which repositories appear is governed by the per-repo checkboxes in the Repos view; each section shows staged / unstaged / untracked / conflicted groups (each group's visibility individually toggleable), a commit box (message + generate + commit/amend/stage-all), and its in-progress operation banner.
- File rows: status icon (M/A/D/R/U/!/C), staged vs unstaged, hover actions (stage/unstage/discard), multi-select, click → diff.
- **Diff view**: Monaco diff editor (side-by-side ⇄ inline toggle), whitespace-ignore toggle, word-wrap; rename-aware; binary files show size info; images get a 2-up before/after preview (onion slider *Later*); hunk actions from the diff margin: stage hunk / revert hunk; "Compare with…" picker (INDEX / HEAD / any ref / another branch) for a file or a whole repository scope.
- **File history**: per-file `git log` list (rename-follow *Later*), clicking a revision opens that revision's diff for the file.
- Empty states and skeleton loaders follow the UX blueprint.

### Terminal

*Scope: v1.*

- Sessions: node-pty in the pty host, @xterm/xterm in the renderer; multiple terminals (tabs), each pinned to a working directory (repository root / any folder / file's directory); sessions survive renderer reloads; "Open terminal here" from Explorer, Repos, SCM, and diff views.
- Profiles: auto-detected defaults — Windows: PowerShell 7 (`pwsh`) if present, Windows PowerShell, `cmd`, Git Bash (from the detected Git install), installed WSL distros; macOS/Linux: `$SHELL`, plus `bash`/`zsh`/`fish` if present. Each profile: shell path, args, env, cwd template, icon/color. Full env: `{...process.env, ...profile.env, TERM, GITREEDESK_*}` (no inherited `GIT_*` leakage of our own commands).
- **Cascading configuration**: `<any dir>/.gitreedesk/terminal.json`; resolution walks from the workspace root down to the target directory, deeper files override per key; `profiles` and `quickCommands` merge by name (deeper wins). Precedence for selects: nearest file, then workspace settings, then user settings.

```jsonc
// app/.gitreedesk/terminal.json — applies to app/** only
{
  "$schema": "https://gitreedesk.dev/schemas/terminal.json",
  "defaultProfile": "dev",
  "profiles": [{ "name": "dev", "shell": "pwsh", "args": ["-NoLogo"], "env": { "NODE_ENV": "development" } }],
  "quickCommands": [
    { "name": "pnpm dev", "command": "pnpm", "args": ["dev"], "cwd": "{repoRoot}" }
  ]
}
```

- Quick commands: listed in the terminal toolbar, the command palette, and a per-directory picker; `cwd` tokens `{dir}` / `{repoRoot}` / `{workspaceRoot}`; executed as argv (or via `shellCommand: true` for pipes, still never auto-run); disabled entirely in untrusted workspaces.
- Terminal UX: links (URL → browser; `path:line` → editor), multi-line paste warning, scrollback setting, Cmd/Ctrl+C/V semantics per platform. Shell integration (cwd/command tracking in tab titles) is *Later*.

### Commit message generation

*Scope: v1, dual-mode.*

- Pipeline: (1) read staged diff (name-status + numstat + unified hunks, size-capped); (2) detect repository convention — commitlint config files, `.gitmessage` template, and style inference from the last 100 non-merge subjects (conventional-commits pattern `^(type)(\(scope\))?!?:`, prefix style, average length, language of subjects); (3) offline draft — infer type from change nature (file patterns + diff heuristics), scope from common path segment, subject from the dominant change; body bullets from grouped numstat; confidence-based: if no convention is detectable, produce a neutral, descriptive draft rather than guessing; (4) optional LLM provider — OpenAI-compatible base URL + model + key (`safeStorage`), streaming into the commit box, cancelable, strict timeout (default 30 s) with automatic offline fallback and a notice; prompt = convention profile + capped diff + explicit "output only the message" instruction.
- UX: generate button in the commit box (per repository), "regenerate", variant picker when the draft is weak; the draft is always editable and **never auto-commits**; per-request disclosure of what is sent and where (first use per host shows a confirm). Multi-repo batch generation is *Later*.

### Command palette & keybindings

*Scope: v1.*

- Command palette (Ctrl/Cmd+Shift+P) exposes every action with context-aware availability; quick open (Ctrl/Cmd+P) for files across the workspace (respecting excludes) and `>`-mode for commands; "Go to repository" picker (Ctrl/Cmd+R, fuzzy).
- Default bindings (curated v1 set; user overrides in `keybindings.json`; a "Keyboard Shortcuts" reference tab lists defaults + overrides; conflict detection on override):

| Binding (Win/Linux / macOS) | Action |
|---|---|
| Ctrl+Shift+P / ⇧⌘P | Command palette |
| Ctrl+P / ⌘P | Quick open file |
| Ctrl+R / ⌘R | Go to repository |
| Ctrl+Shift+G / ⇧⌘G | Focus Source Control |
| Ctrl+` / ⌃` | Toggle terminal panel |
| Ctrl+Enter / ⌘⏎ | Commit staged |
| Space (in SCM) | Stage/unstage selected file |
| Ctrl+Shift+F / ⇧⌘F | Fetch current repository (context: Repos view ⇒ all selected) |
| F2 | Rename (file or branch, depending on focus) |
| Delete | Delete (file → trash; branch in branch list) |
| Enter | Open / confirm; in graph: commit details |
| Alt+←/→ / ⌥←→ | Editor navigation history |
| Esc | Close transient UI; never closes the editor tab |

### Settings

*Scope: v1.*

- Settings tab: searchable, grouped (Appearance, Editor, Git, Terminal, Commit message, Advanced), each setting showing scope (User / Workspace) and a "copy to workspace" affordance; edits write the JSON files atomically and apply live. A JSON schema ships with the app so hand-edited files get autocomplete.
- Scopes: `userData/settings.json` (user) → `.gitreedesk/settings.json` (workspace overrides) → per-repo overrides map (e.g., `repos: { "backend/api-server": { pullStrategy: "rebase" } }`).
- Key setting groups: appearance (theme mode, density, accent), git (git path override, concurrency, polling interval, default pull strategy, untracked strategy), terminal (default profile), commit message (provider preset, base URL, model, temperature), advanced (log verbosity for support).

### Platform & packaging

*Scope: v1.*

- Targets: electron-builder — Windows (NSIS installer + portable zip), macOS (dmg + zip, arm64 + x64; notarization requires an Apple account — deferred, unsigned builds documented), Linux (AppImage + deb).
- CI: GitHub Actions matrix builds all three platforms; native deps (better-sqlite3, node-pty, @parcel/watcher) ship N-API prebuilds, so no rebuild is forced (`npmRebuild: false`) except node-pty compiled from source on Linux; prebuilt binaries and the Electron downloads are cached; a smoke test boots the packaged app and opens a fixture workspace.
- Publishing: installer artifacts are uploaded only by a manually run (`workflow_dispatch`) workflow. A release is therefore cut by bumping the version in the root, app and package manifests, pushing `main`, running the workflow manually, and attaching the downloaded `installers-*` artifacts to a GitHub Release — the About dialog's download link points at that page. Only the host platform can be packaged locally: the Linux targets need tooling that is unavailable on a Windows host, and macOS targets need a macOS host.
- Platform integration: native menu bar on macOS (app menu + edit menu with standard clipboard roles — required for Cmd+C/V to work at all on macOS), frameless window with custom titlebar on Windows/Linux (native frame fallback setting); keyboard shortcuts use Cmd on macOS everywhere.
- Data locations: `%APPDATA%/GitTreeDesk`, `~/Library/Application Support/GitTreeDesk`, `~/.config/GitTreeDesk` (`settings.json`, `keybindings.json`, `cache.db`, `logs/`).
- Auto-update (electron-updater) is *Later*; v1 ships a manual download link in the About dialog.

---

## UX blueprint

Layout (VSCode-familiar, denser, keyboard-first):

```
┌ Titlebar: workspace name · window controls · (menu on macOS) ──────────────┐
│ Activity │ Primary sidebar            │ Editor area (tabs)                 │
│ bar      │  ▸ Explorer                │  • file  • diff  • graph          │
│  Tree    │  ▸ Repos                   │  • settings  • keyboard refs      │
│  SCM     │  ▸ Source Control          │                                   │
│  Graph   │  ▸ Graph                   ├───────────────────────────────────┤
│  Term    │                            │ Secondary sidebar (commit/file    │
│  ⚙       │                            │  details, repo info) — toggleable │
├──────────┴────────────────────────────┴───────────────────────────────────┤
│ Bottom panel: Terminal │ Output (git op logs)          — collapsible      │
├───────────────────────────────────────────────────────────────────────────┤
│ Status bar: repo · branch · sync · operation · terminals · watcher · theme│
└───────────────────────────────────────────────────────────────────────────┘
```

Interaction rules:

- **States**: every async surface has skeleton → content → empty state (with a primary action) → error state (with retry + "copy details"); never a spinner without text when the wait exceeds ~800 ms.
- **Focus discipline**: opening dialogs/panels never scrolls or reflows the tree underneath; notifications (toasts) never steal focus; Esc cancels the topmost transient layer only.
- **Motion policy**: tokens `--motion-fast: 120ms`, `--motion-base: 150ms`; fades/slides only (no layout-thrashing animations); list virtualization uses no enter animations; `prefers-reduced-motion: reduce` ⇒ 0 ms.
- **Badge legend** (also in onboarding): ● dirty · ↓n/↑n behind/ahead · ⚑ stash · ⟳ operation in progress · ⚯ worktree · ◇ submodule pending · detached marker.
- **Density**: comfortable by default, compact option; row height 22 px compact / 28 px comfortable.
- **Onboarding**: first-run tour (open a folder, trust prompt, hotkeys card) skippable, shown once.

## Milestones

Each milestone ends in a demo-able outcome. Sizes are relative (S ≪ L), not calendar promises.

| Milestone | Size | Delivers | Demo |
|-----------|------|----------|------|
| Skeleton | S | pnpm workspace, Electron shell, IPC contract + zod, settings, theming (system/light/dark), i18n wiring (en/zh-Hans), trust prompt, CI matrix stub | App opens, switches theme/locale live |
| Workspace & trees | M | Discovery + registry (SQLite), Explorer + Repos views (virtualized), badges + view options, watcher skeleton (git-dir watching), status model + warm-up scheduler | A 50+ repo workspace opens; full tree ≤ budget; statuses stream in; CJK paths correct |
| Changes & diff & commit | M | SCM view (multi-repo, toggles), hunk/file staging, discard (trash for untracked), Monaco diff (side-by-side/inline), commit box, file history | Complete local commit flow inside the app |
| Core Git operations | L | Branches, remotes, fetch/pull/push, merge/rebase(interactive), cherry-pick, revert, reset, stash, tags, conflict flow, op-in-progress banner, backup refs + undo | SourceTree-parity for everyday flows; conflict resolution end-to-end |
| Worktrees & submodules | M | Worktree CRUD + grouping + templates; submodule status + "Update all" (streamed); external worktree support | Create a worktree from the UI; fix the workspace's submodules in one click |
| Commit graph | L | Graph tab (lanes, virtualization, paging), filters, commit details, commit actions, **history editing** (message/author/date) with backup + undo | Edit an old commit's message/author/date and undo it |
| Editor & terminal | L | Monaco tabs + save/conflict handling + "Open in VSCode"; pty host + xterm, profiles, cascading terminal.json, quick commands, tabs | Per-directory terminal config; quick command launch |
| Commit generation | M | Convention detection, offline drafts, LLM provider (opt-in, streaming, keychain), settings UI | One-click draft from staged diff in both modes |
| Polish & release | M | Keyboard cheatsheet, perf pass vs budgets, packaging all platforms, About/update page, onboarding | Installers for the three platforms (macOS unsigned until notarization is wired up) |

Ordering rationale: the changes/commit flow comes before core Git operations (a working commit flow makes the tool usable immediately and validates the operation-model design); the commit graph follows the core operations because its actions reuse them; editor and terminal come after the Git core because "Open in VSCode" covers editing meanwhile.

## Performance budgets

Budgets are release gates for v1, measured on the reference scenario on a mid-range 2024 laptop, SSD, Windows first.

| Metric | Budget | Measurement |
|---|---|---|
| Cold start → interactive window | ≤ 2.0 s | warm start (cached); cold first-ever launch ≤ 4 s |
| Workspace open → first full tree paint | ≤ 3.0 s (cached registry: immediate) | dev perf overlay + CI perf harness on a generated fixture workspace |
| All repo statuses warm (55 repos) | ≤ 15 s background, UI never blocked | streamed; visible-first priority |
| Single-repo status refresh (typical, < 5 k files) | ≤ 300 ms p50, ≤ 800 ms p95 | perf overlay histogram |
| Status refresh skip (no changes, fingerprint hit) | ≤ 5 ms | stat-only path |
| Tree/list scroll | 60 fps at 5 000 rows loaded | devtools FPS meter in CI harness |
| Graph first page (10 k-commit repo) | ≤ 1.5 s to first paint | open-graph action → rows painted, single-repo 10 000-commit scale fixture |
| Graph streamed page (2 000 commits) | ≤ 500 ms, frame pacing stays at 60 fps | same fixture, scroll-to-bottom chunk timing |
| Terminal input → echo | ≤ 50 ms p95 | xterm.js marker timing |
| Memory (idle, 55 repos) | ≤ 600 MB RSS total | measured after warm-up |
| Installer size | ≤ 130 MB (win x64) | electron-builder output |

Budget failures are treated as bugs, not polish; the dev overlay (toggleable, showing scan/status/op latencies and watcher counts) ships in dev builds. `pnpm perf-budget` and `pnpm perf-graph` measure the table against the generated fixture workspace — the first the workspace rows (tree, warm-up, status latency, fingerprint skip, RSS), the second the two graph rows on a single-repo 10 000-commit scale fixture — each driving a built app through an isolated profile and exiting non-zero on a miss.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Windows long paths (> 260 chars) | per-command `-c core.longpaths=true`, `\\?\`-prefixed Node fs calls, documented guidance for users who hit nested-limit cases |
| Unicode/CJK paths (e.g. `content/中文文档`) | all porcelain parsing on `-z` NUL output with `core.quotepath` neutralized; fixtures include CJK/space/newline paths in tests |
| Credential prompts hanging operations | `GIT_TERMINAL_PROMPT=0` + typed auth errors + in-app askpass; SSH agent passthrough |
| Git hooks running from untrusted workspaces | trust gating + `core.hooksPath` suppression |
| inotify watch limits on Linux | bounded watch plan, graceful degradation to polling with one-time notice |
| One giant repository dominates cost | per-repo untracked strategy, status caps, graph "huge repo" windowing mode |
| node-pty / better-sqlite3 native builds vs Electron ABI | `electron-rebuild` in CI with prebuilt caching; packaged-app smoke test per platform |
| Monaco TS hints are file-level, not project-wide | explicit product framing, the "Open in VSCode" escape hatch, LSP bridge on the later roadmap |
| History rewrite corrupts a branch | backup refs + guarded preconditions + undo; integration tests on fixture repos |
| Windows AV / file locks on `.git` during ops | retry with backoff on EBUSY/EPERM; user-facing "another process holds this repo" diagnostics |
| Git version spread (2.23…latest) | startup version probe + feature gating; warn below 2.36 |
| Watcher event storms on big checkouts | 250–300 ms debounce + coalescing; refresh budget per repo |
| CRLF / attributes surprises | never normalize; respect `core.autocrlf`/`.gitattributes` (Git does that for us); display raw diff with whitespace toggle |
| `safeStorage` weak fallback on Linux without keyring | session-only keys + explicit notice (never plaintext persistence) |

## Open questions

- **Bundled portable Git** on Windows/macOS for zero-dependency installs — decide after first user feedback (v1 requires system Git).
- **Auto-update channel** and hosting (GitHub Releases vs object storage) — the mechanism itself is post-v1; v1 links to the download page from the About dialog.

## Appendices

### User-scope settings example (`settings.json`)

```jsonc
{
  "appearance": { "theme": "system", "density": "comfortable" },
  "locale": "en",
  "git": {
    "path": null,                      // null = auto-detect
    "concurrency": 6,
    "pollIntervalSec": 60,
    "defaultPullStrategy": "ff-only",  // ff-only | merge | rebase
    "untrackedStrategy": "normal"      // normal | all (per-repo override)
  },
  "commitMessage": {
    "provider": "offline",             // offline | openai-compatible
    "baseUrl": null, "model": null, "temperature": 0.2
  },
  "editor": { "fontSize": 13, "fontFamily": null, "tabSize": 2, "minimap": false },
  "terminal": { "defaultProfile": null }
}
```

### IPC channel draft

The canonical list lives in `packages/shared/src/ipc.ts`.

### Default keybindings

The canonical list lives in `apps/desktop/src/renderer/src/keymap/defaults.ts`.

### Competitor notes (UX inspiration, not copying)

- **GitKraken** — repo tab organization; our difference: tree-of-repos instead of tabs.
- **Fork** — diff viewer ergonomics (hunk hit areas, image diff); our difference: multi-repo SCM.
- **Tower** — multi-repo fetch/pull batching; our difference: workspace-first discovery.
- **GitButler** — honest, preview-before-apply operation UX; borrowed: backup refs + explicit preconditions.
- **VSCode** — command palette and keyboard discipline; our difference: everything-is-lazy.

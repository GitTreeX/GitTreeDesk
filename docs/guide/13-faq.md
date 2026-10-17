# 13 · FAQ & Troubleshooting

> Status: ✅ Implemented · Scope: v1 · Engineering: [`../spec.md`](../spec.md)

## Setup & platform

### GitTreeDesk says Git is missing or too old

GitTreeDesk drives the **system Git** (page README → Prerequisites). The requirement is **≥ 2.23**; versions below **2.36** work but show a warning, because some conveniences rely on newer Git behavior.

- If Git is installed but not found, set **Settings → Git → Path** to the exact executable (`git.exe` / `git`). The change applies immediately.
- If Git is genuinely missing, install it from [git-scm.com](https://git-scm.com) and restart the app.

### macOS refuses to open the app

v1 publishes **unsigned macOS builds** (notarization requires an Apple developer account and is deferred). To open for the first time: **right-click the app → Open → Open**. After that it launches normally, or allow it via System Settings → Privacy & Security → "Open Anyway".

### Where are my settings, and how do I reset everything?

| What | Where |
|---|---|
| User settings, keybindings | `settings.json` / `keybindings.json` in the app's user-data folder |
| Workspace settings, discovery, terminal config | `<workspace>/.gitreedesk/` (`settings.json`, `workspace.json`, `terminal.json`) |

The **cache database** (statuses, operation log, trust decisions) is disposable — it can be deleted at any time and is rebuilt on the next launch with a full rescan. Note that clearing it also **forgets trust decisions** for all workspaces (you will be asked again).

### My shell isn't in the terminal profile list

Add a custom profile in `.gitreedesk/terminal.json` (page 11) — profiles are plain command + args definitions, so any shell works.

## Workspace & discovery

### A repository is missing from the tree

Check, in order (page 01):

1. **`exclude`** — the path (or a matching glob) may be excluded in `.gitreedesk/workspace.json`.
2. **Depth** — discovery stops at `scan.maxDepth` (default 8 levels).
3. **Budget** — the 200 000-directory scan budget may have been hit; a notice appears and offers "Raise limit and rescan".
4. **Symlinks** — not followed by default.
5. **Nested repos** — a repository *inside* another repository's working tree is shown **nested under its parent**, not at the top level; look inside the parent row.

Repositories created or deleted while the app is open are picked up automatically within a few seconds — a manual rescan is rarely needed.

### Statuses feel stale, or I see a "polling" indicator

File watching is automatic for repositories and expanded folders. When a folder lives on a network drive, or the OS watcher limit is reached (Linux inotify), affected repositories fall back to **interval polling** — the status bar shows a warning chip reading **"Live updates are paused in some folders"**, and hovering names the folders. Interval: **Settings → Git → Fallback polling interval** (default 60 s).

## Operations & recovery

### I ran a rebase / reset --hard / branch delete by mistake. Can I undo?

Yes. Before every destructive operation — reset `--hard`, rebase (including interactive), history rewrite, stash drop, worktree force-remove — GitTreeDesk creates a **backup ref** under `refs/gitreedesk/backup/…` pointing at the state that is about to be replaced (page 06). A branch delete backs up the branch tip when the branch is **not merged into HEAD**; a merged branch is recoverable from the recorded tip instead.

- The toast right after the operation offers **Undo**.
- Any time later: repository context menu → **"Restore from Backup…"** lists the backups with the operation, the time, and the ref they restore, each with a **Restore** action. Restoring backs up the current state first, so a restore is itself undoable.
- Backup refs are invisible in normal branch/tag lists (they never clutter the graph), but they are real refs in the repository — nothing is lost until the backups themselves are pruned.

### An operation stopped in the middle (merge, rebase, cherry-pick…)

This is the normal conflict flow, not a crash. An operation banner appears with **Continue / Skip / Abort** and the conflicted-file list. Everything is reachable from the banner; there is no need to drop to the command line — but if you do, GitTreeDesk notices and updates the banner (page 06).

### Push or pull never asks for my password — it just fails

By design: operations run with credential prompts **disabled**, so Git can never hang a background refresh waiting for hidden input. Authentication uses your existing setup first — system credential helper (e.g. the one bundled with Git for Windows), SSH agent. GitTreeDesk never shows its own password dialog: when credentials are missing, the operation fails with a typed error (authentication, non-fast-forward, network, or rejected-by-hook), each with its own next action, and the raw Git output is in the Details drawer.

If auth fails persistently for HTTPS remotes, configure a credential helper once in your global Git config (the same one you use from the terminal).

### The commit box says "Git hooks are disabled in this workspace"

The workspace is **not trusted** yet (page 01). In untrusted workspaces, Git hooks are suppressed (`core.hooksPath` override) so opening a stranger's folder cannot execute their `pre-commit` scripts; terminal quick commands are disabled too. If this is your own workspace, run **"Trust This Workspace"** from the command palette — hooks then run normally, with their output shown in the commit box.

### The ✨ generate button produced nothing

- The generator works on the **staged diff** — stage something first (page 04).
- **Offline mode** (default) always works but only finds conventional formats; if your project has no detectable convention, it produces a minimal draft.
- **LLM mode** needs a provider configured in Settings → Commit message. Check that the base URL/model were saved, and that the host is reachable — timeouts (30 s) fall back to the offline draft. Your API key never leaves the OS keychain (below).

### Where is my LLM API key stored?

With `safeStorage` in the **OS keychain** (Keychain / Credential Manager / libsecret). On Linux without a keyring service, keys are kept **session-only** with a clear notice — never written to disk in plaintext. LLM generation is off by default, and the **first request to a host** asks you to confirm that the staged diff will be sent to it (page 04). In offline mode nothing ever leaves your machine.

## Performance & display

### The app feels slow with a huge repository

- **Untracked files** are usually the cause. Repositories with enormous untracked trees (build output, downloaded models) should stay on the default `untrackedStrategy: "normal"` (Settings → Git): the per-repo `"all"` option lists every untracked file individually and only pays off in small repositories.
- **Graph**: very large histories load in pages (1 000 rows, then 2 000-row chunks); the graph tab shows a loading indicator while the next page is on the way. Filters reduce what needs to load (page 09).
- Performance budgets (first tree, status refresh, graph scroll) are **release gates** measured on the reference scenario — a sluggish feel on a workspace like this is treated as a bug. When reporting, raise **Settings → Advanced → log verbosity** and include the Output panel content.

### Diffs are full of CRLF / whitespace noise

GitTreeDesk **never normalizes line endings**: it respects `core.autocrlf` and `.gitattributes` exactly as Git does, and shows the raw diff. The diff view has a **whitespace-ignore toggle** for reviewing noisy changes — it affects the display only, never what gets staged (page 03).

## Docs & feedback

### How do I request a feature or report a bug?

This guide **is** the feature backlog (page README → "How this guide drives development"):

- Want a behavior changed? **Edit the relevant page** — defaults, interactions or edge cases — and ask the AI: *"implement `<page>` § `<section>`"*.
- Post-v1 ideas: mark them `[Later]` inline.
- Bugs: describe expected vs. observed behavior in the page's section; the AI implements the fix and updates the **Status** line. Contradictions with [`../spec.md`](../spec.md) are flagged and resolved there first.

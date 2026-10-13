# 11 · Terminal

> Status: 🚧 Planned · Scope: v1 · Engineering: [`../spec.md`](../spec.md)

## Opening terminals

- **"Open terminal here"** from the Explorer, Repos, Source Control and diff views — the terminal starts in the selected context: a repository root, any folder, or a file's directory.
- `` Ctrl+` `` toggles the terminal panel; the panel toolbar has a **+** button opening a terminal for the active repository.
- Terminals open as **tabs** in the bottom panel; each tab shows its working directory and profile. Multiple terminals per repository are fine.
- Sessions are **not** lost when the window reloads (they live in a separate process) — scrollback included.

## Shell profiles

Default profiles are auto-detected and can be edited in Settings → Terminal:

| Platform | Detected profiles |
|---|---|
| Windows | PowerShell 7 (`pwsh`, if installed) · Windows PowerShell · `cmd` · Git Bash (from the detected Git install) · installed WSL distributions |
| macOS / Linux | `$SHELL` (default), plus `bash`, `zsh`, `fish` if present |

Each profile defines: shell path, arguments, environment variables, a cwd template, and an icon/color used in the tab strip.

## Per-directory configuration — `.gitreedesk/terminal.json`

Create this file at any level of the workspace to configure terminals **for that directory and everything below it**:

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

**Resolution rules** — predictable and explicit:

- Config files are collected from the workspace root down to the target directory; **deeper files override per key** (like `.editorconfig`).
- `profiles` and `quickCommands` **merge by name** — the deeper definition of the same name wins; new names are added.
- A terminal opened at `app/mobile-app/src/` resolves all `.gitreedesk/terminal.json` files from the workspace root down to `src/`, with workspace settings (`.gitreedesk/settings.json`) as the base and user settings as the final fallback — the nearest file wins for each key.

## Quick commands

Defined in `terminal.json` (any level, same cascade) and listed in the terminal toolbar, the command palette, and a per-directory picker:

| Field | Meaning |
|---|---|
| `name` | Label shown in menus |
| `command` + `args` | Executed as argv — **no shell interpretation** |
| `cwd` | Starting directory; tokens: `{dir}` (the terminal's directory), `{repoRoot}`, `{workspaceRoot}` |
| `shellCommand` | `true` runs the command line through the shell (needed for pipes, `&&`, env expansion) |

**Safety rules** (non-negotiable):

- Quick commands **never run automatically** — only from an explicit click or palette invocation.
- In an **untrusted workspace** quick commands are disabled entirely (page 01).
- Quick commands are plain files under `.gitreedesk/` — review them like code before trusting a workspace.

## Terminal behavior

- Links: URLs open in the OS browser; `path:line`/`path:line:col` opens the file at that line in the editor.
- Pasting multi-line content shows a warning (preventing accidental execution of pasted scripts).
- Scrollback length is configurable (default 5 000 lines). `Ctrl/Cmd+C` copies when there is a selection, otherwise sends SIGINT — standard terminal semantics per platform.
- Shell integration (tab titles tracking the running command and cwd) is [Later].

## Edge cases

- A configured profile whose shell executable is missing is greyed with a "not found" hint and links to the profile's settings.
- WSL profiles start in the corresponding Windows path mapping when the directory is on a mounted drive.

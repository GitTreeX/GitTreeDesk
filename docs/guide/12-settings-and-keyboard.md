# 12 · Settings & Keyboard

> Status: 🚧 Planned · Scope: v1 · Engineering: [`../spec.md`](../spec.md) §F10, §F11, AD-10

## Settings

The Settings tab (activity bar → ⚙) is searchable and grouped: **Appearance, Editor, Git, Terminal, Commit message, Advanced**. Each setting shows its scope (User / Workspace) and offers **"copy to workspace"**; edits apply live — no restart.

### Where settings live

| File | Scope | Notes |
|---|---|---|
| `settings.json` in the app's user-data folder | User (this machine) | Main file; hand-editable with autocomplete via JSON schema |
| `<workspace>/.gitreedesk/settings.json` | Workspace overrides | Committable; overrides the user file per key |
| `<dir>/.gitreedesk/terminal.json` | Directory subtree | Terminal profiles + quick commands (page 11) |
| `keybindings.json` in the app's user-data folder | User | Shortcut overrides (below) |
| `<workspace>/.gitreedesk/workspace.json` | Workspace | Discovery & groups only (page 01) |

Resolution order: **workspace > user** (per key); per-repo overrides live in the workspace file under a `repos` map.

### Settings reference (excerpt)

```jsonc
{
  "appearance": { "theme": "system", "density": "comfortable" },  // theme: system | light | dark
  "locale": "en",                                                 // en | zh-Hans
  "git": {
    "path": null,                    // null = auto-detect; set for custom Git installs
    "concurrency": 6,                // parallel Git processes
    "pollIntervalSec": 60,           // fallback polling when watchers are unhealthy
    "defaultPullStrategy": "rebase", // ff-only | merge | rebase
    "untrackedStrategy": "normal"    // normal | all (per-repo override supported)
  },
  "commitMessage": {
    "provider": "offline",           // offline | openai-compatible
    "baseUrl": null, "model": null, "temperature": 0.2
  },
  "editor": { "fontSize": 13, "fontFamily": null, "tabSize": 2, "insertSpaces": true, "wordWrap": false, "minimap": false },
  "terminal": { "defaultProfile": null }
}
```

Per-repository overrides (in workspace settings):

```jsonc
"repos": {
  "backend/api-server": { "pullStrategy": "rebase" },
  "website/marketing-site": { "untrackedStrategy": "all" }
}
```

## Keyboard

Everything is reachable in the **command palette** (`Ctrl/Cmd+Shift+P`) — typing filters actions; context-dependent actions appear only when applicable.

### Default shortcuts (complete v1 set)

| Windows / Linux | macOS | Action |
|---|---|---|
| Ctrl+Shift+P | ⇧⌘P | Command palette |
| Ctrl+P | ⌘P | Quick open file |
| Ctrl+R | ⌘R | Go to repository |
| Ctrl+Shift+G | ⇧⌘G | Focus Source Control |
| Ctrl+` | ⌃` | Toggle terminal panel |
| Ctrl+Enter | ⌘⏎ | Commit staged |
| Space | Space | Stage/unstage selected file (in Source Control) |
| Ctrl+Shift+F | ⇧⌘F | Fetch current repository (in Repos view: selected repositories) |
| F2 | F2 | Rename file / branch (per focus) |
| Delete | Delete | Delete file (to trash) / branch (in branch lists) |
| Enter | Enter | Open / confirm; in the graph: commit details |
| Alt+← / Alt+→ | ⌥← / ⌥→ | Editor navigation history |
| Esc | Esc | Close the topmost transient UI (never closes an editor tab) |

### Customizing

- `keybindings.json` overrides any default. A "Keyboard Shortcuts" tab (command palette → "Open keyboard shortcuts") lists defaults plus overrides and **detects conflicts** when you bind an already-used combination.
- Shortcut overrides are per user (not per workspace) in v1. [Later]

## Theme & language

- **Theme**: `system` (default, follows the OS live), `light`, `dark` — switchable from the status bar or command palette.
- **Language**: `en` (default) and `zh-Hans` ship with v1; switching applies instantly without restart. All user-visible text (including dialogs, badges, tooltips) is translated — no half-English screens.

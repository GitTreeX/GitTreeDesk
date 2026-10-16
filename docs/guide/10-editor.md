# 10 · Editor

> Status: ✅ Implemented · Scope: v1 · Engineering: [`../spec.md`](../spec.md)

GitTreeDesk has a built-in editor for **viewing and light editing**. It is deliberately minimal — deep code intelligence, refactoring and formatting stay in VSCode, reachable with one button.

## Opening and closing files

- Click a file in the Explorer, or use **quick open** (`Ctrl/Cmd+P`) to jump to any file in the workspace (respecting `exclude`).
- Files open as **tabs** in the editor area; the open-editors list shows a dirty dot for unsaved changes. Tab context menu: Close, Close others, Close all, Copy path, Reveal in Explorer.
- Diffs (page 03), commit diffs (page 09) and settings open as their own tabs in the same area.

## Saving

- `Ctrl/Cmd+S` saves atomically (write-temp-then-rename; no truncated files on crash).
- **External changes** are detected (file touched by another tool while the tab is open): on focus and before saving, GitTreeDesk compares the file on disk and shows a conflict dialog — **Overwrite / Reload from disk / Show diff**. Nothing is overwritten silently.
- Files larger than 10 MB open **read-only** after a confirmation. Binary files: images get a preview; everything else offers "Open externally".

## Language support

- **Syntax highlighting** for the built-in curated language set (loaded on demand — opening the app does not pay for every language).
- **TypeScript / JavaScript hints**: the built-in TypeScript worker provides completion, hover and diagnostics at file level, configured best-effort from the nearest `tsconfig.json` (`compilerOptions` + standard library).
- **Known limitation (v1)**: types from `node_modules` and cross-file project semantics are not resolved. For project-wide IntelliSense use the escape hatch below.
- **Open in VSCode** — a toolbar button (and Explorer context menu) on every file: opens the file at the current line in VSCode (`code --goto <path>:<line>`). The command is configurable in settings (e.g. `code-insiders`, another fork). If the command is missing, GitTreeDesk falls back to revealing the file in the OS file manager.

## Editing settings (the complete list)

| Setting | Default |
|---|---|
| Font size / family | 13 / platform default monospace |
| Tab size, insert spaces | 2, spaces |
| Word wrap | on for the diff viewer, off for files |
| Minimap | off |

## What the editor deliberately does *not* do (v1)

- No format-on-save / no linters / no tasks / no debugger.
- No multi-root or multi-cursor plugins beyond built-in basics.
- No extension system.
- No refactoring commands — use "Open in VSCode".

## Edge cases

- **Conflict markers** from merges are highlighted, with Accept ours / theirs / both actions in the gutter (page 06).
- A file deleted on disk while open → the tab shows a "deleted" state with Save (recreate) or Close.
- A file changed on disk and in the editor simultaneously → the save conflict dialog above; "Show diff" opens an inline diff of editor vs disk.

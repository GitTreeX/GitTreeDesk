# 03 · Changes & Diff

> Status: 🚧 Planned · Scope: v1 · Engineering: [`../spec.md`](../spec.md)

The **Source Control view** (activity bar) is the multi-repo changes list: one section per repository, all uncommitted work at a glance.

## Which repositories appear

- A repository appears when it has any changes, **and** it is checked in the Repos view's per-repo selection (page 01). With 50+ repositories this keeps the view focused on what you are working on right now.
- Toolbar actions: "Show only selected repos" toggle, "Select all / none".
- Repositories with an in-progress operation (merge, rebase, …) always appear, with an operation banner at the top of their section: **Continue / Skip / Abort** plus the list of conflicted files (details: page 06).

## Groups and toggles

Each repository section groups its changes as **Staged**, **Unstaged**, **Untracked**, and **Conflicts**. Each group can be hidden via view options — e.g. hide *Untracked* if you rarely commit new files.

Each section ends with the **commit box** (message field, ✨ generate button, Commit / Amend / Stage-all — details: page 04).

## Working with file rows

Status letters: `M` modified · `A` added · `D` deleted · `R` renamed · `U` untracked · `!` unmerged/conflict · `C` copied.

- Hover actions: **Stage** / **Unstage** / **Discard**. Multi-select works (Shift/Ctrl-click); actions apply to the selection.
- **Directory granularity**: staging a folder stages everything inside it.
- **Hunk-level staging** — in the diff view, each hunk has margin actions: stage this hunk (unstaged files) or unstage this hunk (staged files). Line-level staging is [Later].
- **Add to .gitignore** — available on untracked rows; the pattern is appended to `.gitignore` and staged immediately.
- `Space` stages/unstages the selected rows; `Enter` opens the diff.

## Discard semantics (important)

| Case | What happens |
|---|---|
| Modified / renamed file | Restored from the index. **Irreversible** — a confirmation dialog explains exactly what will be lost. |
| Untracked file | The file is **moved to the OS trash** — recoverable from there. No scary dialog needed. |
| Conflicts | Not discardable; resolve them (page 06). |

## Diff view

Clicking a changed file opens a diff tab in the editor area.

- **Layout**: side-by-side ⇄ inline toggle. **Whitespace-ignore** toggle. Word wrap respects editor settings.
- Renames show old → new path plus the content diff. Binary files show size information; images show a **2-up before/after preview** (onion-slider mode is [Later]).
- Margin actions: **stage hunk / revert hunk**; copy-patch is available from the context menu.
- **Compare with…** — change the comparison base for a file: `INDEX`, `HEAD`, any ref / branch. The same picker works on a **whole repository scope** (compare the working tree against a ref) from the repo's context menu. Directory-scoped compare within one repo is [Later].

## File history

- The diff tab's toolbar has a **History** toggle: a list of commits touching that file; clicking a commit opens that revision's diff for the file.
- Rename-following is [Later].

## Edge cases

- **Pathological untracked counts**: the Untracked group lists a capped set with "Show more…" instead of freezing the view.
- **Very large diffs**: text diffs beyond a size cap open with a "load full diff anyway" action; binary and >10 MB files follow editor rules (page 10).
- **External changes** while a diff is open: the tab marks itself stale and offers reload.
- **CRLF / .gitattributes**: diffs are shown raw, exactly as Git produces them — GitTreeDesk never normalizes line endings. The whitespace-ignore toggle helps; hover shows the detected line-ending when mixed.

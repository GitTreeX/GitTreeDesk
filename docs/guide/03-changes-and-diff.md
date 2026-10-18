# 03 · Changes & Diff

> Status: ✅ Implemented · Scope: v1 · Engineering: [`../spec.md`](../spec.md)

The **Source Control view** (activity bar) is the multi-repo changes list: one section per repository, all uncommitted work at a glance.

## Which repositories appear

- Repositories start **all checked**: unchecking one in the Repos view hides it from this list. The default is therefore "everything with changes is visible"; the selection is how you cut the view down on a 50+ repo workspace.
- Toolbar actions: **"Only selected"** (on by default — shows changes only from the repositories you checked in the Repos view), "Select all / none".
- Repositories with an in-progress operation (merge, rebase, cherry-pick, revert, bisect) always appear, with an operation banner at the top of their section: the operation name, a **live count of unresolved files**, and the actions Git allows for that operation — **Continue / Abort** for a merge, **Continue / Skip / Abort** for a rebase, cherry-pick or revert, and **Abort** only while bisecting (details: page 06).

## Groups and toggles

Each repository section groups its changes in this order: **Merge Conflicts**, **Staged Changes**, **Changes** (unstaged), **Untracked Files**. Group visibility is toggled from the Source Control view's own toolbar menu — e.g. hide *Untracked Files* if you rarely commit new files. Everything starts visible: nothing is hidden until you hide it.

Each section ends with the **commit box** (message field, ✨ generate button, Commit / Amend / Stage-all — details: page 04).

## Working with file rows

Status letters: `M` modified · `A` added · `D` deleted · `R` renamed · `C` copied · `T` type changed · `U` untracked · `!` unmerged/conflict.

- Hover actions: **Stage** / **Unstage** / **Discard**. Multi-select works (Shift/Ctrl-click); actions apply to the selection.
- **Directory granularity**: untracked folders appear as a single collapsed row and staging that row stages everything inside it. Tracked changes are listed per file, so there is no folder row for them.
- **Hunk-level staging** — in the diff view, each hunk has margin actions: stage this hunk (unstaged files) or unstage this hunk (staged files). Each changed line carries a smaller marker that does the same for that line alone (see *Diff view*).
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
- Margin actions: one click on the marker beside a hunk stages it (unstaged files) or unstages it (staged files); right-clicking the same marker also offers **revert hunk** and **copy patch**. A smaller dot beside each changed line does the same for **that line alone** — stage, unstage or revert it. Where git records a line as replaced, the old line and the new one have no context between them, so the dot applies both together; that pair is git's own smallest splittable unit. Markers appear only where they make sense — a diff between two commits, or a rename diff, is read-only — and the dot of a deleted line sits in the left pane, which inline mode does not show.
- **Compare with…** — change the comparison base for a file: `INDEX`, `HEAD`, any ref / branch. At **repository scope** the same idea is reached from the branch picker: it compares the repository's `HEAD` against the ref you choose (the picker lists up to 40 refs). Directory-scoped compare within one repo is [Later].

## File history

- The diff tab's toolbar has a **History** toggle: a list of commits touching that file; clicking a commit opens that revision's diff for the file.
- The list follows the file across renames (`--follow`) by default, so commits made before the first rename are included. A row from before a rename says what the file was called there, and opening it compares that old name. The **Follow renames** chip in the panel switches to the commits under the current name only.

## Edge cases

- **Pathological untracked counts**: the Untracked group lists a capped set with "Show more…" instead of freezing the view.
- **Very large diffs**: a text diff over **2 MB** is not rendered automatically — the tab offers "load full diff anyway", and there is a hard cap at **20 MB** beyond which the content is not fetched at all. Files in the editor follow the editor's own rules (page 10).
- **External changes** while a diff is open: the tab marks itself stale and offers reload.
- **CRLF / .gitattributes**: diffs are shown raw, exactly as Git produces them — GitTreeDesk never normalizes line endings. The whitespace-ignore toggle helps.

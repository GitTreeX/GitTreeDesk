# 08 · Submodules

> Status: ✅ Implemented · Scope: v1 · Engineering: [`../spec.md`](../spec.md)

## How submodules appear

- A repository containing `.gitmodules` gets a `◇` badge while any submodule needs attention (uninitialized or drifted).
- Submodule repositories are nested under their parent in the Repos view. Initialized ones behave exactly like normal repositories (all pages 03–11 apply — they are ordinary repositories that happen to be pinned by the parent).
- **Uninitialized** submodules (folder empty or missing) appear greyed with an "not initialized" hint and a one-click initialize action.

## Status per submodule

| State | Meaning | Shown as |
|---|---|---|
| In sync | Checked-out commit matches the one recorded by the parent | normal row |
| **Drifted** | Checked-out commit differs from the recorded one (someone moved the pin, or the submodule was updated locally) | warning hint + "checkout recorded commit" action |
| **Dirty** | Uncommitted changes inside the submodule | `●` badge (drift is reported separately — a dirty submodule is not necessarily drifted) |
| Not initialized | Never cloned | greyed + initialize action |

## Actions

- **Update all** (repository context menu, the headline action) — runs `git submodule update --init --recursive` with progress streamed per submodule and per nesting level. Failures are reported individually without aborting the rest.
- **Update this submodule** — single-submodule variant.
- **Checkout recorded commit** — resolves a drifted submodule back to the parent's pin.
- **Sync URLs** — `git submodule sync` after remote URL changes in `.gitmodules`.
- **Open as repository** — focuses the submodule as a full repository node (graph, changes, its own remotes).
- **Add Submodule…** (repository context menu) — clones a repository into a folder, pins the commit it checked out and lists it in `.gitmodules`. Leave the folder empty to name it after the repository; an optional branch names what a later update should follow.
- **Deinit Submodule** (submodule row menu) — empties the checkout and stops the parent from tracking it. The `.gitmodules` entry stays, so it can be initialized again. A submodule with changes of its own — uncommitted files, or a checkout the parent has not recorded — is confirmed a second time before anything is discarded.

## Notes

- The parallelism of `Update all` follows the `git.concurrency` setting (page 12); the default is tuned to be gentle on the network.
- Submodule fetch/push uses the submodule's own remote and credentials; an authentication failure surfaces as a typed error for that submodule only (troubleshooting: page 13).
- Submodule of submodule (`--recursive`) is covered — nesting depth is shown in progress output.
- Adding from a local folder path needs git's file-protocol allowance (`protocol.file.allow`); remote URLs are unaffected.

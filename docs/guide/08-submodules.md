# 08 · Submodules

> Status: 🚧 Planned · Scope: v1 · Engineering: [`../spec.md`](../spec.md) §F4 (Submodules)

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
- **Add / deinit** — [Later].

## Notes

- The parallelism of `Update all` follows the `git.concurrency` setting (page 12); the default is tuned to be gentle on the network.
- Submodule fetch/push uses the submodule's own remote and credentials; an authentication failure surfaces as a typed error for that submodule only (troubleshooting: page 13).
- Submodule of submodule (`--recursive`) is covered — nesting depth is shown in progress output.

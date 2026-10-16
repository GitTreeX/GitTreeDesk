# 04 · Commit & Commit Messages

> Status: ✅ Implemented · Scope: v1 · Engineering: [`../spec.md`](../spec.md)

## The commit box

Every repository section in the Source Control view ends with a commit box:

- **Message field** (multiline, expanded on demand) with a **✨ generate** button.
- Primary action **Commit** (`Ctrl/Cmd+Enter`). The dropdown offers, in order:
  - **Commit** staged changes only;
  - **Commit & Push** (the push dialog chooses the remotes — page 05);
  - **Stage All & Commit**;
  - **Amend · Keep Message**, **Amend · Edit Message**, **Amend · Include Working Tree** — see below.
- **Sign-off** toggle (adds `Signed-off-by:`); GPG signing is [Later].
- While a commit runs, hook output (e.g. `pre-commit`, `commit-msg`) streams into the panel. On failure the message **stays in the box** — nothing is lost; fix and retry.
- In an untrusted workspace the box shows **"Git hooks are disabled in this workspace"** and commits run without hooks (page 01).

## Amend

- The three amend entries differ in what they do with the message and the working tree: **Keep Message** re-commits with the existing message, **Edit Message** prefills the last commit's message for you to change, **Include Working Tree** stages everything first.
- Amending a commit that is already pushed shows a warning and requires confirmation.

## Editing older commits (history rewrite)

The feature behind "fix that commit's message / author / date":

- **Entry points**: right-click a commit in the commit graph, or use the **"…"** menu of the commit details panel → **"Edit Commit…"**.
- **Editable fields**: commit message, author name and email, author date, committer date.
- **Batch editing**: select several commits in the graph → **"Edit N Commits…"** applies the changes in one operation.
- **Preconditions and safety**:
  - A dirty working tree does not block the rewrite: editing the tip commit leaves your uncommitted changes untouched, and replaying older commits runs with Git's own auto-stash (`rebase.autoStash`), restored when the rewrite finishes (page 07).
  - If the branch is already pushed, a strong warning appears ("this rewrites published history") and requires explicit confirmation.
  - A **backup ref is created automatically** before the rewrite; after completion the operation can be **undone** (details and recovery: page 06, "Safety nets").
- The rewrite runs in the background without blocking the window, and the graph refreshes when it completes.

## Commit message generation

- The **✨ button** in the commit box produces an editable **draft** from the staged diff. It never commits by itself, and if the box already holds text you typed, a confirmation asks before the draft replaces it.
- **Offline mode (default)** — no network, no setup:
  - Detects the repository's commit convention from `commitlint` configuration, a `.gitmessage` template, and the style of the last ~100 non-merge subjects (conventional-commits prefixes, casing, average length, subject language — English/Chinese).
  - Builds the draft from the staged diff: inferred type and scope, a subject summarizing the dominant change, and body bullets grouped from the change statistics.
  - If no convention can be detected, the draft is neutral and descriptive rather than guessing a prefix.
- **Regenerate** produces another variant. Once more than one draft exists, the box offers **"Alternatives"** to switch between them.
- **LLM mode (opt-in)** — better prose for non-trivial diffs:
  - Configure once in Settings → Commit message: provider (*OpenAI-compatible*), base URL, model, temperature, API key.
  - The key is stored in the OS keychain (Windows Credential Manager / macOS Keychain / Linux keyring). On a Linux system without a keyring the key is kept **for the session only** — a notice explains why.
  - The first request to a given host shows a confirmation explaining that **the staged diff will be sent to `<host>`**; approve once per host.
  - The response streams into the box and can be canceled; on timeout (30 s default) or network failure GitTreeDesk falls back to the offline draft and says so.
- In both modes the draft is fully editable and **you** press Commit.

## Edge cases

- Committing with nothing staged: the Commit action stages nothing and explains (or use "Stage all & commit").
- Merge conflicts present: the commit box is disabled with a pointer to the conflict banner (page 06).
- Committing during a rebase/merge "continue" flow: allowed only through the operation banner, so the sequence stays consistent.

# 04 · Commit & Commit Messages

> Status: ✅ Implemented · Scope: v1 · Engineering: [`../spec.md`](../spec.md)

## The commit box

Every repository section in the Source Control view ends with a commit box:

- **Message field** (multiline, expanded on demand) with a **✨ generate** button.
- Primary action **Commit** (`Ctrl/Cmd+Enter`). The dropdown offers:
  - **Commit** staged changes only;
  - **Stage all & commit**;
  - **Commit & push** (the push dialog chooses the remotes — page 05);
  - **Amend** — see below.
- **Sign-off** toggle (adds `Signed-off-by:`); GPG signing is [Later].
- While a commit runs, hook output (e.g. `pre-commit`, `commit-msg`) streams into the panel. On failure the message **stays in the box** — nothing is lost; fix and retry.
- In an untrusted workspace the box shows "hooks disabled" and commits run without hooks (page 01).

## Amend

- **Amend** in the dropdown has variants: keep the current message / prefill the last commit's message for editing; and a **"include working tree changes"** option (stage everything first).
- Amending a commit that is already pushed shows a warning and requires confirmation.

## Editing older commits (history rewrite)

The feature behind "fix that commit's message / author / date":

- **Entry points**: right-click a commit in the commit graph, or use the commit details panel → **"Edit commit…"**.
- **Editable fields**: commit message, author name and email, author date, committer date.
- **Batch editing**: select several commits in the graph → "Edit commits…" applies the changes in one operation.
- **Preconditions and safety**:
  - The working tree must be clean — otherwise GitTreeDesk offers to auto-stash first (page 07).
  - If the branch is already pushed, a strong warning appears ("this rewrites published history") and requires explicit confirmation.
  - A **backup ref is created automatically** before the rewrite; after completion the operation can be **undone** (details and recovery: page 06, "Safety nets").
- The rewrite is performed commit-by-commit in the background with progress shown; the graph refreshes when done.

## Commit message generation

- The **✨ button** in the commit box produces an editable **draft** from the staged diff. It never commits by itself, and it never overwrites text you typed.
- **Offline mode (default)** — no network, no setup:
  - Detects the repository's commit convention from `commitlint` configuration, a `.gitmessage` template, and the style of the last ~100 non-merge subjects (conventional-commits prefixes, casing, average length, subject language — English/Chinese).
  - Builds the draft from the staged diff: inferred type and scope, a subject summarizing the dominant change, and body bullets grouped from the change statistics.
  - If no convention can be detected, the draft is neutral and descriptive rather than guessing a prefix.
- **Regenerate** produces a variant; when the draft is weak, a variant picker offers alternatives.
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

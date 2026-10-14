export type ChangeKind = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'typeChanged'

export interface FileChange {
  path: string
  origPath?: string
  kind: ChangeKind
}

export interface ConflictedEntry {
  path: string
  /** Raw two-letter unmerged code from `git status` (e.g. `UU`, `AA`, `DU`). */
  code: string
}

export interface HeadInfo {
  /** Short branch name, or `null` when detached or unborn. */
  ref: string | null
  sha: string | null
  detached: boolean
  unborn: boolean
}

export interface UpstreamInfo {
  ref: string
  ahead: number
  behind: number
}

export type RepoOperationKind =
  | 'none'
  | 'merge'
  | 'rebase'
  | 'rebase-interactive'
  | 'cherry-pick'
  | 'revert'
  | 'bisect'

export interface RepoStatus {
  head: HeadInfo
  upstream: UpstreamInfo | null
  staged: FileChange[]
  unstaged: FileChange[]
  untracked: string[]
  conflicted: ConflictedEntry[]
  operation: RepoOperationKind
  stashCount: number
  submodulesPresent: boolean
}

export type RefKind = 'branch' | 'remote' | 'tag'

export interface GitRef {
  /** Short display name, e.g. `main`, `origin/main`, `v1.0.0`. */
  name: string
  fullName: string
  kind: RefKind
  sha: string
  isHead: boolean
  upstream: string | null
  ahead: number
  behind: number
  /** Tip subject, when available. */
  subject: string | null
  /** ISO 8601 date of the tip: committer date of the commit, or tagger date. */
  updatedAt: string | null
  /** Tags only: a tag object carries the annotation; always false elsewhere. */
  annotated: boolean
}

export type PullStrategy = 'ff-only' | 'merge' | 'rebase'

/** Outcome of the auto-stash guard around an operation blocked by local changes. */
export interface AutoStashReport {
  /** Auto-stash was taken because the first attempt was blocked by local changes. */
  stashed: boolean
  /** The auto-stash was restored cleanly after the retry succeeded. */
  stashRestored: boolean
  /** Restoring produced conflicts; the stash entry is kept. */
  stashConflict: boolean
}

export interface RemoteInfo {
  name: string
  fetchUrl: string
  pushUrl: string
}

export interface RemoteTag {
  name: string
  /** Commit the tag points at, peeled for annotated tags. */
  sha: string
}

export interface PersonInfo {
  name: string
  email: string
  /** ISO 8601 date-time. */
  date: string
}

export interface CommitInfo {
  sha: string
  parents: string[]
  author: PersonInfo
  committer: PersonInfo
  subject: string
  /** Decoration names (branches, tags, HEAD), without the `HEAD ->` prefix. */
  refs: string[]
}

export interface HeadCommit {
  sha: string
  /** Full commit message: subject line and body. */
  message: string
}

export interface RepoWorktree {
  path: string
  sha: string | null
  /** Full ref name, e.g. `refs/heads/feat/dark-mode`, or `null` when detached. */
  branch: string | null
  detached: boolean
  bare: boolean
  locked: string | null
  prunable: string | null
}

export type SubmoduleCheckout = 'in-sync' | 'different' | 'conflict' | 'uninitialized'

export interface SubmoduleInfo {
  path: string
  sha: string | null
  /** Human description from git, e.g. `(v1.2.3)` or `(heads/main)`. */
  describe: string | null
  checkout: SubmoduleCheckout
}

export interface StashEntry {
  /** Position in the stash stack; `0` is the most recent. */
  index: number
  selector: string
  sha: string
  subject: string
  /** Branch the stash was taken on; `null` when the subject cannot be parsed. */
  branch: string | null
  /** ISO 8601 creation time. */
  at: string
  /** Number of files the stash touches. */
  files: number
}

export interface BackupRef {
  /** Full ref name under `refs/gitreedesk/backup/`. */
  ref: string
  /** Operation slug, e.g. `reset-hard`, `commit-amend`. */
  op: string
  sha: string
  /** ISO 8601 timestamp parsed from the ref name. */
  createdAt: string
}

export interface GitVersionInfo {
  /** Raw version string as reported by `git --version`. */
  raw: string
  major: number
  minor: number
  patch: number
  /** False when the version is below the supported minimum. */
  supported: boolean
  /** True when the version is above the minimum but below the recommended line. */
  warn: boolean
}

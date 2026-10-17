import { createContext, useContext } from 'react'
import type { AutoStashReport, RepoRecord } from '@gitreedesk/shared'

export interface FetchOptions {
  /** Deletes stale remote-tracking branches while fetching. */
  prune: boolean
  followTags: boolean
}

export interface OutputLine {
  /** Checkout key the result belongs to; submodule lines append their repo-relative path. */
  key: string
  name: string
  state: 'running' | 'updated' | 'uptodate' | 'failed'
  error: string | null
  /** Raw git output for the expandable details. */
  output: string
  /** Auto-stash report of a pull; `null` for fetch. */
  stash: AutoStashReport | null
}

export interface OutputEntry {
  id: number
  title: string
  done: boolean
  lines: OutputLine[]
}

/** One commit a graph action targets. */
export interface CommitTarget {
  sha: string
  subject: string
  parents: readonly string[]
}

export interface OperationsValue {
  openBranches: (record: RepoRecord) => void
  openCreateBranch: (record: RepoRecord, options?: { startPoint?: string; initialName?: string }) => void
  openRemotes: (record: RepoRecord) => void
  openTags: (record: RepoRecord) => void
  /** Opens the tag dialog, optionally pointing the new tag at `target`. */
  openCreateTag: (record: RepoRecord, options?: { target?: string }) => void
  /** Opens the merge dialog that merges `branch` into the current branch. */
  beginMerge: (record: RepoRecord, branch: string) => void
  /** Confirms, then rebases the current branch onto `onto`. */
  rebaseOnto: (record: RepoRecord, onto: string) => void
  /** Opens the interactive rebase planner based on `base`. */
  beginInteractiveRebase: (record: RepoRecord, base: string) => void
  /** Opens the cherry-pick dialog for the selected commits. */
  openCherryPick: (record: RepoRecord, targets: readonly CommitTarget[]) => void
  /** Opens the revert dialog for the selected commits. */
  openRevert: (record: RepoRecord, targets: readonly CommitTarget[]) => void
  /** Opens the reset dialog that moves the current branch to `target`. */
  openReset: (record: RepoRecord, target: CommitTarget) => void
  /** Opens the history-rewrite dialog; `pushed` warns about published history. */
  openEditCommits: (
    record: RepoRecord,
    targets: readonly CommitTarget[],
    options?: { pushed?: boolean }
  ) => void
  /** Opens the stash-creation dialog; `paths` restricts it to the picked paths. */
  openStashCreate: (record: RepoRecord, options?: { paths?: readonly string[] }) => void
  openStashes: (record: RepoRecord) => void
  openBackupRestore: (record: RepoRecord) => void
  /** Opens the dialog that creates a linked worktree of `record`'s repository. */
  openCreateWorktree: (record: RepoRecord) => void
  /** Confirms, then removes the worktree row `record`; a dirty worktree asks for force. */
  removeWorktree: (record: RepoRecord) => void
  /** Runs `git worktree prune` for the repository `record` belongs to. */
  pruneWorktrees: (record: RepoRecord) => void
  lockWorktree: (record: RepoRecord) => void
  unlockWorktree: (record: RepoRecord) => void
  /** Updates every submodule of `record`; progress streams into the Output panel. */
  updateSubmodules: (record: RepoRecord) => void
  /** Updates the submodule recorded at `path` inside `record`; a toast reports the outcome. */
  updateSubmodule: (record: RepoRecord, path: string, options?: { init?: boolean }) => void
  /** Re-copies the `.gitmodules` URLs of `record` into its git configuration. */
  syncSubmoduleUrls: (record: RepoRecord) => void
  /** Opens the dialog that clones a repository into `record` as a submodule. */
  openAddSubmodule: (record: RepoRecord) => void
  /** Asks, then stops tracking the submodule recorded at `path` inside `record`. */
  deinitSubmodule: (record: RepoRecord, path: string) => void
  /** Validates unresolved conflicts, then continues the stopped operation. */
  continueOperation: (record: RepoRecord) => void
  skipOperation: (record: RepoRecord) => void
  abortOperation: (record: RepoRecord) => void
  /** Explains that another operation is in progress and offers continue/abort. */
  openBlockedOperation: (record: RepoRecord) => void
  closeDialog: () => void
  /** Fetch one repository (toast) or several (output panel summary). */
  fetchRepos: (records: readonly RepoRecord[]) => void
  /** Pull one repository (toast) or several (output panel summary). */
  pullRepos: (records: readonly RepoRecord[]) => void
  /**
   * Pushes a local branch; without an upstream this asks to publish first, and
   * a rejected push leads to the force-with-lease flow behind two confirmations.
   */
  pushBranch: (record: RepoRecord, branch: string, options?: { hasUpstream?: boolean }) => void
  fetchOptions: FetchOptions
  setFetchOptions: (next: FetchOptions) => void
  output: readonly OutputEntry[]
  outputOpen: boolean
  setOutputOpen: (open: boolean) => void
  clearOutput: () => void
}

export const OperationsContext = createContext<OperationsValue | null>(null)

export function useOperations(): OperationsValue {
  const value = useContext(OperationsContext)
  if (value === null) throw new Error('useOperations requires an OperationsProvider')
  return value
}

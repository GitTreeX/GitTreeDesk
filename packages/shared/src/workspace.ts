export type RepoKind = 'repository' | 'worktree' | 'bare'

/** Watcher scopes: repository discovery, git directories, and working trees. */
export type WatchScopeKind = 'discovery' | 'gitdir' | 'tree'

export interface RepoRecord {
  /** `realpath(common dir)` with forward slashes; stable across moves of worktree folders. */
  id: string
  /** Workspace root this record was discovered from (realpath, forward slashes). */
  root: string
  /**
   * POSIX path relative to the workspace root; empty when the checkout is the root itself.
   * Checkouts outside the root (external worktrees) carry a `..`-prefixed relative path.
   */
  relPath: string
  /** Absolute realpath of this checkout, forward slashes. */
  path: string
  gitDir: string
  commonDir: string
  kind: RepoKind
  /** Owning repository for linked worktrees and submodule checkouts. */
  parentId: string | null
  /** Display name (folder name). */
  name: string
  /** True when the checkout lives outside the workspace root. */
  external: boolean
  hasSubmodules: boolean
  /**
   * Worktree only: the lock reason, `''` when locked without one; `null` when
   * unlocked. `undefined` while the state has not been read for this record.
   */
  worktreeLocked?: string | null
  /** Worktree only: the prune reason of a worktree whose folder is gone. */
  worktreePrunable?: string | null
}

export interface WorkspaceGroup {
  name: string
  /** Glob patterns, relative to the workspace root. */
  match: string[]
}

export interface WorkspaceScanConfig {
  maxDepth: number
  maxEntries: number
  followSymlinks: boolean
}

export interface WorkspaceConfig {
  name: string | null
  exclude: string[]
  scan: WorkspaceScanConfig
  /** `null` when not configured; groups are then derived from the first path segment. */
  groups: WorkspaceGroup[] | null
}

export interface DiscoveryStats {
  dirsScanned: number
  candidates: number
  repos: number
  budgetExceeded: boolean
  maxDepthReached: boolean
}

export interface DiscoveryResult {
  repos: RepoRecord[]
  stats: DiscoveryStats
  /** Non-fatal problems: unreadable directories, failed repository confirmations. */
  issues: string[]
}

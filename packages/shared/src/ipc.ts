import type { AppInfo } from './api'
import type { ConflictSide } from './conflicts'
import type {
  AutoStashReport,
  BackupRef,
  CommitInfo,
  FileChange,
  GitRef,
  HeadCommit,
  RemoteInfo,
  RemoteTag,
  RepoStatus,
  StashEntry
} from './git'
import type { DiscoveryStats, RepoRecord, WatchScopeKind, WorkspaceConfig } from './workspace'

export type SettingsScope = 'user' | 'workspace'

export interface RecentWorkspace {
  /** Normalized workspace root. */
  root: string
  name: string | null
  /** Epoch milliseconds; `null` for workspaces hidden from the recent list. */
  lastOpenedAt: number | null
}

/** Status of one checkout; the git dir is the stable key across worktrees. */
export interface RepoStatusSnapshot {
  gitDir: string
  status: RepoStatus
  /** Epoch milliseconds of the read that produced this status. */
  updatedAt: number
}

export interface WorkspaceDescriptor {
  /** Normalized (realpath, forward slashes) workspace root. */
  root: string
  config: WorkspaceConfig
  records: RepoRecord[]
  trusted: boolean
  /** Non-fatal discovery problems, newest batch. */
  issues: string[]
  stats: DiscoveryStats
  /** Cached statuses from an earlier session, so the UI can paint before the first refresh. */
  statuses: RepoStatusSnapshot[]
}

export interface WorkspaceOpenRequest {
  root: string
}

export interface WorkspaceRemoveRecentRequest {
  root: string
}

export interface WorkspaceRescanRequest {
  /** Absolute directories to rescan; omitted rescans the whole workspace. */
  dirs?: string[]
  /** Doubles the directory budget for this session before the full rescan. */
  raiseBudget?: boolean
}

export interface GitStatusRequest {
  /** Checkout key: the record's git dir. */
  gitDir: string
  refresh?: boolean
}

export interface GitPathsRequest {
  /** Checkout key: the record's git dir. */
  gitDir: string
  /** Repo-relative paths (forward slashes) exactly as reported by status. */
  paths: string[]
}

export interface GitCheckoutRequest {
  /** Checkout key: the record's git dir. */
  gitDir: string
}

export interface GitIgnoreRequest {
  /** Checkout key: the record's git dir. */
  gitDir: string
  /** Repo-relative path of the untracked entry; a trailing slash marks a directory. */
  path: string
}

export interface FsWatchRequest {
  path: string
}

export type FsEntryKind = 'file' | 'dir' | 'symlink'

export interface FsEntry {
  name: string
  /** Absolute real path, forward slashes. */
  path: string
  kind: FsEntryKind
}

export interface FsReadDirRequest {
  path: string
}

export interface FsCreateRequest {
  parent: string
  name: string
  kind: 'file' | 'dir'
}

export interface FsRenameRequest {
  path: string
  newName: string
}

export interface FsPathRequest {
  path: string
}

export interface EditorOpenRequest {
  path: string
  line?: number
}

export interface FsReadFileRequest {
  path: string
  /** Reads past the size cap after the user explicitly asked to open the file anyway. */
  allowLarge?: boolean
}

export type FsFileKind = 'text' | 'binary' | 'image' | 'tooLarge'

export interface FsReadFileResponse {
  exists: boolean
  kind: FsFileKind
  size: number
  mtimeMs: number
  text: string | null
  dataUrl: string | null
}

export interface FsStatResponse {
  exists: boolean
  kind: 'file' | 'dir' | 'other' | 'missing'
  size: number
  mtimeMs: number
}

export interface FsWriteFileRequest {
  path: string
  text: string
  /** Last known mtime; a mismatch fails the write so nothing is overwritten silently. */
  expectedMtimeMs?: number
}

export interface FsWriteFileResponse {
  mtimeMs: number
}

export type DiffSourceKind = 'worktree' | 'index' | 'rev'

export interface DiffSource {
  kind: DiffSourceKind
  /** Revision name for `rev` sources, e.g. `HEAD`, a branch or a commit sha. */
  rev?: string
}

export interface GitDiffRequest {
  /** Checkout key: the record's git dir. */
  gitDir: string
  /** Repo-relative path of the new side; for renames this is the new name. */
  path: string
  /** Old-side path of a rename. */
  origPath?: string
  from: DiffSource
  to: DiffSource
  /** Reads past the size cap when the user explicitly asked for the full diff. */
  allowLarge?: boolean
}

export interface GitDiffSide {
  /** Display name of the source: a revision name, `INDEX` or `WORKTREE`. */
  label: string
  exists: boolean
  size: number
  text: string | null
  dataUrl: string | null
}

export interface GitDiffResponse {
  path: string
  origPath: string | null
  kind: FsFileKind
  /** Raw unified patch for hunk application; empty when hunks do not apply. */
  patch: string
  old: GitDiffSide
  new: GitDiffSide
}

export interface GitApplyHunkRequest {
  gitDir: string
  /** A single-hunk unified patch, exactly as produced from the diff payload. */
  patch: string
  mode: 'stage' | 'unstage' | 'revert'
}

export interface GitCommitRequest {
  /** Checkout key: the record's git dir. */
  gitDir: string
  /** Empty keeps the amended commit's message; required otherwise. */
  message: string
  signOff?: boolean
  amend?: boolean
  /** Stages every change before committing (Commit all / amend including the working tree). */
  stageAll?: boolean
}

export interface GitHeadCommitRequest {
  /** Checkout key: the record's git dir. */
  gitDir: string
}

export interface GitHeadCommitResponse {
  /** HEAD commit with its full message; `null` on an unborn branch. */
  commit: HeadCommit | null
  /** HEAD is contained in a remote-tracking branch, i.e. already published. */
  pushed: boolean
}

export interface GitFileLogRequest {
  gitDir: string
  path: string
  limit?: number
  skip?: number
}

export interface GitRefsRequest {
  gitDir: string
}

export interface GitBranchCheckoutRequest {
  /** Checkout key: the record's git dir. */
  gitDir: string
  /** Local branch to switch to. */
  name: string
}

export interface GitCheckoutDetachRequest {
  gitDir: string
  /** Revision to detach onto: a commit, tag or remote branch. */
  rev: string
}

export interface BranchOpResponse {
  /** Auto-stash guard outcome of the switch. */
  stash: AutoStashReport
}

export interface GitBranchCreateRequest {
  gitDir: string
  name: string
  /** Revision to start from (branch, tag, commit); omitted starts at HEAD. */
  startPoint?: string
  /** Switches to the new branch right away. */
  checkout?: boolean
  /** Remote-tracking ref to track, e.g. `origin/feat`. */
  upstream?: string
}

export interface GitBranchCreateResponse extends BranchOpResponse {
  upstream: string | null
}

export interface GitBranchRenameRequest {
  gitDir: string
  name: string
  newName: string
}

export interface GitBranchDeleteRequest {
  gitDir: string
  name: string
  /** Confirms deleting a branch that is not fully merged (backup ref included). */
  force?: boolean
}

export interface GitBranchDeleteResponse {
  /** The branch tip was reachable from HEAD. */
  merged: boolean
  /** Safety ref taken before an unmerged branch was deleted. */
  backup: BackupRef | null
  /** Undo affordance of the recorded deletion. */
  undo: UndoHint | null
}

export interface GitBranchSetUpstreamRequest {
  gitDir: string
  name: string
  /** Remote-tracking ref, e.g. `origin/main`. */
  upstream: string
}

export interface GitRemotesRequest {
  gitDir: string
}

export interface GitRemotesResponse {
  remotes: RemoteInfo[]
  /** Remote that fetch and push default to; `null` when none is configured. */
  defaultRemote: string | null
}

export interface GitRemoteAddRequest {
  gitDir: string
  name: string
  url: string
}

export interface GitRemoteRemoveRequest {
  gitDir: string
  name: string
}

export interface GitRemoteSetUrlRequest {
  gitDir: string
  name: string
  url: string
  /** Rewrites the separate push URL instead of the fetch URL. */
  push?: boolean
}

export interface GitFetchRequest {
  gitDir: string
  /** Remote to fetch; omitted uses the default remote. */
  remote?: string
  prune?: boolean
  followTags?: boolean
}

export interface GitFetchResponse {
  remote: string
  /** At least one remote-tracking ref or tag moved. */
  updated: boolean
  /** Raw stdout/stderr of the fetch. */
  output: string
}

export interface GitPullRequest {
  gitDir: string
  remote?: string
  branch?: string
}

export interface GitPullResponse {
  /** HEAD moved to a new commit. */
  updated: boolean
  stash: AutoStashReport
}

export interface GitFetchManyRequest {
  gitDirs: string[]
  prune?: boolean
  followTags?: boolean
}

export interface GitPullManyRequest {
  gitDirs: string[]
}

export interface GitBatchResult {
  gitDir: string
  /** Display name of the repository. */
  name: string
  ok: boolean
  /** Something moved; with `ok` false the entry failed instead. */
  updated: boolean
  /** Raw git output for the expandable details. */
  output: string
  /** Cleaned failure message when `ok` is false. */
  error: string | null
  /** Auto-stash report of a pull; `null` for fetch. */
  stash: AutoStashReport | null
}

export interface GitPushRequest {
  gitDir: string
  /** Local branch to push. */
  branch: string
  /** Remote to push to; omitted uses the default remote. */
  remote?: string
  /** Publishes the branch and sets its upstream (`-u`). */
  setUpstream?: boolean
  /** Never a plain force; the caller confirms behind a warning. */
  forceWithLease?: boolean
}

export interface GitPushResponse {
  remote: string
  output: string
}

export interface GitTagCreateRequest {
  gitDir: string
  name: string
  /** Revision the tag points at, e.g. `HEAD`, a branch or a commit sha. */
  target: string
  /** A message makes the tag annotated; omit for a lightweight tag. */
  message?: string
  /** Pushes the tag after creating it. */
  push?: boolean
  /** Remote for the push; omitted uses the default remote. */
  remote?: string
}

export interface GitTagCreateResponse {
  /** Remote the tag was pushed to; `null` when it was not pushed. */
  remote: string | null
}

export interface GitTagDeleteRequest {
  gitDir: string
  name: string
}

export interface GitTagPushRequest {
  gitDir: string
  name: string
  remote?: string
}

export interface GitTagPushAllRequest {
  gitDir: string
  remote?: string
}

export interface GitTagPushResponse {
  remote: string
  output: string
}

export interface GitTagDeleteRemoteRequest {
  gitDir: string
  name: string
  remote?: string
}

export interface GitRemoteTagsRequest {
  gitDir: string
  remote?: string
}

export interface GitRemoteTagsResponse {
  /** Remote that was read; `null` when the repository has no remotes. */
  remote: string | null
  tags: RemoteTag[]
}

export interface GitDiffFilesRequest {
  gitDir: string
  from: string
  to: string
}

export interface GitDiffFilesResponse {
  files: FileChange[]
}

export type MergeMode = 'default' | 'no-ff' | 'ff-only' | 'squash'

export interface GitMergeRequest {
  gitDir: string
  /** Revision to merge into the current branch. */
  rev: string
  /** Omitted merges with git's default: fast-forward when possible. */
  mode?: MergeMode
}

export interface GitMergeResponse {
  /** Conflicts stopped the merge; the operation banner takes over. */
  stopped: boolean
  upToDate: boolean
  fastForward: boolean
  /** Raw combined output for the details drawer. */
  output: string
}

export interface GitRebaseRequest {
  gitDir: string
  /** Ref to rebase the current branch onto. */
  onto: string
}

export interface GitRebasePlanRequest {
  gitDir: string
  /** Commits after this revision are replayed; the plan lists them oldest first. */
  base: string
}

export interface GitRebasePlanResponse {
  /** Non-merge commits above `base`, oldest first. */
  commits: CommitInfo[]
}

export type RebaseAction = 'pick' | 'reword' | 'edit' | 'squash' | 'fixup' | 'drop'

export interface GitRebaseStep {
  sha: string
  action: RebaseAction
  /** Replacement message of a `reword`; message of a `squash` group when provided. */
  message?: string
}

export interface GitRebaseInteractiveRequest {
  gitDir: string
  /** Revision whose descendants are replayed (`git rebase -i <base>`). */
  base: string
  steps: GitRebaseStep[]
}

export interface GitOperationResponse {
  /** The operation stopped: conflicts or an edit point left it in progress. */
  stopped: boolean
  output: string
  /** Undo affordance of the safety ref taken before the operation. */
  undo: UndoHint | null
}

/** Addresses the operation in progress (merge, rebase, cherry-pick or revert). */
export interface GitOpRequest {
  gitDir: string
}

export interface GitCherryPickRequest {
  gitDir: string
  /** Commit or `A..B` range. */
  rev: string
  /** Stages the changes and stops before committing. */
  noCommit?: boolean
  /** Parent number when picking a merge commit (1-based). */
  mainline?: number
}

export interface GitRevertRequest {
  gitDir: string
  rev: string
  noCommit?: boolean
  /** Parent number when reverting a merge commit (1-based). */
  mainline?: number
}

export type ResetMode = 'soft' | 'mixed' | 'hard'

export interface GitResetRequest {
  gitDir: string
  /** Revision the branch is moved to. */
  target: string
  mode: ResetMode
}

export interface GitResetResponse {
  before: string | null
  after: string | null
  /** Safety ref taken before a `hard` reset; `null` for soft and mixed. */
  backup: BackupRef | null
  /** Undo affordance of the recorded operation. */
  undo: UndoHint | null
}

/** Points at the operation-log row that an Undo action restores. */
export interface UndoHint {
  entryId: number
  op: string
  backupRef: string | null
}

export interface GitConflictResolveRequest {
  gitDir: string
  path: string
  resolution: ConflictSide
}

export interface GitOpenMergeToolRequest {
  gitDir: string
  /** Absolute path of the conflicted file (forward slashes). */
  path: string
}

export interface GitStashCreateRequest {
  gitDir: string
  message?: string
  includeUntracked?: boolean
  keepIndex?: boolean
  /** Repo-relative paths to stash; omitted stashes everything. */
  paths?: string[]
}

export interface GitStashCreateResponse {
  /** False when the working tree had nothing to stash. */
  created: boolean
  output: string
}

export interface GitStashListResponse {
  stashes: StashEntry[]
}

export interface GitStashRequest {
  gitDir: string
  /** Stash selector, e.g. `stash@{0}`. */
  stash: string
}

export interface GitStashDropResponse {
  backup: BackupRef | null
  undo: UndoHint | null
}

export interface GitStashFilesResponse {
  files: FileChange[]
}

export interface GitStashDiffRequest extends GitStashRequest {
  /** Restricts the diff to one repo-relative path. */
  path?: string
}

export interface GitStashDiffResponse {
  diff: string
}

export interface GitLogRequest {
  gitDir: string
  /** Extra revisions or ranges, e.g. `A..B`; omitted walks from HEAD. */
  revs?: string[]
  limit?: number
  skip?: number
}

export interface GitLogResponse {
  commits: CommitInfo[]
  hasMore: boolean
}

export interface GitOpLogRequest {
  gitDir: string
  limit?: number
}

export interface OpLogEntryInfo {
  id: number
  op: string
  backupRef: string | null
  /** Epoch milliseconds. */
  at: number
  /** Ref or name the operation acted on, when known. */
  target: string | null
}

export interface GitOpLogResponse {
  entries: OpLogEntryInfo[]
}

export interface BackupEntry {
  ref: string
  op: string
  sha: string
  /** ISO 8601 timestamp parsed from the ref name. */
  createdAt: string
  /** Ref the backup can restore, when known (e.g. the deleted branch). */
  target: string | null
}

export interface GitBackupsResponse {
  entries: BackupEntry[]
}

export interface GitRestoreBackupRequest {
  gitDir: string
  /** Full backup ref name, e.g. `refs/gitreedesk/backup/reset-hard/…`. */
  ref: string
}

export interface GitOpLogUndoRequest {
  gitDir: string
  /** Operation-log row recorded by the operation that should be undone. */
  entryId: number
}

export interface WorkspaceListFilesRequest {
  limit?: number
}

export interface WorkspaceListFilesResponse {
  /** Workspace-relative paths (forward slashes). */
  files: string[]
  truncated: boolean
}

export interface CopyTextRequest {
  text: string
}

export interface SettingsGetRequest {
  scope: SettingsScope
  keyPath: string[]
}

export interface SettingsGetAllRequest {
  scope: SettingsScope
}

export interface SettingsGetEffectiveRequest {
  keyPath: string[]
}

export interface SettingsSetRequest {
  scope: SettingsScope
  keyPath: string[]
  value: unknown
}

export interface SettingsRemoveRequest {
  scope: SettingsScope
  keyPath: string[]
}

export interface TrustGrantRequest {
  trusted: boolean
}

export interface UiStateGetRequest {
  key: string
}

export interface UiStateSetRequest {
  key: string
  value: unknown
}

export interface UiStateKeysRequest {
  prefix?: string
}

export interface UiStateDeleteRequest {
  key: string
}

export interface ReposChangedEvent {
  root: string
  added: RepoRecord[]
  removed: RepoRecord[]
  updated: RepoRecord[]
}

export interface StatusChangedEvent {
  root: string
  updates: RepoStatusSnapshot[]
}

export interface TreeChangedEvent {
  root: string
  /** Absolute paths (forward slashes) whose subtree changed. */
  paths: string[]
}

export interface IssuesEvent {
  root: string
  issues: string[]
}

export interface WatcherDegradedEvent {
  root: string
  kind: WatchScopeKind
  dir: string
  /** False once watching for that scope recovered. */
  degraded: boolean
}

export interface CommitOutputEvent {
  root: string
  gitDir: string
  /** stdout/stderr chunk of the running commit, including hook output. */
  chunk: string
}

export interface SettingsChangedEvent {
  scope: SettingsScope
  /** Workspace root for workspace-scope changes; `null` otherwise. */
  root: string | null
  keyPath: string[]
  removed: boolean
  /** The new value; omitted when the key was removed. */
  value?: unknown
}

/** Commands the main process asks the renderer to run (application menu, future accelerators). */
export const HOST_COMMANDS = [
  'workspace.openFolder',
  'workspace.closeFolder',
  'view.commandPalette'
] as const

export type HostCommandId = (typeof HOST_COMMANDS)[number]

export interface AppCommandEvent {
  command: HostCommandId
}

export interface InvokeMap {
  'workspace:open': { request: WorkspaceOpenRequest; response: WorkspaceDescriptor }
  'workspace:close': { request: undefined; response: null }
  'workspace:recent': { request: undefined; response: { workspaces: RecentWorkspace[] } }
  'workspace:rescan': { request: WorkspaceRescanRequest; response: null }
  'workspace:pick': { request: undefined; response: { path: string | null } }
  'workspace:removeRecent': { request: WorkspaceRemoveRecentRequest; response: null }
  'git:status': { request: GitStatusRequest; response: { status: RepoStatus } }
  'git:stage': { request: GitPathsRequest; response: null }
  'git:unstage': { request: GitPathsRequest; response: null }
  'git:discard': { request: GitPathsRequest; response: null }
  'git:stageAll': { request: GitCheckoutRequest; response: null }
  'git:unstageAll': { request: GitCheckoutRequest; response: null }
  'git:ignore': { request: GitIgnoreRequest; response: { pattern: string } }
  'git:diff': { request: GitDiffRequest; response: GitDiffResponse }
  'git:applyHunk': { request: GitApplyHunkRequest; response: null }
  'git:commit': { request: GitCommitRequest; response: { sha: string } }
  'git:headCommit': { request: GitHeadCommitRequest; response: GitHeadCommitResponse }
  'git:fileLog': { request: GitFileLogRequest; response: { commits: CommitInfo[]; hasMore: boolean } }
  'git:refs': { request: GitRefsRequest; response: { refs: GitRef[] } }
  'git:branchCheckout': { request: GitBranchCheckoutRequest; response: BranchOpResponse }
  'git:checkoutDetach': { request: GitCheckoutDetachRequest; response: BranchOpResponse }
  'git:branchCreate': { request: GitBranchCreateRequest; response: GitBranchCreateResponse }
  'git:branchRename': { request: GitBranchRenameRequest; response: null }
  'git:branchDelete': { request: GitBranchDeleteRequest; response: GitBranchDeleteResponse }
  'git:branchSetUpstream': { request: GitBranchSetUpstreamRequest; response: null }
  'git:remotes': { request: GitRemotesRequest; response: GitRemotesResponse }
  'git:remoteAdd': { request: GitRemoteAddRequest; response: null }
  'git:remoteRemove': { request: GitRemoteRemoveRequest; response: null }
  'git:remoteSetUrl': { request: GitRemoteSetUrlRequest; response: null }
  'git:fetch': { request: GitFetchRequest; response: GitFetchResponse }
  'git:fetchMany': { request: GitFetchManyRequest; response: { results: GitBatchResult[] } }
  'git:pull': { request: GitPullRequest; response: GitPullResponse }
  'git:pullMany': { request: GitPullManyRequest; response: { results: GitBatchResult[] } }
  'git:push': { request: GitPushRequest; response: GitPushResponse }
  'git:tagCreate': { request: GitTagCreateRequest; response: GitTagCreateResponse }
  'git:tagDelete': { request: GitTagDeleteRequest; response: null }
  'git:tagPush': { request: GitTagPushRequest; response: GitTagPushResponse }
  'git:tagPushAll': { request: GitTagPushAllRequest; response: GitTagPushResponse }
  'git:tagDeleteRemote': { request: GitTagDeleteRemoteRequest; response: GitTagPushResponse }
  'git:remoteTags': { request: GitRemoteTagsRequest; response: GitRemoteTagsResponse }
  'git:diffFiles': { request: GitDiffFilesRequest; response: GitDiffFilesResponse }
  'git:merge': { request: GitMergeRequest; response: GitMergeResponse }
  'git:rebase': { request: GitRebaseRequest; response: GitOperationResponse }
  'git:rebasePlan': { request: GitRebasePlanRequest; response: GitRebasePlanResponse }
  'git:rebaseInteractive': { request: GitRebaseInteractiveRequest; response: GitOperationResponse }
  'git:opContinue': { request: GitOpRequest; response: GitOperationResponse }
  'git:opSkip': { request: GitOpRequest; response: GitOperationResponse }
  'git:opAbort': { request: GitOpRequest; response: null }
  'git:cherryPick': { request: GitCherryPickRequest; response: GitOperationResponse }
  'git:revert': { request: GitRevertRequest; response: GitOperationResponse }
  'git:reset': { request: GitResetRequest; response: GitResetResponse }
  'git:conflictResolve': { request: GitConflictResolveRequest; response: null }
  'git:openMergeTool': { request: GitOpenMergeToolRequest; response: { ok: boolean } }
  'git:stashCreate': { request: GitStashCreateRequest; response: GitStashCreateResponse }
  'git:stashList': { request: GitCheckoutRequest; response: GitStashListResponse }
  'git:stashFiles': { request: GitStashRequest; response: GitStashFilesResponse }
  'git:stashDiff': { request: GitStashDiffRequest; response: GitStashDiffResponse }
  'git:stashApply': { request: GitStashRequest; response: GitOperationResponse }
  'git:stashPop': { request: GitStashRequest; response: GitOperationResponse }
  'git:stashDrop': { request: GitStashRequest; response: GitStashDropResponse }
  'git:log': { request: GitLogRequest; response: GitLogResponse }
  'git:oplog': { request: GitOpLogRequest; response: GitOpLogResponse }
  'git:oplogUndo': { request: GitOpLogUndoRequest; response: null }
  'git:backups': { request: GitCheckoutRequest; response: GitBackupsResponse }
  'git:restoreBackup': { request: GitRestoreBackupRequest; response: null }
  'fs:readDir': { request: FsReadDirRequest; response: { entries: FsEntry[] } }
  'fs:readFile': { request: FsReadFileRequest; response: FsReadFileResponse }
  'fs:stat': { request: FsPathRequest; response: FsStatResponse }
  'fs:writeFile': { request: FsWriteFileRequest; response: FsWriteFileResponse }
  'workspace:listFiles': { request: WorkspaceListFilesRequest; response: WorkspaceListFilesResponse }
  'fs:create': { request: FsCreateRequest; response: { path: string } }
  'fs:rename': { request: FsRenameRequest; response: { path: string } }
  'fs:trash': { request: FsPathRequest; response: null }
  'fs:reveal': { request: FsPathRequest; response: null }
  'fs:openExternal': { request: FsPathRequest; response: null }
  'fs:watch': { request: FsWatchRequest; response: null }
  'fs:unwatch': { request: FsWatchRequest; response: null }
  'editor:openInCode': { request: EditorOpenRequest; response: { ok: boolean } }
  'app:copyText': { request: CopyTextRequest; response: null }
  'settings:get': { request: SettingsGetRequest; response: { value: unknown } }
  'settings:getAll': { request: SettingsGetAllRequest; response: { value: unknown } }
  'settings:getEffective': { request: SettingsGetEffectiveRequest; response: { value: unknown } }
  'settings:set': { request: SettingsSetRequest; response: null }
  'settings:remove': { request: SettingsRemoveRequest; response: null }
  'trust:query': { request: undefined; response: { trusted: boolean } }
  'trust:grant': { request: TrustGrantRequest; response: { trusted: boolean } }
  'ui-state:get': { request: UiStateGetRequest; response: { value: unknown } }
  'ui-state:set': { request: UiStateSetRequest; response: null }
  'ui-state:keys': { request: UiStateKeysRequest; response: { keys: string[] } }
  'ui-state:delete': { request: UiStateDeleteRequest; response: null }
  'app:info': { request: undefined; response: AppInfo }
}

export interface EventMap {
  'workspace:reposChanged': ReposChangedEvent
  'git:statusChanged': StatusChangedEvent
  'git:commitOutput': CommitOutputEvent
  'fs:changed': TreeChangedEvent
  'workspace:issues': IssuesEvent
  'watcher:degraded': WatcherDegradedEvent
  'settings:changed': SettingsChangedEvent
  'app:command': AppCommandEvent
}

export type InvokeChannel = keyof InvokeMap
export type EventChannel = keyof EventMap

export type InvokeHandler<K extends InvokeChannel> = (
  request: InvokeMap[K]['request']
) => InvokeMap[K]['response'] | Promise<InvokeMap[K]['response']>

export type InvokeHandlers = { [K in InvokeChannel]: InvokeHandler<K> }

export const INVOKE_CHANNELS = [
  'workspace:open',
  'workspace:close',
  'workspace:recent',
  'workspace:rescan',
  'workspace:pick',
  'workspace:removeRecent',
  'git:status',
  'git:stage',
  'git:unstage',
  'git:discard',
  'git:stageAll',
  'git:unstageAll',
  'git:ignore',
  'git:diff',
  'git:applyHunk',
  'git:commit',
  'git:headCommit',
  'git:fileLog',
  'git:refs',
  'git:branchCheckout',
  'git:checkoutDetach',
  'git:branchCreate',
  'git:branchRename',
  'git:branchDelete',
  'git:branchSetUpstream',
  'git:remotes',
  'git:remoteAdd',
  'git:remoteRemove',
  'git:remoteSetUrl',
  'git:fetch',
  'git:fetchMany',
  'git:pull',
  'git:pullMany',
  'git:push',
  'git:tagCreate',
  'git:tagDelete',
  'git:tagPush',
  'git:tagPushAll',
  'git:tagDeleteRemote',
  'git:remoteTags',
  'git:diffFiles',
  'git:merge',
  'git:rebase',
  'git:rebasePlan',
  'git:rebaseInteractive',
  'git:opContinue',
  'git:opSkip',
  'git:opAbort',
  'git:cherryPick',
  'git:revert',
  'git:reset',
  'git:conflictResolve',
  'git:openMergeTool',
  'git:stashCreate',
  'git:stashList',
  'git:stashFiles',
  'git:stashDiff',
  'git:stashApply',
  'git:stashPop',
  'git:stashDrop',
  'git:log',
  'git:oplog',
  'git:oplogUndo',
  'git:backups',
  'git:restoreBackup',
  'fs:readDir',
  'fs:readFile',
  'fs:stat',
  'fs:writeFile',
  'workspace:listFiles',
  'fs:create',
  'fs:rename',
  'fs:trash',
  'fs:reveal',
  'fs:openExternal',
  'fs:watch',
  'fs:unwatch',
  'editor:openInCode',
  'app:copyText',
  'settings:get',
  'settings:getAll',
  'settings:getEffective',
  'settings:set',
  'settings:remove',
  'trust:query',
  'trust:grant',
  'ui-state:get',
  'ui-state:set',
  'ui-state:keys',
  'ui-state:delete',
  'app:info'
] as const satisfies readonly InvokeChannel[]

export const EVENT_CHANNELS = [
  'workspace:reposChanged',
  'git:statusChanged',
  'git:commitOutput',
  'fs:changed',
  'workspace:issues',
  'watcher:degraded',
  'settings:changed',
  'app:command'
] as const satisfies readonly EventChannel[]

type Covered<T extends never> = T

/** The channel lists above must stay exhaustive over their maps. */
export type InvokeCoverage = Covered<Exclude<InvokeChannel, (typeof INVOKE_CHANNELS)[number]>>
export type EventCoverage = Covered<Exclude<EventChannel, (typeof EVENT_CHANNELS)[number]>>

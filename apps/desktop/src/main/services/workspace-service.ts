import { mkdir, open, readdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { basename, dirname, join, posix, resolve } from 'node:path'
import type {
  AutoStashReport,
  BackupRef,
  CommitInfo,
  DiscoveryResult,
  DiscoveryStats,
  FileChange,
  FsEntry,
  FsEntryKind,
  FsPathRequest,
  FsReadFileRequest,
  FsReadFileResponse,
  FsStatResponse,
  FsWriteFileRequest,
  FsWriteFileResponse,
  GitActivityEntry,
  GitActivityRequest,
  GitActivityResponse,
  GitApplyHunkRequest,
  GitBackupsResponse,
  GitBranchCheckoutRequest,
  GitBranchCreateRequest,
  GitBranchDeleteRequest,
  GitBranchDeleteResponse,
  GitBranchRenameRequest,
  GitBranchSetUpstreamRequest,
  GitBatchResult,
  GitCheckoutDetachRequest,
  GitCheckoutRequest,
  GitCherryPickRequest,
  GitCommitDetailsRequest,
  GitCommitDetailsResponse,
  GitCommitRequest,
  GitConflictResolveRequest,
  GitDiffFilesRequest,
  GitDiffRequest,
  GitDiffResponse,
  GitEditCommitRequest,
  GitEditCommitResponse,
  GitFetchManyRequest,
  GitFetchRequest,
  GitFetchResponse,
  GitFileLogRequest,
  GitGraphRequest,
  GitGraphResponse,
  GitHeadCommitRequest,
  GitHeadCommitResponse,
  GitIgnoreRequest,
  GitLogRequest,
  GitLogResponse,
  GitMergeRequest,
  GitMergeResponse,
  GitOpLogRequest,
  GitOpLogResponse,
  GitOpLogUndoRequest,
  GitOperationResponse,
  GitOpRequest,
  GitPathsRequest,
  GitPullManyRequest,
  GitPullRequest,
  GitPullResponse,
  GitPushRequest,
  GitPushResult,
  GitPushResponse,
  GitRebaseInteractiveRequest,
  GitRebasePlanRequest,
  GitRebasePlanResponse,
  GitRebaseRequest,
  GitRef,
  GitRefsRequest,
  GitRemoteAddRequest,
  GitRemoteRemoveRequest,
  GitRemotesRequest,
  GitRemotesResponse,
  GitRemoteSetUrlRequest,
  GitRemoteTagsRequest,
  GitRemoteTagsResponse,
  GitResetRequest,
  GitResetResponse,
  GitRestoreBackupRequest,
  GitRevertRequest,
  GitStashCreateRequest,
  GitStashCreateResponse,
  GitStashDiffRequest,
  GitStashDiffResponse,
  GitStashDropResponse,
  GitStashFilesResponse,
  GitStashListResponse,
  GitStashRequest,
  GitStatusRequest,
  GitSubmodulesResponse,
  GitSubmoduleSyncRequest,
  GitSubmoduleSyncResponse,
  GitSubmoduleUpdateRequest,
  GitSubmoduleUpdateResponse,
  GitSubmoduleUpdateResult,
  GitTagCreateRequest,
  GitTagDeleteRemoteRequest,
  GitTagDeleteRequest,
  GitTagPushAllRequest,
  GitTagPushRequest,
  GitTagPushResponse,
  GitVersionInfo,
  GitWorktreeAddRequest,
  GitWorktreeAddResponse,
  GitWorktreeLockRequest,
  GitWorktreeRemoveRequest,
  GitWorktreeRemoveResponse,
  GitWorktreeTargetRequest,
  GitWorktreesResponse,
  KeybindingsResetRequest,
  KeybindingsSetRequest,
  PullStrategy,
  RemoteInfo,
  RepoOperationKind,
  RepoRecord,
  RepoStatus,
  RepoStatusSnapshot,
  RepoWorktree,
  RecentWorkspace,
  SettingsGetRequest,
  SettingsScope,
  SettingsSetRequest,
  SettingsRemoveRequest,
  SubmoduleInfo,
  TrustGrantRequest,
  UndoHint,
  WorkspaceDescriptor,
  WorkspaceListFilesResponse,
  WatchScopeKind
} from '@gitreedesk/shared'
import { findSettingDescriptor, sanitizeSettingValue } from '@gitreedesk/shared'
import {
  addRemote,
  addWorktree,
  applyPatch,
  applyStash,
  cherryPick,
  cherryPickAction,
  checkoutBranch,
  checkoutDetach,
  commit as createCommit,
  countCommits,
  createBackupRef,
  createBranch,
  createStash,
  createTag,
  deleteBranch,
  deleteRemoteTag,
  deleteTag,
  detectOperation,
  discardWorktreePaths,
  dropStash,
  editCommits,
  encodeUndoState,
  fetchRemote,
  GitCommandError,
  GitPool,
  isBranchMerged,
  isHeadPushed,
  isWorktreeDirty,
  listBackupRefs,
  listChangedFiles,
  listRefs,
  listRemoteTags,
  listRemotes,
  listStashes,
  listSubmodules,
  listWorktrees,
  loadRebasePlan,
  lockWorktree,
  logCommits,
  mergeAbort,
  mergeContinue,
  mergeRepo,
  parseBackupRefName,
  parseUndoState,
  pathExists,
  performUndo,
  popStash,
  probeGitVersion,
  pruneWorktrees,
  pullRepo,
  pushAllTags,
  pushBranch,
  pushTag,
  readBackupSha,
  readBranchTip,
  readCommitDetails,
  readDiff,
  readFileSnapshot,
  readHeadCommit,
  readHeadRef,
  readHeadSha,
  readStashDiff,
  readStashEntry,
  readStatus,
  readUpstreamMarks,
  rebaseAction,
  rebaseInteractive,
  rebaseOnto,
  removeRemote,
  removeWorktree,
  renameBranch,
  resetRepo,
  resolveConflict,
  resolveDefaultRemote,
  revertAction,
  revertCommit,
  setRemoteUrl,
  setUpstream,
  stageAll as gitStageAll,
  stashFileChanges,
  stagePaths as gitStagePaths,
  syncSubmoduleUrls,
  setGitExecutable,
  unlockWorktree,
  unstageAll as gitUnstageAll,
  unstagePaths as gitUnstagePaths,
  updateSubmodules,
  verifyRevision,
  type UndoDescriptor,
  type WorktreeAddMode
} from '@gitreedesk/git-core'
import {
  createPathMatcher,
  WorkspaceSession,
  statusTargetFor,
  type RepoDiff,
  type StatusTarget,
  type WatchBackend
} from '@gitreedesk/workspace-core'
import {
  CacheStore,
  KeybindingsStore,
  OpLogStore,
  RepoStore,
  SettingsStore,
  UiStateStore,
  WorkspaceStore,
  normalizeWorkspaceRoot,
  openCacheDatabase,
  type KeybindingChange,
  type OperationRow,
  type SettingsChange
} from '@gitreedesk/store'
import { ServiceError } from './errors'
import { recordScan, recordStatusRead, recordWarm } from '../perf-metrics'

const toPosix = (value: string): string => value.replace(/\\/g, '/')

function isInsidePath(path: string, base: string): boolean {
  const target = process.platform === 'win32' ? path.toLowerCase() : path
  const root = process.platform === 'win32' ? base.toLowerCase() : base
  return target === root || target.startsWith(`${root}/`)
}

/**
 * Real path of `path`, or of its nearest existing ancestor plus the remaining
 * segments when the leaf is missing. Without the fallback a path spelled through a
 * symlink or a Windows 8.3 short name would look like it sits outside the workspace.
 */
async function realPathPosix(path: string): Promise<string> {
  const direct = await realpath(path).then(toPosix).catch(() => null)
  if (direct !== null) return direct

  const tail: string[] = []
  let current = path
  for (;;) {
    const parent = dirname(current)
    if (parent === current) return toPosix(path)
    tail.unshift(basename(current))
    const base = await realpath(parent).then(toPosix).catch(() => null)
    if (base !== null) return tail.reduce((acc, segment) => posix.join(acc, segment), base)
    current = parent
  }
}

const RECENT_LIMIT = 10

const INVALID_ENTRY_NAME = /[/\\\u0000-\u001f]/

function assertEntryName(name: string): void {
  if (name.length === 0 || name.length > 255 || name === '.' || name === '..' || INVALID_ENTRY_NAME.test(name)) {
    throw new ServiceError('invalid-name', `Invalid file name: ${JSON.stringify(name)}`)
  }
}

const DETAILS_LIMIT = 16_384

/** Raw output of a failed git command, capped to the tail where the error lives. */
function rawGitOutput(error: GitCommandError): string {
  const combined = [error.stdout, error.stderr]
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join('\n')
  return combined.length > DETAILS_LIMIT ? combined.slice(combined.length - DETAILS_LIMIT) : combined
}

function toGitServiceError(error: unknown): ServiceError {
  if (error instanceof ServiceError) return error
  if (error instanceof GitCommandError) {
    const lines = error.stderr
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
    const detail = lines.find((line) => line.startsWith('error:') || line.startsWith('fatal:')) ?? lines[0]
    const message = (detail ?? error.message).replace(/^(error|fatal):\s*/, '')
    const raw = rawGitOutput(error)
    return new ServiceError('git-failed', message, raw.length > message.length ? raw : undefined)
  }
  const message = error instanceof Error ? error.message : String(error)
  return new ServiceError('git-failed', message)
}

const CREDENTIAL_RE =
  /could not read (?:username|password)|terminal prompts disabled|authentication failed|invalid username or (?:token|password)|http (?:401|403)/i
const SSH_AUTH_RE = /permission denied \(publickey\)|host key verification failed|could not read from remote repository/i

/** Maps network failures onto typed auth errors, keeping the raw output for the details drawer. */
function toNetworkServiceError(error: unknown, remote: string): ServiceError {
  if (error instanceof ServiceError) return error
  if (error instanceof GitCommandError) {
    const raw = rawGitOutput(error)
    const details = raw.length > 0 ? raw : undefined
    const target = remote.length > 0 ? `"${remote}"` : 'the remote server'
    const probe = `${error.stderr}\n${error.stdout}`
    if (CREDENTIAL_RE.test(probe)) {
      return new ServiceError('auth-required', `Credential required for ${target}`, details)
    }
    if (SSH_AUTH_RE.test(probe)) {
      return new ServiceError('auth-ssh', `SSH authentication to ${target} was rejected`, details)
    }
  }
  return toGitServiceError(error)
}

function messageOf(error: unknown): string {
  if (error instanceof ServiceError) return error.message
  return error instanceof Error ? error.message : String(error)
}

type ActiveOperation = Exclude<RepoOperationKind, 'none'>

const OPERATION_LABELS: Record<ActiveOperation, string> = {
  merge: 'merge',
  rebase: 'rebase',
  'rebase-interactive': 'interactive rebase',
  'cherry-pick': 'cherry-pick',
  revert: 'revert',
  bisect: 'bisect'
}

export type WorkspaceServiceEvent =
  | { type: 'reposChanged'; root: string; diff: RepoDiff; stats?: DiscoveryStats }
  | { type: 'status'; root: string; update: RepoStatusSnapshot }
  | { type: 'commitOutput'; root: string; gitDir: string; chunk: string }
  | { type: 'submoduleOutput'; root: string; gitDir: string; path: string; chunk: string }
  | { type: 'treeChanged'; root: string; paths: string[] }
  | { type: 'issues'; root: string; issues: string[] }
  | { type: 'degraded'; root: string; kind: WatchScopeKind; dir: string; degraded: boolean }
  | { type: 'settingsChanged'; change: SettingsChange }
  | { type: 'keybindingsChanged'; change: KeybindingChange }

export interface WorkspaceServiceOptions {
  /** Directory holding `cache.db` and `settings.json` (normally Electron's userData). */
  userDataDir: string
  /** Injected in tests; a private pool is created (and disposed) otherwise. */
  pool?: GitPool
  /** `undefined` uses the default filesystem backend; `null` disables watching. */
  watchBackend?: WatchBackend | null
  /** Max age of a cached status included in the open response. */
  statusTtlMs?: number
  emit?: (event: WorkspaceServiceEvent) => void
}

/**
 * Owns the app-wide persistence stores and the one open workspace session,
 * exposing everything the IPC layer serves. Never imports Electron, so the whole
 * surface is testable under plain Node.
 */
export class WorkspaceService {
  readonly #pool: GitPool
  readonly #ownsPool: boolean
  readonly #watchBackend: WatchBackend | null | undefined
  readonly #statusTtlMs: number | undefined
  readonly #emit: (event: WorkspaceServiceEvent) => void
  readonly #db: ReturnType<typeof openCacheDatabase>
  readonly #workspaces: WorkspaceStore
  readonly #repos: RepoStore
  readonly #cache: CacheStore
  readonly #settings: SettingsStore
  readonly #keybindings: KeybindingsStore
  readonly #uiState: UiStateStore
  readonly #oplog: OpLogStore
  #session: WorkspaceSession | null = null
  #workspaceId: number | null = null
  #stats: DiscoveryStats | null = null
  #issues: string[] = []
  #rowIdByGitDir = new Map<string, number>()
  #statusAt = new Map<string, number>()
  #writes = new Map<string, Promise<unknown>>()
  #gitVersion: GitVersionInfo | null = null
  #gitVersionDone = false
  #gitVersionProbe: Promise<GitVersionInfo | null> | null = null
  #gitExecutable: string | null = null
  #untrackedByRepo = new Map<string, 'normal' | 'all'>()
  #untrackedDefault: 'normal' | 'all' = 'normal'
  #warmStart: number | null = null
  #warmTarget = 0
  #warmSeen = new Set<string>()
  #disposed = false

  constructor(options: WorkspaceServiceOptions) {
    this.#ownsPool = options.pool === undefined
    this.#pool = options.pool ?? new GitPool()
    this.#watchBackend = options.watchBackend
    this.#statusTtlMs = options.statusTtlMs
    this.#emit = options.emit ?? ((): void => undefined)

    this.#db = openCacheDatabase(join(options.userDataDir, 'cache.db'))
    this.#workspaces = new WorkspaceStore(this.#db)
    this.#repos = new RepoStore(this.#db)
    this.#cache = new CacheStore(this.#db)
    this.#settings = new SettingsStore({ userDataDir: options.userDataDir })
    this.#keybindings = new KeybindingsStore({ userDataDir: options.userDataDir })
    this.#uiState = new UiStateStore(this.#db)
    this.#oplog = new OpLogStore(this.#db)

    this.#settings.onDidChange((change) => {
      this.#emit({ type: 'settingsChanged', change })
      this.#onSettingsChange(change)
    })
    this.#keybindings.onDidChange((change) => {
      this.#emit({ type: 'keybindingsChanged', change })
    })
    void this.#applyGitSettings()
  }

  /** Opens a workspace; opening the already-open root returns its current state. */
  async open(root: string): Promise<WorkspaceDescriptor> {
    this.#assertLive()

    const existing = this.#session
    if (existing !== null && normalizeWorkspaceRoot(existing.root) === normalizeWorkspaceRoot(root)) {
      return this.#descriptor()
    }
    if (existing !== null) await this.#closeSession()

    await this.#applyGitSettings(root)
    await this.#reloadUntrackedStrategy(root)
    const pollIntervalMs = await this.#resolvePollInterval(root)

    const seedRecords = await this.#seedRecords(root)
    const session = new WorkspaceSession({
      root,
      pool: this.#pool,
      watchBackend: this.#watchBackend,
      pollIntervalMs,
      seedRecords,
      untrackedStrategy: (record) => this.#untrackedFor(record),
      onStatus: (gitDir, status) => {
        this.#onStatus(gitDir, status)
      },
      onStatusRead: (_key, ms, skipped) => {
        recordStatusRead(ms, skipped)
      },
      onError: (gitDir, error) => {
        console.warn(`[workspace] status read failed for ${gitDir}`, error)
      },
      onReposChanged: (diff, records, stats) => {
        this.#onReposChanged(diff, records, stats)
      },
      onIssues: (issues) => {
        this.#onIssues(issues)
      },
      onTreeChange: (paths) => {
        this.#onTreeChange(paths)
      },
      onDegraded: (kind, dir, degraded) => {
        this.#onDegraded(kind, dir, degraded)
      }
    })
    this.#session = session

    let result: DiscoveryResult
    const scanStarted = performance.now()
    try {
      result = await session.open()
    } catch (error) {
      this.#session = null
      await session.close().catch(() => undefined)
      throw error
    }
    const seeded = seedRecords.length > 0
    if (!seeded) recordScan(performance.now() - scanStarted, result.repos.length)

    const row = this.#workspaces.upsert(session.root, { name: session.config.name ?? basename(session.root) })
    this.#workspaceId = row.id
    this.#syncRows(session.registry.all)
    this.#stats = result.stats
    this.#issues = [...result.issues]
    this.#warmTarget = result.repos.filter((record) => record.gitDir.length > 0).length
    this.#warmSeen.clear()
    this.#warmStart = this.#warmTarget > 0 ? performance.now() : null

    // The seeded tree came from cache; refresh it against the live filesystem in the
    // background and fold the fresh scan in once it lands.
    if (seeded) void this.#finishRescan(session, scanStarted)
    return this.#descriptor()
  }

  /**
   * Records of the last session for this workspace, read from the cache so the tree
   * can paint before the filesystem scan runs. Empty when the workspace is new.
   */
  async #seedRecords(root: string): Promise<RepoRecord[]> {
    const workspace = this.#workspaces.findByRoot(root)
    if (workspace === null) return []
    const rows = this.#repos.list(workspace.id)
    if (rows.length === 0) return []

    const rootPosix = await realpath(root)
      .then(toPosix)
      .catch(() => toPosix(resolve(root)))
    const rowById = new Map(rows.map((row) => [row.id, row]))
    const records = rows.map((row): RepoRecord => {
      const path = toPosix(resolve(rootPosix, row.relPath))
      const parent = row.parentRowId === null ? undefined : rowById.get(row.parentRowId)
      return {
        id: row.commonDir,
        root: rootPosix,
        relPath: row.relPath,
        path,
        gitDir: row.gitDir,
        commonDir: row.commonDir,
        kind: row.kind,
        parentId: parent === undefined ? null : parent.commonDir,
        name: row.name,
        external: path !== rootPosix && !path.startsWith(`${rootPosix}/`),
        hasSubmodules: false
      }
    })

    await Promise.all(
      records.map(async (record) => {
        if (record.kind === 'bare') return
        record.hasSubmodules = await pathExists(join(record.path, '.gitmodules'))
      })
    )
    records.sort((a, b) => a.relPath.localeCompare(b.relPath))
    return records
  }

  /** Awaits a detached full rescan and folds its outcome into the descriptor state. */
  async #finishRescan(session: WorkspaceSession, startedAt: number): Promise<void> {
    try {
      const result = await session.rescan()
      if (result === null || this.#session !== session) return
      recordScan(performance.now() - startedAt, result.repos.length)
      this.#stats = result.stats
    } catch (error) {
      console.warn('[workspace] background repository refresh failed', error)
    }
  }

  async close(): Promise<null> {
    this.#assertLive()
    await this.#closeSession()
    return null
  }

  recent(): RecentWorkspace[] {
    this.#assertLive()
    return this.#workspaces
      .recent(RECENT_LIMIT)
      .map((row) => ({ root: row.root, name: row.name, lastOpenedAt: row.lastOpenedAt }))
  }

  /** Hides a workspace from the recent list; opening it again restores the entry. */
  removeRecent(root: string): null {
    this.#assertLive()
    this.#workspaces.removeFromRecent(root)
    return null
  }

  /**
   * Full rescan (`dirs === undefined`) or a scoped rescan of the given directories.
   * `raiseBudget` doubles the scan budget for this session and forces a full rescan,
   * so a workspace truncated by the safety budget can be covered.
   */
  async rescan(dirs?: readonly string[], raiseBudget = false): Promise<null> {
    const session = this.#requireSession()
    if (raiseBudget) {
      const config = session.config
      session.setConfig({
        ...config,
        scan: { ...config.scan, maxEntries: config.scan.maxEntries * 2 }
      })
    }
    const scoped =
      dirs === undefined || raiseBudget
        ? undefined
        : await Promise.all(dirs.map((dir) => this.resolveInside(dir)))
    const scanStarted = performance.now()
    const result = await session.rescan(scoped)
    if (result !== null) {
      recordScan(performance.now() - scanStarted, result.repos.length)
      this.#stats = result.stats
    }
    return null
  }

  /** Fresh status read for one checkout (the interactive path, no fingerprint skip). */
  async getStatus(request: GitStatusRequest): Promise<{ status: RepoStatus }> {
    const session = this.#requireSession()
    const record = this.#requireCheckout(session, request.gitDir)
    const status = await session.scheduler.request(this.#statusTarget(record), {
      reason: 'interactive',
      refresh: request.refresh === true
    })
    return { status }
  }

  #requireCheckout(session: WorkspaceSession, gitDir: string): RepoRecord {
    const record = session.registry.all.find((row) => row.gitDir.length > 0 && row.gitDir === gitDir)
    if (record === undefined) {
      throw new ServiceError('unknown-repo', `No checkout with git dir: ${gitDir}`)
    }
    return record
  }

  /** Working-tree path for a checkout; rejects unknown and bare repositories. */
  resolveWorktreePath(gitDir: string): string {
    return this.#requireWriteCheckout(gitDir).path
  }

  /** Root of the open workspace. */
  currentRoot(): string {
    return this.#requireSession().root
  }

  /** Longest registered checkout containing `dir`; `null` when outside every checkout. */
  findRepoRootFor(dir: string): string | null {
    const session = this.#requireSession()
    let best: string | null = null
    for (const record of session.registry.all) {
      if (record.path.length === 0 || !isInsidePath(dir, record.path)) continue
      if (best === null || record.path.length > best.length) best = record.path
    }
    return best
  }

  /** Stages the current content of the paths (additions, edits, deletions). */
  async gitStage(request: GitPathsRequest): Promise<null> {
    const record = this.#requireWriteCheckout(request.gitDir)
    await this.#gitOperation(record, (repoPath) => gitStagePaths(repoPath, request.paths))
    return null
  }

  /** Unstages the paths, keeping the working tree untouched. */
  async gitUnstage(request: GitPathsRequest): Promise<null> {
    const record = this.#requireWriteCheckout(request.gitDir)
    await this.#gitOperation(record, (repoPath) => gitUnstagePaths(repoPath, request.paths))
    return null
  }

  /** Restores tracked paths in the working tree from the index. Destroying. */
  async gitDiscard(request: GitPathsRequest): Promise<null> {
    const record = this.#requireWriteCheckout(request.gitDir)
    await this.#gitOperation(record, (repoPath) => discardWorktreePaths(repoPath, request.paths))
    return null
  }

  async gitStageAll(request: GitCheckoutRequest): Promise<null> {
    const record = this.#requireWriteCheckout(request.gitDir)
    await this.#gitOperation(record, (repoPath) => gitStageAll(repoPath))
    return null
  }

  async gitUnstageAll(request: GitCheckoutRequest): Promise<null> {
    const record = this.#requireWriteCheckout(request.gitDir)
    await this.#gitOperation(record, (repoPath) => gitUnstageAll(repoPath))
    return null
  }

  /** Appends an anchored ignore pattern for an untracked entry and stages `.gitignore`. */
  async gitIgnore(request: GitIgnoreRequest): Promise<{ pattern: string }> {
    const record = this.#requireWriteCheckout(request.gitDir)
    const isDir = request.path.endsWith('/')
    const entry = isDir ? request.path.slice(0, -1) : request.path
    const pattern = `/${entry}${isDir ? '/' : ''}`
    await this.#gitOperation(record, async (repoPath) => {
      const file = join(repoPath, '.gitignore')
      let content = ''
      try {
        content = await readFile(file, 'utf8')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      if (!content.split(/\r?\n/).includes(pattern)) {
        const separator = content.length === 0 || content.endsWith('\n') ? '' : '\n'
        await writeFile(file, `${content}${separator}${pattern}\n`, 'utf8')
      }
      await gitStagePaths(repoPath, ['.gitignore'])
    })
    return { pattern }
  }

  /** Both sides of a file comparison plus the raw patch used for hunk actions. */
  async gitDiff(request: GitDiffRequest): Promise<GitDiffResponse> {
    const record = this.#requireCheckout(this.#requireSession(), request.gitDir)
    return await readDiff(record.path, request)
  }

  /** Applies one hunk patch to the index (`stage`/`unstage`) or the working tree (`revert`). */
  async gitApplyHunk(request: GitApplyHunkRequest): Promise<null> {
    const record = this.#requireWriteCheckout(request.gitDir)
    await this.#gitOperation(record, (repoPath) => applyPatch(repoPath, request.patch, request.mode))
    return null
  }

  /**
   * Commits the index or amends HEAD. Hooks run unless the workspace is untrusted;
   * their output streams through `commitOutput` events while the command runs.
   */
  async gitCommit(request: GitCommitRequest): Promise<{ sha: string }> {
    const session = this.#requireSession()
    const record = this.#requireWriteCheckout(request.gitDir)
    const suppressHooks = !this.#workspaces.isTrusted(session.root)
    return await this.#gitOperation(record, async (repoPath) => {
      if (request.stageAll === true) await gitStageAll(repoPath)
      return await createCommit({
        repoPath,
        message: request.message,
        signOff: request.signOff === true,
        amend: request.amend === true,
        suppressHooks,
        onOutput: (chunk) => {
          this.#emit({ type: 'commitOutput', root: session.root, gitDir: record.gitDir, chunk })
        }
      })
    })
  }

  /** HEAD commit (full message) plus whether it is already on a remote. */
  async gitHeadCommit(request: GitHeadCommitRequest): Promise<GitHeadCommitResponse> {
    const record = this.#requireCheckout(this.#requireSession(), request.gitDir)
    const [commit, pushed] = await Promise.all([
      readHeadCommit({ repoPath: record.path }),
      isHeadPushed({ repoPath: record.path })
    ])
    return { commit, pushed }
  }

  async gitFileLog(request: GitFileLogRequest): Promise<{ commits: CommitInfo[]; hasMore: boolean }> {
    const record = this.#requireCheckout(this.#requireSession(), request.gitDir)
    return await logCommits({
      repoPath: record.path,
      maxCount: request.limit,
      skip: request.skip,
      path: request.path
    })
  }

  /** One page of the commit graph with ref labels and upstream marks. */
  async gitGraph(request: GitGraphRequest): Promise<GitGraphResponse> {
    const record = this.#requireCheckout(this.#requireSession(), request.gitDir)
    const filters = {
      author: request.author,
      since: request.since,
      until: request.until,
      grep: request.grep
    }
    const start = request.revs === undefined ? ({ all: true } as const) : { revs: request.revs }
    const firstPage = request.skip === undefined || request.skip === 0
    try {
      const [page, marks, refs, total] = await Promise.all([
        logCommits({
          repoPath: record.path,
          ...start,
          ...filters,
          path: request.path,
          topoOrder: true,
          maxCount: request.limit,
          skip: request.skip
        }),
        // The marks describe HEAD against its upstream, so appended pages reuse them.
        firstPage
          ? readUpstreamMarks({ repoPath: record.path })
          : Promise.resolve({ upstream: null, outgoing: [], incoming: [] }),
        listRefs({ repoPath: record.path }),
        request.countTotal === true
          ? countCommits({ repoPath: record.path, ...start, ...filters, path: request.path })
          : Promise.resolve(null)
      ])
      return {
        commits: page.commits,
        hasMore: page.hasMore,
        upstream: marks.upstream,
        outgoing: marks.outgoing,
        incoming: marks.incoming,
        refs,
        total
      }
    } catch (error) {
      throw toGitServiceError(error)
    }
  }

  /** Recent HEAD commits of many checkouts folded into one workspace timeline. */
  async gitActivity(request: GitActivityRequest): Promise<GitActivityResponse> {
    const session = this.#requireSession()
    const maxPerRepo = request.maxPerRepo ?? 100
    const entries: GitActivityEntry[] = []
    const failures: GitActivityResponse['failures'] = []
    const truncated: string[] = []
    let next = 0
    // One git process per checkout at once would stall a workspace with
    // hundreds of repositories, so the reads advance in small waves.
    const drain = async (): Promise<void> => {
      for (;;) {
        const gitDir = request.gitDirs[next]
        if (gitDir === undefined) return
        next += 1
        try {
          const record = this.#requireCheckout(session, gitDir)
          const page = await logCommits({
            repoPath: record.path,
            revs: ['HEAD'],
            author: request.author,
            since: request.since,
            grep: request.grep,
            maxCount: maxPerRepo
          })
          for (const commit of page.commits) entries.push({ gitDir, repoName: record.name, commit })
          if (page.hasMore) truncated.push(gitDir)
        } catch (error) {
          failures.push({ gitDir, message: toGitServiceError(error).message })
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(8, request.gitDirs.length) }, () => drain()))

    entries.sort((a, b) => {
      const newer = Date.parse(b.commit.author.date)
      const older = Date.parse(a.commit.author.date)
      if (Number.isNaN(newer) || Number.isNaN(older)) return 0
      return newer - older
    })
    return { entries, failures, truncated }
  }

  /** Full message, identities, parents and per-file stats of one commit. */
  async gitCommitDetails(request: GitCommitDetailsRequest): Promise<GitCommitDetailsResponse> {
    const record = this.#requireCheckout(this.#requireSession(), request.gitDir)
    try {
      return { commit: await readCommitDetails({ repoPath: record.path, sha: request.sha }) }
    } catch (error) {
      throw toGitServiceError(error)
    }
  }

  async gitRefs(request: GitRefsRequest): Promise<{ refs: GitRef[] }> {
    const record = this.#requireCheckout(this.#requireSession(), request.gitDir)
    return { refs: await listRefs({ repoPath: record.path }) }
  }

  /** Files that differ between two revisions, rename-aware (branch comparison). */
  async gitDiffFiles(request: GitDiffFilesRequest): Promise<{ files: FileChange[] }> {
    const record = this.#requireCheckout(this.#requireSession(), request.gitDir)
    try {
      return { files: await listChangedFiles(record.path, { from: request.from, to: request.to }) }
    } catch (error) {
      throw toGitServiceError(error)
    }
  }

  /** Merges a revision into the current branch; conflicts leave the merge stopped. */
  async gitMerge(request: GitMergeRequest): Promise<GitMergeResponse> {
    const record = this.#requireWriteCheckout(request.gitDir)
    await this.#assertNoOperation(record, 'Merge')
    return await this.#gitOperation(record, (repoPath) =>
      mergeRepo(repoPath, { rev: request.rev, mode: request.mode })
    )
  }

  /** Rebases the current branch onto a ref; the pre-rebase tip is backed up first. */
  async gitRebase(request: GitRebaseRequest): Promise<GitOperationResponse> {
    const record = this.#requireWriteCheckout(request.gitDir)
    await this.#assertNoOperation(record, 'Rebase')
    return await this.#gitOperation(record, async (repoPath) => {
      await verifyRevision(repoPath, request.onto)
      const backup = await createBackupRef({ repoPath, op: 'rebase', target: 'HEAD' })
      const result = await rebaseOnto(repoPath, { onto: request.onto })
      const undo = this.#recordOperation(record, 'rebase', {
        backupRef: backup.ref,
        undoState: encodeUndoState({
          kind: 'rebase',
          before: backup.sha,
          target: await this.#headRef(repoPath)
        })
      })
      return { ...result, undo }
    })
  }

  /** Commits an interactive rebase would replay, oldest first. */
  async gitRebasePlan(request: GitRebasePlanRequest): Promise<GitRebasePlanResponse> {
    const record = this.#requireCheckout(this.#requireSession(), request.gitDir)
    try {
      return { commits: await loadRebasePlan({ repoPath: record.path, base: request.base }) }
    } catch (error) {
      throw toGitServiceError(error)
    }
  }

  /** Runs the list editor's plan; reword and squash messages are applied as git replays. */
  async gitRebaseInteractive(request: GitRebaseInteractiveRequest): Promise<GitOperationResponse> {
    const record = this.#requireWriteCheckout(request.gitDir)
    await this.#assertNoOperation(record, 'Rebase')
    return await this.#gitOperation(record, async (repoPath) => {
      const plan = new Map(
        (await loadRebasePlan({ repoPath, base: request.base })).map((commit) => [
          commit.sha,
          commit.subject
        ])
      )
      const steps = request.steps.map((step) => ({
        sha: step.sha,
        action: step.action,
        subject: plan.get(step.sha),
        message: step.message
      }))
      for (const step of steps) {
        if (
          step.action === 'reword' &&
          (step.subject === undefined ||
            step.subject.length === 0 ||
            step.message === undefined ||
            step.message.length === 0)
        ) {
          throw new ServiceError(
            'invalid-request',
            'A reword step needs the original commit and the new message'
          )
        }
      }
      const backup = await createBackupRef({ repoPath, op: 'rebase-interactive', target: 'HEAD' })
      const result = await rebaseInteractive(repoPath, { base: request.base, steps })
      const undo = this.#recordOperation(record, 'rebase-interactive', {
        backupRef: backup.ref,
        undoState: encodeUndoState({
          kind: 'rebase',
          before: backup.sha,
          target: await this.#headRef(repoPath)
        })
      })
      return { ...result, undo }
    })
  }

  /** Rewrites the metadata of one or more commits; the old tip is backed up first. */
  async gitEditCommit(request: GitEditCommitRequest): Promise<GitEditCommitResponse> {
    const session = this.#requireSession()
    const record = this.#requireWriteCheckout(request.gitDir)
    if (request.targets.length > 1 && request.message !== undefined) {
      throw new ServiceError(
        'invalid-request',
        'A replacement message is only valid for a single commit'
      )
    }
    await this.#assertNoOperation(record, 'History rewrite')
    const suppressHooks = !this.#workspaces.isTrusted(session.root)
    return await this.#gitOperation(record, async (repoPath) => {
      const edits = request.targets.map((sha) => ({
        sha,
        message: request.message,
        authorName: request.authorName,
        authorEmail: request.authorEmail,
        authorDate: request.authorDate,
        committerDate: request.committerDate
      }))
      const backup = await createBackupRef({ repoPath, op: 'edit-commit', target: 'HEAD' })
      const result = await editCommits(repoPath, { edits, suppressHooks })
      const undo = this.#recordOperation(record, 'edit-commit', {
        backupRef: backup.ref,
        undoState: encodeUndoState({
          kind: 'rebase',
          before: backup.sha,
          target: await this.#headRef(repoPath)
        })
      })
      return { stopped: result.stopped, sha: result.sha, backup, undo }
    })
  }

  /** Continues the stopped merge, rebase, cherry-pick or revert. */
  async gitOpContinue(request: GitOpRequest): Promise<GitOperationResponse> {
    const record = this.#requireWriteCheckout(request.gitDir)
    const kind = await this.#requireOperation(record)
    return await this.#gitOperation(record, async (repoPath) => {
      switch (kind) {
        case 'merge':
          return { ...(await mergeContinue(repoPath)), undo: null }
        case 'rebase':
        case 'rebase-interactive':
          return {
            ...(await rebaseAction('continue', repoPath)),
            undo: this.#latestUndo(record, ['rebase-interactive', 'rebase'])
          }
        case 'cherry-pick':
          return { ...(await cherryPickAction('continue', repoPath)), undo: null }
        case 'revert':
          return { ...(await revertAction('continue', repoPath)), undo: null }
        default:
          throw new ServiceError(
            'invalid-request',
            `A ${OPERATION_LABELS[kind]} cannot be continued here`
          )
      }
    })
  }

  /** Skips the current commit of a stopped rebase or cherry-pick. */
  async gitOpSkip(request: GitOpRequest): Promise<GitOperationResponse> {
    const record = this.#requireWriteCheckout(request.gitDir)
    const kind = await this.#requireOperation(record)
    return await this.#gitOperation(record, async (repoPath) => {
      switch (kind) {
        case 'rebase':
        case 'rebase-interactive':
          return {
            ...(await rebaseAction('skip', repoPath)),
            undo: this.#latestUndo(record, ['rebase-interactive', 'rebase'])
          }
        case 'cherry-pick':
          return { ...(await cherryPickAction('skip', repoPath)), undo: null }
        case 'revert':
          return { ...(await revertAction('skip', repoPath)), undo: null }
        case 'merge':
          throw new ServiceError(
            'invalid-request',
            'A merge has nothing to skip; continue or abort it instead'
          )
        default:
          throw new ServiceError('invalid-request', `A ${OPERATION_LABELS[kind]} cannot be skipped here`)
      }
    })
  }

  /** Aborts the operation in progress, restoring the pre-operation state exactly. */
  async gitOpAbort(request: GitOpRequest): Promise<null> {
    const record = this.#requireWriteCheckout(request.gitDir)
    const kind = await this.#requireOperation(record)
    await this.#gitOperation(record, async (repoPath) => {
      switch (kind) {
        case 'merge':
          await mergeAbort(repoPath)
          return
        case 'rebase':
        case 'rebase-interactive':
          await rebaseAction('abort', repoPath)
          return
        case 'cherry-pick':
          await cherryPickAction('abort', repoPath)
          return
        case 'revert':
          await revertAction('abort', repoPath)
          return
        default:
          throw new ServiceError('invalid-request', `A ${OPERATION_LABELS[kind]} cannot be aborted here`)
      }
    })
    return null
  }

  /** Applies commits onto the current branch, in the order given. */
  async gitCherryPick(request: GitCherryPickRequest): Promise<GitOperationResponse> {
    const record = this.#requireWriteCheckout(request.gitDir)
    await this.#assertNoOperation(record, 'Cherry-pick')
    return await this.#gitOperation(record, async (repoPath) => ({
      ...(await cherryPick(repoPath, {
        revs: request.revs,
        noCommit: request.noCommit,
        mainline: request.mainline
      })),
      undo: null
    }))
  }

  /** Undoes commits by replaying their inverses, in the order given. */
  async gitRevert(request: GitRevertRequest): Promise<GitOperationResponse> {
    const record = this.#requireWriteCheckout(request.gitDir)
    await this.#assertNoOperation(record, 'Revert')
    return await this.#gitOperation(record, async (repoPath) => ({
      ...(await revertCommit(repoPath, {
        revs: request.revs,
        noCommit: request.noCommit,
        mainline: request.mainline
      })),
      undo: null
    }))
  }

  /** Moves the current branch to a revision; `hard` takes a backup ref first. */
  async gitReset(request: GitResetRequest): Promise<GitResetResponse> {
    const record = this.#requireWriteCheckout(request.gitDir)
    await this.#assertNoOperation(record, 'Reset')
    return await this.#gitOperation(record, async (repoPath) => {
      const before = await verifyRevision(repoPath, 'HEAD')
      await verifyRevision(repoPath, request.target)
      const backup =
        request.mode === 'hard'
          ? await createBackupRef({ repoPath, op: 'reset-hard', target: 'HEAD' })
          : null
      await resetRepo(repoPath, { target: request.target, mode: request.mode })
      const after = await readHeadSha(repoPath)
      const undo = this.#recordOperation(record, `reset-${request.mode}`, {
        backupRef: backup?.ref ?? null,
        undoState: encodeUndoState({
          kind: 'reset',
          mode: request.mode,
          before,
          target: await this.#headRef(repoPath)
        })
      })
      return { before, after, backup, undo }
    })
  }

  /** Resolves one conflicted path onto a side and stages the result. */
  async gitConflictResolve(request: GitConflictResolveRequest): Promise<null> {
    const record = this.#requireWriteCheckout(request.gitDir)
    await this.#gitOperation(record, async (repoPath) => {
      const status = await readStatus({ repoPath, untracked: 'no' })
      const entry = status.conflicted.find((row) => row.path === request.path)
      if (entry === undefined) {
        throw new ServiceError('not-conflicted', `Not an unresolved conflict: ${request.path}`)
      }
      await resolveConflict(repoPath, {
        path: request.path,
        code: entry.code,
        resolution: request.resolution
      })
    })
    return null
  }

  /** Stashes working-tree changes, all of them or a path subset. */
  async gitStashCreate(request: GitStashCreateRequest): Promise<GitStashCreateResponse> {
    const record = this.#requireWriteCheckout(request.gitDir)
    await this.#assertNoOperation(record, 'Stash')
    return await this.#gitOperation(record, (repoPath) =>
      createStash(repoPath, {
        message: request.message,
        includeUntracked: request.includeUntracked,
        keepIndex: request.keepIndex,
        paths: request.paths
      })
    )
  }

  async gitStashList(request: GitCheckoutRequest): Promise<GitStashListResponse> {
    const record = this.#requireCheckout(this.#requireSession(), request.gitDir)
    try {
      return { stashes: await listStashes({ repoPath: record.path }) }
    } catch (error) {
      throw toGitServiceError(error)
    }
  }

  async gitStashFiles(request: GitStashRequest): Promise<GitStashFilesResponse> {
    const record = this.#requireCheckout(this.#requireSession(), request.gitDir)
    try {
      return { files: await stashFileChanges(record.path, { stash: request.stash }) }
    } catch (error) {
      throw toGitServiceError(error)
    }
  }

  async gitStashDiff(request: GitStashDiffRequest): Promise<GitStashDiffResponse> {
    const record = this.#requireCheckout(this.#requireSession(), request.gitDir)
    try {
      return { diff: await readStashDiff(record.path, { stash: request.stash, path: request.path }) }
    } catch (error) {
      throw toGitServiceError(error)
    }
  }

  /** Applies a stash, keeping the entry; conflicts remain in the working tree. */
  async gitStashApply(request: GitStashRequest): Promise<GitOperationResponse> {
    const record = this.#requireWriteCheckout(request.gitDir)
    await this.#assertNoOperation(record, 'Stash apply')
    return await this.#gitOperation(record, async (repoPath) => ({
      ...(await applyStash(repoPath, { stash: request.stash })),
      undo: null
    }))
  }

  /** Applies a stash and drops it; a conflicted pop keeps the entry. */
  async gitStashPop(request: GitStashRequest): Promise<GitOperationResponse> {
    const record = this.#requireWriteCheckout(request.gitDir)
    await this.#assertNoOperation(record, 'Stash pop')
    return await this.#gitOperation(record, async (repoPath) => ({
      ...(await popStash(repoPath, { stash: request.stash })),
      undo: null
    }))
  }

  /** Drops a stash entry after backing it up, so the drop stays undoable. */
  async gitStashDrop(request: GitStashRequest): Promise<GitStashDropResponse> {
    const record = this.#requireWriteCheckout(request.gitDir)
    await this.#assertNoOperation(record, 'Stash drop')
    return await this.#gitOperation(record, async (repoPath) => {
      const entry = await readStashEntry(repoPath, { stash: request.stash })
      if (entry === null) {
        throw new ServiceError('invalid-request', `No stash entry named ${request.stash}`)
      }
      const backup = await createBackupRef({ repoPath, op: 'stash-drop', target: entry.sha })
      const undo = this.#recordOperation(record, 'stash-drop', {
        backupRef: backup.ref,
        undoState: encodeUndoState({ kind: 'stash-drop', before: entry.sha, subject: entry.subject })
      })
      await dropStash(repoPath, { stash: request.stash })
      return { backup, undo }
    })
  }

  /** Commit walk used by history surfaces; `revs` narrows it to ranges. */
  async gitLog(request: GitLogRequest): Promise<GitLogResponse> {
    const record = this.#requireCheckout(this.#requireSession(), request.gitDir)
    try {
      return await logCommits({
        repoPath: record.path,
        revs: request.revs,
        maxCount: request.limit,
        skip: request.skip
      })
    } catch (error) {
      throw toGitServiceError(error)
    }
  }

  /** Operation log of the repository, newest first. */
  gitOpLog(request: GitOpLogRequest): GitOpLogResponse {
    const record = this.#requireCheckout(this.#requireSession(), request.gitDir)
    const rowId = this.#rowIdByGitDir.get(record.gitDir)
    if (rowId === undefined) return { entries: [] }
    return {
      entries: this.#oplog.list({ repoId: rowId, limit: request.limit }).map((row) => ({
        id: row.id,
        op: row.op,
        backupRef: row.backupRef,
        at: row.at,
        target: this.#undoTarget(row.undoState)
      }))
    }
  }

  /** Reverses one logged operation through its undo state (or its backup ref). */
  async gitOpLogUndo(request: GitOpLogUndoRequest): Promise<null> {
    const record = this.#requireWriteCheckout(request.gitDir)
    await this.#assertNoOperation(record, 'Undo')
    const rowId = this.#rowIdByGitDir.get(record.gitDir) ?? null
    const row = this.#oplog.get(request.entryId)
    if (row === null || row.repoId !== rowId) {
      throw new ServiceError('invalid-request', 'Unknown operation-log entry')
    }
    await this.#gitOperation(record, async (repoPath) => {
      const backupSha = row.backupRef === null ? null : await readBackupSha(repoPath, row.backupRef)
      const descriptor =
        parseUndoState(row.undoState) ?? this.#fallbackDescriptor(row.backupRef, backupSha)
      if (descriptor === null) {
        throw new ServiceError('invalid-request', 'This operation has nothing to restore')
      }
      await performUndo(repoPath, { descriptor, backupSha })
      this.#oplog.updateUndoState(row.id, null)
    })
    return null
  }

  /** Recent backup refs with the operation, time and target they restore. */
  async gitBackups(request: GitCheckoutRequest): Promise<GitBackupsResponse> {
    const record = this.#requireCheckout(this.#requireSession(), request.gitDir)
    try {
      const refs = await listBackupRefs({ repoPath: record.path })
      return {
        entries: refs.map((backup) => ({
          ref: backup.ref,
          op: backup.op,
          sha: backup.sha,
          createdAt: backup.createdAt,
          target: this.#undoTarget(this.#oplog.findByBackupRef(backup.ref)?.undoState ?? null)
        }))
      }
    } catch (error) {
      throw toGitServiceError(error)
    }
  }

  /** Restores the state captured by a backup ref; the current state is backed up first. */
  async gitRestoreBackup(request: GitRestoreBackupRequest): Promise<null> {
    const record = this.#requireWriteCheckout(request.gitDir)
    await this.#assertNoOperation(record, 'Restore')
    await this.#gitOperation(record, async (repoPath) => {
      const backupSha = await readBackupSha(repoPath, request.ref)
      if (backupSha === null) {
        throw new ServiceError('invalid-request', 'Unknown backup ref')
      }
      const row = this.#oplog.findByBackupRef(request.ref)
      const descriptor =
        parseUndoState(row?.undoState ?? null) ?? this.#fallbackDescriptor(request.ref, backupSha)
      if (descriptor === null) {
        throw new ServiceError('invalid-request', 'This backup cannot be restored automatically')
      }
      const before = await readHeadSha(repoPath)
      const destructive =
        descriptor.kind === 'rebase' ||
        (descriptor.kind === 'reset' && (descriptor.mode ?? 'mixed') === 'hard')
      if (destructive && before !== null && before !== backupSha) {
        const guard = await createBackupRef({ repoPath, op: 'restore', target: 'HEAD' })
        this.#recordOperation(record, 'restore', {
          backupRef: guard.ref,
          undoState: encodeUndoState({
            kind: 'reset',
            mode: 'hard',
            before,
            target: await this.#headRef(repoPath)
          })
        })
      }
      await performUndo(repoPath, { descriptor, backupSha })
      if (row !== null) this.#oplog.updateUndoState(row.id, null)
    })
    return null
  }

  /** Working trees of a checkout: the main tree, linked worktrees and prunable leftovers. */
  async gitWorktrees(request: GitCheckoutRequest): Promise<GitWorktreesResponse> {
    const record = this.#requireCheckout(this.#requireSession(), request.gitDir)
    try {
      const worktrees = await listWorktrees({ repoPath: record.path })
      return {
        worktrees: await Promise.all(
          worktrees.map(async (worktree) => ({ ...worktree, path: await this.#absPosix(worktree.path) }))
        )
      }
    } catch (error) {
      throw toGitServiceError(error)
    }
  }

  /** Adds a linked working tree on an existing branch, a new branch or a detached revision. */
  async gitWorktreeAdd(request: GitWorktreeAddRequest): Promise<GitWorktreeAddResponse> {
    const record = this.#requireWriteCheckout(request.gitDir)
    const mode = this.#worktreeAddMode(request)
    await this.#gitOperation(record, async (repoPath) => {
      if (mode.kind === 'branch') await this.#assertBranchFree(repoPath, mode.branch)
      await addWorktree({ repoPath, path: request.path, mode })
    })
    const created = await this.#absPosix(request.path)
    await this.#refreshAfterWorktreeAdd(record, created)
    return { path: created }
  }

  /**
   * Removes a linked worktree. A locked worktree is refused; a dirty one requires
   * `force`, which takes a backup ref first. Either way the removal stays undoable
   * by recreating the worktree.
   */
  async gitWorktreeRemove(request: GitWorktreeRemoveRequest): Promise<GitWorktreeRemoveResponse> {
    const session = this.#requireSession()
    const record = this.#requireWriteCheckout(request.gitDir)
    const target = await this.#findWorktree(record, request.path)
    if (target === null) {
      throw new ServiceError('invalid-request', `Unknown worktree: ${request.path}`)
    }
    // Run from the main checkout: removing the directory git currently sits in
    // fails on Windows.
    const main = session.registry.all.find((row) => row.gitDir === row.id && row.id === record.id)
    const repoPath = main?.path ?? record.path
    const response = await this.#gitOperation(record, async () => {
      if (target.locked !== null) {
        throw new ServiceError('worktree-locked', `Worktree "${target.path}" is locked; unlock it first`)
      }
      let backup: BackupRef | null = null
      if (request.force !== true) {
        const dirty = await isWorktreeDirty(target.path)
        if (dirty === true) {
          throw new ServiceError('worktree-dirty', `Worktree "${target.path}" has uncommitted changes`)
        }
      } else if (target.sha !== null) {
        backup = await createBackupRef({ repoPath, op: 'worktree-remove', target: target.sha })
      }
      await removeWorktree({ repoPath, path: target.path, force: request.force === true })
      const branch = target.branch === null ? null : target.branch.replace(/^refs\/heads\//, '')
      const undo = this.#recordOperation(record, 'worktree-remove', {
        backupRef: backup?.ref ?? null,
        undoState: encodeUndoState({
          kind: 'worktree-remove',
          name: target.path,
          ...(target.sha === null ? {} : { before: target.sha }),
          target: branch ?? 'HEAD'
        })
      })
      return { backup, undo }
    })
    await this.#refreshAfterWorktreeRemove(target.path)
    return response
  }

  /** Drops metadata of deleted worktrees; rows of gone worktrees follow. */
  async gitWorktreePrune(request: GitCheckoutRequest): Promise<null> {
    const record = this.#requireWriteCheckout(request.gitDir)
    const stale = (await listWorktrees({ repoPath: record.path }))
      .filter((worktree) => worktree.prunable !== null && !worktree.bare)
      .map((worktree) => worktree.path)
    await this.#gitOperation(record, (repoPath) => pruneWorktrees({ repoPath }))
    const dirs: string[] = []
    for (const path of stale) {
      try {
        dirs.push(await this.resolveInside(path))
      } catch {
        // Nothing registered at that path; only the git metadata needed pruning.
      }
    }
    if (dirs.length > 0) await this.rescan(dirs)
    return null
  }

  /** Locks a worktree so prune and remove leave it alone until it is unlocked. */
  async gitWorktreeLock(request: GitWorktreeLockRequest): Promise<null> {
    const record = this.#requireWriteCheckout(request.gitDir)
    const target = await this.#findWorktree(record, request.path)
    if (target === null) {
      throw new ServiceError('invalid-request', `Unknown worktree: ${request.path}`)
    }
    await this.#gitOperation(record, () =>
      lockWorktree({ repoPath: record.path, path: target.path, reason: request.reason })
    )
    await this.#refreshWorktreeState(record)
    return null
  }

  async gitWorktreeUnlock(request: GitWorktreeTargetRequest): Promise<null> {
    const record = this.#requireWriteCheckout(request.gitDir)
    const target = await this.#findWorktree(record, request.path)
    if (target === null) {
      throw new ServiceError('invalid-request', `Unknown worktree: ${request.path}`)
    }
    await this.#gitOperation(record, () =>
      unlockWorktree({ repoPath: record.path, path: target.path })
    )
    await this.#refreshWorktreeState(record)
    return null
  }

  /** Submodule state of a checkout, straight from `git submodule status`. */
  async gitSubmodules(request: GitCheckoutRequest): Promise<GitSubmodulesResponse> {
    const record = this.#requireCheckout(this.#requireSession(), request.gitDir)
    return { submodules: await listSubmodules({ repoPath: record.path }) }
  }

  /**
   * Updates submodules in parallel, one git process per submodule, streaming each
   * submodule's output tagged with its path. A result reports whether the submodule
   * changed state, so already-in-sync entries stay unremarkable.
   */
  async gitSubmoduleUpdate(request: GitSubmoduleUpdateRequest): Promise<GitSubmoduleUpdateResponse> {
    const session = this.#requireSession()
    const record = this.#requireWriteCheckout(request.gitDir)
    const before = await listSubmodules({ repoPath: record.path })
    const requested = request.paths
    const targets =
      requested === undefined ? before : before.filter((entry) => requested.includes(entry.path))
    const results = await Promise.all(
      targets.map((entry) =>
        this.#pool.run(() => this.#updateSubmoduleOne(record, entry, session.root, request), {
          priority: 'interactive'
        })
      )
    )
    await this.#refreshSubmoduleRecords(
      record,
      results.filter((row) => row.updated).map((row) => row.path)
    )
    // Freshly cloned checkouts register through a scoped rescan, so their rows
    // appear without waiting for the watcher.
    const initialized = results.filter(
      (row) => row.ok && before.find((entry) => entry.path === row.path)?.checkout === 'uninitialized'
    )
    const dirs: string[] = []
    for (const row of initialized) {
      try {
        dirs.push(await this.resolveInside(toPosix(join(record.path, row.path))))
      } catch {
        // The checkout did not appear; there is no row to register.
      }
    }
    if (dirs.length > 0) await this.rescan(dirs)
    return { results }
  }

  /** Re-copies `.gitmodules` URLs into the git configuration. */
  async gitSubmoduleSync(request: GitSubmoduleSyncRequest): Promise<GitSubmoduleSyncResponse> {
    const record = this.#requireWriteCheckout(request.gitDir)
    const result = await this.#gitOperation(record, (repoPath) =>
      syncSubmoduleUrls({ repoPath, paths: request.paths, recursive: request.recursive === true })
    )
    return { output: `${result.stdout}${result.stderr}`.trimEnd() }
  }

  /**
   * One submodule update in its own git process. Concurrent updates of different
   * submodules write disjoint directories, so they skip the per-checkout write lock.
   */
  async #updateSubmoduleOne(
    record: RepoRecord,
    entry: SubmoduleInfo,
    root: string,
    request: GitSubmoduleUpdateRequest
  ): Promise<GitSubmoduleUpdateResult> {
    const chunks: string[] = []
    try {
      await updateSubmodules({
        repoPath: record.path,
        paths: [entry.path],
        init: request.init === true,
        recursive: request.recursive === true,
        onOutput: (chunk) => {
          chunks.push(chunk)
          this.#emit({ type: 'submoduleOutput', root, gitDir: record.gitDir, path: entry.path, chunk })
        }
      })
    } catch (error) {
      return {
        path: entry.path,
        ok: false,
        updated: false,
        error: messageOf(toGitServiceError(error)),
        output: chunks.join('')
      }
    }
    const state =
      (await listSubmodules({ repoPath: record.path })).find((row) => row.path === entry.path)?.checkout ??
      null
    if (state === 'in-sync') {
      return {
        path: entry.path,
        ok: true,
        updated: entry.checkout !== 'in-sync',
        error: null,
        output: chunks.join('')
      }
    }
    return {
      path: entry.path,
      ok: false,
      updated: false,
      error:
        state === null
          ? 'The submodule is missing after the update'
          : `The submodule is ${state} after the update`,
      output: chunks.join('')
    }
  }

  /** Refreshes status of the parent and of any registered checkout at changed submodule paths. */
  async #refreshSubmoduleRecords(record: RepoRecord, paths: readonly string[]): Promise<void> {
    const session = this.#session
    if (session === null) return
    const keys = new Set(paths.map((path) => this.#pathKey(toPosix(join(record.path, path)))))
    for (const row of session.registry.all) {
      if (keys.has(this.#pathKey(row.path))) this.#refreshStatus(row)
    }
    this.#refreshStatus(record)
  }

  /**
   * Brings a freshly created worktree into the registry. Scanning a directory
   * picks up all worktrees of the repositories it finds, so the target's own
   * directory covers in-root paths and the main checkout covers the rest.
   */
  async #refreshAfterWorktreeAdd(record: RepoRecord, target: string): Promise<void> {
    const session = this.#session
    if (session === null) return
    if (target === session.root || target.startsWith(`${session.root}/`)) {
      await this.rescan([target])
      return
    }
    const main = session.registry.all.find((row) => row.gitDir === row.id && row.id === record.id)
    if (main === undefined) {
      await this.rescan()
      return
    }
    await this.rescan([main.path])
  }

  /**
   * Drops the registry row of a removed worktree: scanning its (now gone) path
   * replaces the in-scope records with nothing. Unregistered paths are skipped.
   */
  async #refreshAfterWorktreeRemove(target: string): Promise<void> {
    const session = this.#session
    if (session === null) return
    const insideRoot = target === session.root || target.startsWith(`${session.root}/`)
    const registered = session.registry.all.some(
      (row) => this.#pathKey(row.path) === this.#pathKey(target)
    )
    if (registered || insideRoot) await this.rescan([target])
  }

  /** Re-reads worktree metadata (lock state) by scanning the owning main checkout. */
  async #refreshWorktreeState(record: RepoRecord): Promise<void> {
    const session = this.#session
    if (session === null) return
    const main = session.registry.all.find(
      (row) => row.gitDir === row.id && row.id === record.id && row.kind !== 'bare'
    )
    await this.rescan([main?.path ?? record.path])
  }

  /**
   * Cleans worktree metadata after a fetch; stale metadata is cosmetic, so a
   * failure here never fails the network operation.
   */
  async #pruneStaleWorktrees(record: RepoRecord): Promise<void> {
    try {
      if (!(await pathExists(`${record.commonDir}/worktrees`))) return
      await this.#gitOperation(record, (repoPath) => pruneWorktrees({ repoPath }))
    } catch {
      // Retried on the next fetch.
    }
  }

  #worktreeAddMode(request: GitWorktreeAddRequest): WorktreeAddMode {
    const { branch, newBranch, detachAt } = request
    const modes: WorktreeAddMode[] = []
    if (branch !== undefined) modes.push({ kind: 'branch', branch })
    if (newBranch !== undefined) {
      modes.push(
        request.base === undefined
          ? { kind: 'new-branch', branch: newBranch }
          : { kind: 'new-branch', branch: newBranch, base: request.base }
      )
    }
    if (detachAt !== undefined) modes.push({ kind: 'detach', rev: detachAt })
    const mode = modes[0]
    if (modes.length !== 1 || mode === undefined) {
      throw new ServiceError('invalid-request', 'Exactly one of branch, newBranch or detachAt is required')
    }
    return mode
  }

  /** Rejects a branch that is already checked out elsewhere; git would fail mid-add. */
  async #assertBranchFree(repoPath: string, branch: string): Promise<void> {
    const ref = `refs/heads/${branch}`
    const worktrees = await listWorktrees({ repoPath })
    if (worktrees.some((worktree) => worktree.branch === ref)) {
      throw new ServiceError('branch-in-use', `Branch "${branch}" is already checked out in another worktree`)
    }
  }

  /** Worktree list entry matching an absolute path, carrying its canonical path. */
  async #findWorktree(record: RepoRecord, path: string): Promise<RepoWorktree | null> {
    const target = this.#pathKey(await this.#absPosix(path))
    const worktrees = await listWorktrees({ repoPath: record.path })
    for (const worktree of worktrees) {
      const normalized = await this.#absPosix(worktree.path)
      if (this.#pathKey(normalized) === target) return { ...worktree, path: normalized }
    }
    return null
  }

  #absPosix(path: string): Promise<string> {
    const absolute = resolve(path)
    return realpath(absolute)
      .then(toPosix)
      .catch(() => toPosix(absolute))
  }

  /** Windows compares paths case-insensitively. */
  #pathKey(path: string): string {
    return process.platform === 'win32' ? path.toLowerCase() : path
  }

  /** Switches to a branch; a remote-only name creates the tracking branch (git DWIM). */
  async gitBranchCheckout(request: GitBranchCheckoutRequest): Promise<{ stash: AutoStashReport }> {
    const record = this.#requireWriteCheckout(request.gitDir)
    await this.#assertNoOperation(record, 'Checkout')
    const stash = await this.#gitOperation(record, (repoPath) => checkoutBranch(repoPath, request.name))
    return { stash }
  }

  /** Checks out a commit, tag or remote branch into detached HEAD. */
  async gitCheckoutDetach(request: GitCheckoutDetachRequest): Promise<{ stash: AutoStashReport }> {
    const record = this.#requireWriteCheckout(request.gitDir)
    await this.#assertNoOperation(record, 'Checkout')
    const stash = await this.#gitOperation(record, (repoPath) => checkoutDetach(repoPath, request.rev))
    return { stash }
  }

  /** Creates a branch from any ref, optionally switching to it and tracking an upstream. */
  async gitBranchCreate(
    request: GitBranchCreateRequest
  ): Promise<{ upstream: string | null; stash: AutoStashReport }> {
    const record = this.#requireWriteCheckout(request.gitDir)
    if (request.checkout === true) await this.#assertNoOperation(record, 'Checkout')
    const upstream =
      request.upstream !== undefined && request.upstream.length > 0 ? request.upstream : null
    const stash = await this.#gitOperation(record, async (repoPath) => {
      const outcome = await createBranch(repoPath, {
        name: request.name,
        startPoint: request.startPoint,
        checkout: request.checkout === true
      })
      if (upstream !== null) await setUpstream(repoPath, request.name, upstream)
      return outcome
    })
    return { upstream, stash }
  }

  async gitBranchRename(request: GitBranchRenameRequest): Promise<null> {
    const record = this.#requireWriteCheckout(request.gitDir)
    await this.#gitOperation(record, (repoPath) =>
      renameBranch(repoPath, request.name, request.newName)
    )
    return null
  }

  /**
   * Deletes a local branch. An unmerged branch requires `force` and gets a
   * backup ref first, so the deletion stays undoable either way.
   */
  async gitBranchDelete(request: GitBranchDeleteRequest): Promise<GitBranchDeleteResponse> {
    const record = this.#requireWriteCheckout(request.gitDir)
    return await this.#gitOperation(record, async (repoPath) => {
      const tip = await readBranchTip(repoPath, { name: request.name })
      if (tip === null) {
        throw new ServiceError('invalid-name', `No branch named "${request.name}"`)
      }
      const merged = await isBranchMerged(repoPath, request.name)
      if (!merged && request.force !== true) {
        throw new ServiceError(
          'branch-unmerged',
          `Branch "${request.name}" is not fully merged into the current branch`
        )
      }
      let backup: BackupRef | null = null
      if (!merged) {
        backup = await createBackupRef({
          repoPath,
          op: 'branch-delete',
          target: `refs/heads/${request.name}`
        })
      }
      await deleteBranch(repoPath, request.name, { force: !merged })
      const undo = this.#recordOperation(record, 'branch-delete', {
        backupRef: backup?.ref ?? null,
        undoState: encodeUndoState({
          kind: 'branch-delete',
          name: request.name,
          before: tip,
          target: request.name
        })
      })
      return { merged, backup, undo }
    })
  }

  /** Points a branch at a remote-tracking ref (e.g. `origin/feat`) as its upstream. */
  async gitBranchSetUpstream(request: GitBranchSetUpstreamRequest): Promise<null> {
    const record = this.#requireWriteCheckout(request.gitDir)
    await this.#gitOperation(record, (repoPath) =>
      setUpstream(repoPath, request.name, request.upstream)
    )
    return null
  }

  async gitRemotes(request: GitRemotesRequest): Promise<GitRemotesResponse> {
    const record = this.#requireCheckout(this.#requireSession(), request.gitDir)
    const remotes = await listRemotes(record.path)
    return { remotes, defaultRemote: await this.#defaultRemoteName(remotes) }
  }

  async gitRemoteAdd(request: GitRemoteAddRequest): Promise<null> {
    const record = this.#requireCheckout(this.#requireSession(), request.gitDir)
    await this.#gitOperation(record, (repoPath) => addRemote(repoPath, request.name, request.url))
    return null
  }

  async gitRemoteRemove(request: GitRemoteRemoveRequest): Promise<null> {
    const record = this.#requireCheckout(this.#requireSession(), request.gitDir)
    await this.#gitOperation(record, (repoPath) => removeRemote(repoPath, request.name))
    return null
  }

  async gitRemoteSetUrl(request: GitRemoteSetUrlRequest): Promise<null> {
    const record = this.#requireCheckout(this.#requireSession(), request.gitDir)
    await this.#gitOperation(record, (repoPath) =>
      setRemoteUrl(repoPath, request.name, request.url, { push: request.push === true })
    )
    return null
  }

  async gitFetch(request: GitFetchRequest): Promise<GitFetchResponse> {
    const record = this.#requireCheckout(this.#requireSession(), request.gitDir)
    const remote = await this.#resolveRemote(record, request.remote)
    const result = await this.#gitOperation(
      record,
      (repoPath) =>
        fetchRemote(repoPath, {
          remote,
          prune: request.prune === true,
          followTags: request.followTags
        }),
      (error) => toNetworkServiceError(error, remote)
    )
    await this.#pruneStaleWorktrees(record)
    return { remote, updated: result.updated, output: result.output }
  }

  /** Pulls with the strategy resolved from settings (per-repo override first). */
  async gitPull(request: GitPullRequest): Promise<GitPullResponse> {
    const record = this.#requireWriteCheckout(request.gitDir)
    await this.#assertNoOperation(record, 'Pull')
    const strategy = await this.#pullStrategy(record)
    const label = request.remote ?? this.#upstreamRemoteHint(record) ?? ''
    const before = await readHeadSha(record.path)
    const stash = await this.#gitOperation(
      record,
      (repoPath) =>
        pullRepo(repoPath, { strategy, remote: request.remote, branch: request.branch }),
      (error) => toNetworkServiceError(error, label)
    )
    const after = await readHeadSha(record.path)
    return { updated: before !== after, stash }
  }

  /** Pushes the branch to each requested remote; every remote reports its own result. */
  async gitPush(request: GitPushRequest): Promise<GitPushResponse> {
    const record = this.#requireCheckout(this.#requireSession(), request.gitDir)
    const remotes = await this.#pushRemotes(record, request.remotes)
    const results: GitPushResult[] = []
    for (const remote of remotes) {
      try {
        const result = await this.#gitOperation(
          record,
          (repoPath) =>
            pushBranch(repoPath, {
              remote,
              branch: request.branch,
              setUpstream: request.upstreamRemote === remote,
              forceWithLease: request.forceWithLease === true
            }),
          (error) => toNetworkServiceError(error, remote)
        )
        results.push({
          remote,
          ok: true,
          output: `${result.stdout}${result.stderr}`.trimEnd(),
          error: null
        })
      } catch (failure) {
        const mapped = failure instanceof ServiceError ? failure : toNetworkServiceError(failure, remote)
        results.push({ remote, ok: false, output: mapped.details ?? '', error: mapped.message })
      }
    }
    return { results }
  }

  /** Validated, de-duplicated push targets; an empty request falls back to the default remote. */
  async #pushRemotes(record: RepoRecord, requested?: readonly string[]): Promise<readonly string[]> {
    const wanted = (requested ?? []).filter((name) => name.length > 0)
    if (wanted.length === 0) return [await this.#resolveRemote(record)]
    const remotes = await listRemotes(record.path)
    const targets: string[] = []
    for (const name of wanted) {
      if (!remotes.some((remote) => remote.name === name)) {
        throw new ServiceError('git-failed', `Unknown remote "${name}"`)
      }
      if (!targets.includes(name)) targets.push(name)
    }
    return targets
  }

  /** Fetches several repositories; every repository reports its own result. */
  async gitFetchMany(request: GitFetchManyRequest): Promise<{ results: GitBatchResult[] }> {
    const session = this.#requireSession()
    const results = await Promise.all(
      request.gitDirs.map((gitDir) => this.#fetchOne(session, gitDir, request))
    )
    return { results }
  }

  /** Pulls several repositories; every repository reports its own result. */
  async gitPullMany(request: GitPullManyRequest): Promise<{ results: GitBatchResult[] }> {
    const session = this.#requireSession()
    const results = await Promise.all(request.gitDirs.map((gitDir) => this.#pullOne(session, gitDir)))
    return { results }
  }

  async #fetchOne(
    session: WorkspaceSession,
    gitDir: string,
    options: { prune?: boolean; followTags?: boolean }
  ): Promise<GitBatchResult> {
    const record = this.#findCheckout(session, gitDir)
    if (record === null) return this.#batchFailure(gitDir, gitDir, new ServiceError('unknown-repo', `No checkout with git dir: ${gitDir}`))
    try {
      const remote = await this.#resolveRemote(record)
      const result = await this.#pool.run(() =>
        this.#gitOperation(
          record,
          (repoPath) =>
            fetchRemote(repoPath, {
              remote,
              prune: options.prune === true,
              followTags: options.followTags
            }),
          (error) => toNetworkServiceError(error, remote)
        )
      )
      await this.#pruneStaleWorktrees(record)
      return {
        gitDir,
        name: record.name,
        ok: true,
        updated: result.updated,
        output: result.output,
        error: null,
        stash: null
      }
    } catch (error) {
      return this.#batchFailure(gitDir, record.name, error)
    }
  }

  async #pullOne(session: WorkspaceSession, gitDir: string): Promise<GitBatchResult> {
    const record = this.#findCheckout(session, gitDir)
    if (record === null) return this.#batchFailure(gitDir, gitDir, new ServiceError('unknown-repo', `No checkout with git dir: ${gitDir}`))
    try {
      const writeRecord = this.#requireWritable(record)
      await this.#assertNoOperation(writeRecord, 'Pull')
      const strategy = await this.#pullStrategy(writeRecord)
      const label = this.#upstreamRemoteHint(writeRecord) ?? ''
      const before = await readHeadSha(writeRecord.path)
      const chunks: string[] = []
      const stash = await this.#pool.run(() =>
        this.#gitOperation(
          writeRecord,
          (repoPath) =>
            pullRepo(repoPath, {
              strategy,
              onOutput: (chunk) => chunks.push(chunk)
            }),
          (error) => toNetworkServiceError(error, label)
        )
      )
      const after = await readHeadSha(writeRecord.path)
      return {
        gitDir,
        name: writeRecord.name,
        ok: true,
        updated: before !== after,
        output: chunks.join('').trimEnd(),
        error: null,
        stash
      }
    } catch (error) {
      return this.#batchFailure(gitDir, record.name, error)
    }
  }

  #batchFailure(gitDir: string, name: string, error: unknown): GitBatchResult {
    const details = error instanceof ServiceError ? error.details : undefined
    return {
      gitDir,
      name,
      ok: false,
      updated: false,
      output: details ?? '',
      error: messageOf(error),
      stash: null
    }
  }

  async gitTagCreate(request: GitTagCreateRequest): Promise<{ remote: string | null }> {
    const record = this.#requireCheckout(this.#requireSession(), request.gitDir)
    const remote = request.push === true ? await this.#resolveRemote(record, request.remote) : null
    await this.#gitOperation(
      record,
      async (repoPath) => {
        await createTag(repoPath, {
          name: request.name,
          target: request.target,
          message: request.message
        })
        if (remote !== null) await pushTag(repoPath, remote, request.name)
      },
      (error) => toNetworkServiceError(error, remote ?? '')
    )
    return { remote }
  }

  async gitTagDelete(request: GitTagDeleteRequest): Promise<null> {
    const record = this.#requireCheckout(this.#requireSession(), request.gitDir)
    await this.#gitOperation(record, (repoPath) => deleteTag(repoPath, request.name))
    return null
  }

  async gitTagPush(request: GitTagPushRequest): Promise<GitTagPushResponse> {
    const record = this.#requireCheckout(this.#requireSession(), request.gitDir)
    const remote = await this.#resolveRemote(record, request.remote)
    const result = await this.#gitOperation(
      record,
      (repoPath) => pushTag(repoPath, remote, request.name),
      (error) => toNetworkServiceError(error, remote)
    )
    return { remote, output: `${result.stdout}${result.stderr}`.trimEnd() }
  }

  async gitTagPushAll(request: GitTagPushAllRequest): Promise<GitTagPushResponse> {
    const record = this.#requireCheckout(this.#requireSession(), request.gitDir)
    const remote = await this.#resolveRemote(record, request.remote)
    const result = await this.#gitOperation(
      record,
      (repoPath) => pushAllTags(repoPath, remote),
      (error) => toNetworkServiceError(error, remote)
    )
    return { remote, output: `${result.stdout}${result.stderr}`.trimEnd() }
  }

  async gitTagDeleteRemote(request: GitTagDeleteRemoteRequest): Promise<GitTagPushResponse> {
    const record = this.#requireCheckout(this.#requireSession(), request.gitDir)
    const remote = await this.#resolveRemote(record, request.remote)
    const result = await this.#gitOperation(
      record,
      (repoPath) => deleteRemoteTag(repoPath, remote, request.name),
      (error) => toNetworkServiceError(error, remote)
    )
    return { remote, output: `${result.stdout}${result.stderr}`.trimEnd() }
  }

  /** Tags on the remote (`ls-remote`); an empty list when no remote is configured. */
  async gitRemoteTags(request: GitRemoteTagsRequest): Promise<GitRemoteTagsResponse> {
    const record = this.#requireCheckout(this.#requireSession(), request.gitDir)
    const remotes = await listRemotes(record.path)
    if (remotes.length === 0) return { remote: null, tags: [] }
    const remote = request.remote ?? (await this.#defaultRemoteName(remotes))
    if (remote === null || !remotes.some((entry) => entry.name === remote)) {
      throw new ServiceError('git-failed', `Unknown remote "${request.remote ?? ''}"`)
    }
    try {
      return { remote, tags: await listRemoteTags(record.path, remote) }
    } catch (error) {
      throw toNetworkServiceError(error, remote)
    }
  }

  #defaultRemoteName(remotes: readonly RemoteInfo[]): Promise<string | null> {
    return this.settingsGetEffective(['git', 'defaultRemote']).then(({ value }) => {
      const configured = typeof value === 'string' && value.length > 0 ? value : null
      return resolveDefaultRemote(remotes, configured)
    })
  }

  /** Resolves an explicit or default remote; explicit names must exist. */
  async #resolveRemote(record: RepoRecord, name?: string): Promise<string> {
    const remotes = await listRemotes(record.path)
    if (name !== undefined) {
      if (!remotes.some((remote) => remote.name === name)) {
        throw new ServiceError('git-failed', `Unknown remote "${name}"`)
      }
      return name
    }
    const fallback = await this.#defaultRemoteName(remotes)
    if (fallback === null) {
      throw new ServiceError('git-failed', 'No remote is configured for this repository')
    }
    return fallback
  }

  /** Workspace per-repo override, then the user setting, then `ff-only`. */
  async #pullStrategy(record: RepoRecord): Promise<PullStrategy> {
    const read = (value: unknown): PullStrategy | null =>
      value === 'ff-only' || value === 'merge' || value === 'rebase' ? value : null
    if (record.relPath.length > 0) {
      const { value } = await this.settingsGetEffective(['repos', record.relPath, 'pullStrategy'])
      const perRepo = read(value)
      if (perRepo !== null) return perRepo
    }
    const { value } = await this.settingsGetEffective(['git', 'defaultPullStrategy'])
    return read(value) ?? 'ff-only'
  }

  /** Remote of the cached upstream, used to label network errors. */
  #upstreamRemoteHint(record: RepoRecord): string | null {
    const status = this.#session?.scheduler.getCached(record.gitDir) ?? null
    const upstream = status?.upstream?.ref ?? null
    if (upstream === null) return null
    const slash = upstream.indexOf('/')
    return slash > 0 ? upstream.slice(0, slash) : null
  }

  #findCheckout(session: WorkspaceSession, gitDir: string): RepoRecord | null {
    return session.registry.all.find((row) => row.gitDir.length > 0 && row.gitDir === gitDir) ?? null
  }

  #requireWritable(record: RepoRecord): RepoRecord {
    if (record.kind === 'bare') {
      throw new ServiceError('git-failed', `${record.name} is a bare repository and has no working tree`)
    }
    return record
  }

  #requireWriteCheckout(gitDir: string): RepoRecord {
    const record = this.#requireCheckout(this.#requireSession(), gitDir)
    if (record.kind === 'bare') {
      throw new ServiceError('git-failed', `${record.name} is a bare repository and has no working tree`)
    }
    return record
  }

  /** Blocks conflicting write operations while another operation is in progress. */
  async #assertNoOperation(record: RepoRecord, action: string): Promise<void> {
    const operation = await detectOperation(record.gitDir)
    if (operation === 'none') return
    throw new ServiceError(
      'operation-in-progress',
      `${action} is not available while a ${OPERATION_LABELS[operation]} is in progress; continue or abort it first.`
    )
  }

  async #requireOperation(record: RepoRecord): Promise<ActiveOperation> {
    const operation = await detectOperation(record.gitDir)
    if (operation === 'none') throw new ServiceError('no-operation', 'No operation is in progress')
    return operation
  }

  /** Branch the operation acted on; `HEAD` is recorded while detached. */
  async #headRef(repoPath: string): Promise<string> {
    return (await readHeadRef(repoPath)) ?? 'HEAD'
  }

  /** Appends an operation-log row and returns its undo affordance. */
  #recordOperation(
    record: RepoRecord,
    op: string,
    options: { backupRef?: string | null; undoState?: string | null } = {}
  ): UndoHint {
    const entryId = this.#oplog.record({
      repoId: this.#rowIdByGitDir.get(record.gitDir) ?? null,
      op,
      backupRef: options.backupRef ?? null,
      undoState: options.undoState ?? null
    })
    return { entryId, op, backupRef: options.backupRef ?? null }
  }

  /** Latest still-undoable entry among the given operation names. */
  #latestUndo(record: RepoRecord, ops: readonly string[]): UndoHint | null {
    const rowId = this.#rowIdByGitDir.get(record.gitDir) ?? null
    let best: OperationRow | null = null
    for (const op of ops) {
      const row = this.#oplog.latest(rowId, { op })
      if (row !== null && parseUndoState(row.undoState) !== null && (best === null || row.id > best.id)) {
        best = row
      }
    }
    return best === null ? null : { entryId: best.id, op: best.op, backupRef: best.backupRef }
  }

  /** Rebuilds an undo descriptor from a backup ref when no stored state exists. */
  #fallbackDescriptor(backupRef: string | null, backupSha: string | null): UndoDescriptor | null {
    if (backupRef === null || backupSha === null) return null
    const slug = parseBackupRefName(backupRef)?.op ?? ''
    // A `restore` ref is a guard snapshot of HEAD, so it unwinds like a hard reset.
    if (slug === 'reset-hard' || slug === 'restore') {
      return { kind: 'reset', mode: 'hard', before: backupSha }
    }
    if (slug === 'rebase' || slug === 'rebase-interactive' || slug === 'edit-commit') {
      return { kind: 'rebase', before: backupSha }
    }
    if (slug === 'stash-drop') return { kind: 'stash-drop', before: backupSha }
    return null
  }

  /** Human-readable target of an operation-log entry. */
  #undoTarget(raw: string | null): string | null {
    const descriptor = parseUndoState(raw)
    if (descriptor === null) return null
    if (descriptor.target !== undefined && descriptor.target.length > 0) return descriptor.target
    if (descriptor.name !== undefined && descriptor.name.length > 0) return descriptor.name
    if (descriptor.subject !== undefined && descriptor.subject.length > 0) return descriptor.subject
    return descriptor.before !== undefined ? descriptor.before.slice(0, 7) : null
  }

  /**
   * Serializes write commands per checkout (they all touch the index), maps git
   * failures onto ServiceError, and refreshes the status so the UI updates even
   * when no watcher event arrives.
   */
  async #gitOperation<T>(
    record: RepoRecord,
    task: (repoPath: string) => Promise<T>,
    mapError: (error: unknown) => ServiceError = toGitServiceError
  ): Promise<T> {
    const previous = this.#writes.get(record.gitDir) ?? Promise.resolve()
    const run = previous.then(
      () => task(record.path),
      () => task(record.path)
    )
    this.#writes.set(
      record.gitDir,
      run.catch(() => undefined)
    )
    let result: T
    try {
      result = await run
    } catch (error) {
      throw mapError(error)
    }
    this.#refreshStatus(record)
    return result
  }

  #refreshStatus(record: RepoRecord): void {
    const session = this.#session
    if (session === null) return
    void session.scheduler
      .request(this.#statusTarget(record), { reason: 'interactive', refresh: true })
      .catch(() => undefined)
  }

  /** Status request for a checkout, carrying the effective untracked listing mode. */
  #statusTarget(record: RepoRecord): StatusTarget {
    const target = statusTargetFor(record)
    target.untracked = this.#untrackedFor(record)
    return target
  }

  #untrackedFor(record: RepoRecord): 'normal' | 'all' {
    return this.#untrackedByRepo.get(record.relPath) ?? this.#untrackedDefault
  }

  async watchDirectory(path: string): Promise<null> {
    const session = this.#requireSession()
    await session.watchDirectory(await this.resolveInside(path))
    return null
  }

  async unwatchDirectory(path: string): Promise<null> {
    const session = this.#requireSession()
    await session.unwatchDirectory(await this.resolveInside(path))
    return null
  }

  /**
   * Absolute real path of the input, which must sit inside the root or a registered
   * checkout. Resolves symlinks, so use it for directories.
   */
  async resolveInside(input: string): Promise<string> {
    const session = this.#requireSession()
    const absolute = await realPathPosix(resolve(input))
    return this.#assertInsideWorkspace(session, absolute, input)
  }

  /**
   * Real path of an entry inside the workspace that keeps a trailing symlink as the
   * entry itself (renaming a link renames the link, not its target).
   */
  async resolveEntry(input: string): Promise<string> {
    const session = this.#requireSession()
    const resolved = resolve(input)
    const parent = await realPathPosix(resolve(resolved, '..'))
    const entry = posix.join(parent, basename(resolved))
    return this.#assertInsideWorkspace(session, entry, input)
  }

  #assertInsideWorkspace(session: WorkspaceSession, absolute: string, input: string): string {
    const bases = [session.root, ...session.registry.all.map((record) => record.path)]
    for (const base of bases) {
      if (absolute === base || absolute.startsWith(`${base}/`)) return absolute
    }
    throw new ServiceError('outside-workspace', `Path is outside the workspace: ${input}`)
  }

  /** Lists one directory of the workspace; `.git` entries stay hidden. */
  async readDir(path: string): Promise<{ entries: FsEntry[] }> {
    const dir = await this.resolveInside(path)
    let dirents
    try {
      dirents = await readdir(dir, { withFileTypes: true })
    } catch (error) {
      throw this.#fsError(error, dir)
    }
    const entries: FsEntry[] = []
    for (const dirent of dirents) {
      if (dirent.name === '.git') continue
      const kind: FsEntryKind | null = dirent.isDirectory()
        ? 'dir'
        : dirent.isSymbolicLink()
          ? 'symlink'
          : dirent.isFile()
            ? 'file'
            : null
      if (kind === null) continue
      entries.push({ name: dirent.name, path: posix.join(dir, dirent.name), kind })
    }
    return { entries }
  }

  /** Reads a file for the editor: text, image preview data or a size verdict. */
  async readFileForEditor(request: FsReadFileRequest): Promise<FsReadFileResponse> {
    const file = await this.resolveInside(request.path)
    return await readFileSnapshot(file, { allowLarge: request.allowLarge === true })
  }

  /** Lightweight existence/mtime probe used to detect external edits. */
  async statPath(request: FsPathRequest): Promise<FsStatResponse> {
    const entry = await this.resolveInside(request.path)
    try {
      const stats = await stat(entry)
      const kind = stats.isFile() ? 'file' : stats.isDirectory() ? 'dir' : 'other'
      return { exists: true, kind, size: stats.size, mtimeMs: stats.mtimeMs }
    } catch {
      return { exists: false, kind: 'missing', size: 0, mtimeMs: 0 }
    }
  }

  /** Atomic save (temp file + rename); a stale mtime fails the write instead of clobbering. */
  async writeFileForEditor(request: FsWriteFileRequest): Promise<FsWriteFileResponse> {
    const file = await this.resolveEntry(request.path)
    if (request.expectedMtimeMs !== undefined) {
      const current = await stat(file).catch(() => null)
      if (current === null || Math.abs(current.mtimeMs - request.expectedMtimeMs) > 0.5) {
        throw new ServiceError('file-changed', `File changed on disk: ${file}`)
      }
    }
    const temp = posix.join(posix.dirname(file), `.${posix.basename(file)}.gtd-${randomUUID().slice(0, 8)}.tmp`)
    try {
      await writeFile(temp, request.text, 'utf8')
      await rename(temp, file)
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined)
      const message = error instanceof Error ? error.message : String(error)
      throw new ServiceError('fs-failed', message)
    }
    const saved = await stat(file)
    return { mtimeMs: saved.mtimeMs }
  }

  /** Flat file list for quick open; bounded, sorted and filtered by the discovery excludes. */
  async listFiles(limit = 20_000): Promise<WorkspaceListFilesResponse> {
    const session = this.#requireSession()
    const exclude = createPathMatcher(session.config.exclude)
    const files: string[] = []
    let truncated = false
    const queue: string[] = [session.root]
    while (queue.length > 0 && !truncated) {
      const dir = queue.shift()
      if (dir === undefined) break
      const dirents = await readdir(dir, { withFileTypes: true }).catch(() => null)
      if (dirents === null) continue
      for (const dirent of dirents) {
        const name = dirent.name
        if (name === '.git' || name === 'node_modules' || name === '.svn' || name === '.hg') continue
        const child = posix.join(dir, name)
        const relative = posix.relative(session.root, child)
        if (exclude(relative)) continue
        if (dirent.isDirectory()) {
          queue.push(child)
        } else if (dirent.isFile()) {
          if (files.length >= limit) {
            truncated = true
            break
          }
          files.push(relative)
        }
      }
    }
    files.sort()
    return { files, truncated }
  }

  /** Creates an empty file or a folder; refuses to overwrite existing entries. */
  async createEntry(parent: string, name: string, kind: 'file' | 'dir'): Promise<{ path: string }> {
    assertEntryName(name)
    const dir = await this.resolveInside(parent)
    const target = posix.join(dir, name)
    try {
      if (kind === 'dir') {
        await mkdir(target)
      } else {
        const handle = await open(target, 'wx')
        await handle.close()
      }
    } catch (error) {
      throw this.#fsError(error, target)
    }
    return { path: target }
  }

  /** Renames an entry within its directory (no moves across directories). */
  async renameEntry(path: string, newName: string): Promise<{ path: string }> {
    assertEntryName(newName)
    const source = await this.resolveEntry(path)
    if (source === this.#requireSession().root) {
      throw new ServiceError('invalid-name', 'The workspace root cannot be renamed')
    }
    const target = posix.join(posix.dirname(source), newName)
    if (target === source) return { path: source }
    if (await pathExists(target)) {
      throw new ServiceError('exists', `Already exists: ${target}`)
    }
    try {
      await rename(source, target)
    } catch (error) {
      throw this.#fsError(error, target)
    }
    return { path: target }
  }

  #fsError(error: unknown, path: string): ServiceError {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EEXIST' || code === 'ENOTEMPTY' || code === 'EPERM') {
      return new ServiceError('exists', `Already exists: ${path}`)
    }
    if (code === 'ENOENT') return new ServiceError('fs-failed', `No longer exists: ${path}`)
    const message = error instanceof Error ? error.message : String(error)
    return new ServiceError('fs-failed', message)
  }

  async settingsGet(request: SettingsGetRequest): Promise<{ value: unknown }> {
    if (request.scope === 'user') return { value: await this.#settings.getUser(request.keyPath) }
    return { value: await this.#settings.getWorkspace(this.#requireSession().root, request.keyPath) }
  }

  async settingsGetAll(scope: SettingsScope): Promise<{ value: unknown }> {
    if (scope === 'user') return { value: await this.#settings.getUserAll() }
    return { value: await this.#settings.getWorkspaceAll(this.#requireSession().root) }
  }

  /** Workspace value when present, user value otherwise. */
  async settingsGetEffective(keyPath: readonly string[]): Promise<{ value: unknown }> {
    this.#assertLive()
    return { value: await this.#settings.effective(this.#session?.root ?? null, keyPath) }
  }

  async settingsSet(request: SettingsSetRequest): Promise<null> {
    if (request.value === undefined) {
      return this.settingsRemove({ scope: request.scope, keyPath: request.keyPath })
    }
    if (request.scope === 'user') await this.#settings.setUser(request.keyPath, request.value)
    else await this.#settings.setWorkspace(this.#requireSession().root, request.keyPath, request.value)
    return null
  }

  async settingsRemove(request: SettingsRemoveRequest): Promise<null> {
    if (request.scope === 'user') await this.#settings.removeUser(request.keyPath)
    else await this.#settings.removeWorkspace(this.#requireSession().root, request.keyPath)
    return null
  }

  async keybindingsGet(): Promise<{ overrides: Record<string, string | null> }> {
    this.#assertLive()
    return { overrides: await this.#keybindings.getAll() }
  }

  async keybindingsSet(request: KeybindingsSetRequest): Promise<null> {
    this.#assertLive()
    await this.#keybindings.set(request.command, request.keys)
    return null
  }

  /** Drops the override so the default binding applies again. */
  async keybindingsReset(request: KeybindingsResetRequest): Promise<null> {
    this.#assertLive()
    await this.#keybindings.remove(request.command)
    return null
  }

  /** Live-applies the settings that runtime consumers read once instead of per use. */
  #onSettingsChange(change: SettingsChange): void {
    const head = change.keyPath[0]
    if (head === 'git') {
      void this.#applyGitSettings()
      if (change.keyPath[1] === 'pollIntervalSec') void this.#applyPollInterval()
      if (change.keyPath[1] === 'untrackedStrategy') void this.#reloadUntrackedAndRefresh()
    } else if (head === 'repos' && change.keyPath[change.keyPath.length - 1] === 'untrackedStrategy') {
      void this.#reloadUntrackedAndRefresh()
    }
  }

  /** Effective value of a surfaced key, sanitized; invalid values fall back to the default. */
  async #effectiveSetting(root: string | null, keyPath: readonly string[]): Promise<unknown> {
    const value = await this.#settings.effective(root, keyPath)
    const descriptor = findSettingDescriptor(keyPath)
    if (descriptor === null) return value
    const sanitized = sanitizeSettingValue(descriptor, value)
    return sanitized === undefined ? descriptor.default : sanitized
  }

  /** Pushes `git.path` and `git.concurrency` into the running git runtime. */
  async #applyGitSettings(root?: string): Promise<void> {
    try {
      const scope = root ?? this.#session?.root ?? null
      const rawPath = await this.#effectiveSetting(scope, ['git', 'path'])
      const executable = typeof rawPath === 'string' && rawPath.length > 0 ? rawPath : 'git'
      if (executable !== this.#gitExecutable) {
        this.#gitExecutable = executable
        setGitExecutable(executable)
        this.#gitVersion = null
        this.#gitVersionDone = false
        this.#gitVersionProbe = null
      }
      const concurrency = await this.#effectiveSetting(scope, ['git', 'concurrency'])
      if (typeof concurrency === 'number') this.#pool.setConcurrency(concurrency)
    } catch (error) {
      console.warn('[workspace] applying git settings failed', error)
    }
  }

  async #applyPollInterval(): Promise<void> {
    try {
      const ms = await this.#resolvePollInterval(this.#session?.root ?? null)
      this.#session?.setPollIntervalMs(ms)
    } catch (error) {
      console.warn('[workspace] applying the poll interval failed', error)
    }
  }

  async #resolvePollInterval(root: string | null): Promise<number> {
    const seconds = await this.#effectiveSetting(root, ['git', 'pollIntervalSec'])
    const value = typeof seconds === 'number' && seconds > 0 ? seconds : 60
    return Math.max(1_000, Math.round(value * 1_000))
  }

  /** Refreshes the `repos.<relPath>.untrackedStrategy` overrides and the global default. */
  async #reloadUntrackedStrategy(root: string | null): Promise<void> {
    try {
      const next = new Map<string, 'normal' | 'all'>()
      const all = root === null ? null : await this.#settings.getWorkspaceAll(root)
      if (typeof all === 'object' && all !== null && !Array.isArray(all)) {
        const repos = (all as Record<string, unknown>)['repos']
        if (typeof repos === 'object' && repos !== null && !Array.isArray(repos)) {
          for (const [relPath, entry] of Object.entries(repos)) {
            if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue
            const mode = (entry as Record<string, unknown>)['untrackedStrategy']
            if (mode === 'normal' || mode === 'all') next.set(relPath, mode)
          }
        }
      }
      this.#untrackedByRepo = next
      const fallback = await this.#effectiveSetting(root, ['git', 'untrackedStrategy'])
      this.#untrackedDefault = fallback === 'all' ? 'all' : 'normal'
    } catch (error) {
      console.warn('[workspace] reading the untracked strategy failed', error)
    }
  }

  async #reloadUntrackedAndRefresh(): Promise<void> {
    await this.#reloadUntrackedStrategy(this.#session?.root ?? null)
    const session = this.#session
    if (session === null) return
    for (const record of session.registry.all) {
      if (record.gitDir.length > 0) this.#refreshStatus(record)
    }
  }

  uiStateGet(key: string): { value: unknown } {
    this.#assertLive()
    return { value: this.#uiState.get(key) }
  }

  uiStateSet(key: string, value: unknown): null {
    this.#assertLive()
    this.#uiState.set(key, value)
    return null
  }

  uiStateKeys(prefix?: string): { keys: string[] } {
    this.#assertLive()
    return { keys: this.#uiState.keys(prefix) }
  }

  uiStateDelete(key: string): null {
    this.#assertLive()
    this.#uiState.delete(key)
    return null
  }

  trustQuery(): { trusted: boolean } {
    return { trusted: this.#workspaces.isTrusted(this.#requireSession().root) }
  }

  trustGrant(request: TrustGrantRequest): { trusted: boolean } {
    const root = this.#requireSession().root
    this.#workspaces.setTrusted(root, request.trusted)
    return { trusted: request.trusted }
  }

  /** Probes `git --version` once; `null` when git is unavailable. */
  gitVersion(): Promise<GitVersionInfo | null> {
    if (this.#gitVersionDone) return Promise.resolve(this.#gitVersion)
    this.#gitVersionProbe ??= probeGitVersion().then(
      (info) => {
        this.#gitVersion = info
        this.#gitVersionDone = true
        return info
      },
      () => {
        this.#gitVersion = null
        this.#gitVersionDone = true
        return null
      }
    )
    return this.#gitVersionProbe
  }

  /** Live watch scope counts of the open workspace; zeroes when nothing is open. */
  watcherStats(): { scopes: number; subscribed: number; degraded: number } {
    return this.#session?.watcherStats() ?? { scopes: 0, subscribed: 0, degraded: 0 }
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return
    this.#disposed = true
    await this.#closeSession()
    if (this.#ownsPool) this.#pool.dispose()
    this.#db.close()
  }

  #assertLive(): void {
    if (this.#disposed) throw new ServiceError('disposed', 'The workspace service has been disposed')
  }

  #requireSession(): WorkspaceSession {
    this.#assertLive()
    const session = this.#session
    if (session === null) throw new ServiceError('not-open', 'No workspace is open')
    return session
  }

  async #closeSession(): Promise<void> {
    const session = this.#session
    this.#session = null
    this.#workspaceId = null
    this.#stats = null
    this.#issues = []
    this.#rowIdByGitDir.clear()
    this.#statusAt.clear()
    this.#writes.clear()
    this.#warmStart = null
    this.#warmTarget = 0
    this.#warmSeen.clear()
    if (session !== null) await session.close()
  }

  #descriptor(): WorkspaceDescriptor {
    const session = this.#requireSession()
    const records = session.registry.all
    return {
      root: session.root,
      config: session.config,
      records,
      trusted: this.#workspaces.isTrusted(session.root),
      issues: [...this.#issues],
      stats:
        this.#stats ??
        ({
          dirsScanned: 0,
          candidates: 0,
          repos: records.length,
          budgetExceeded: false,
          maxDepthReached: false
        } satisfies DiscoveryStats),
      statuses: this.#cachedStatuses(session, records)
    }
  }

  #cachedStatuses(session: WorkspaceSession, records: readonly RepoRecord[]): RepoStatusSnapshot[] {
    const statuses: RepoStatusSnapshot[] = []
    for (const record of records) {
      if (record.gitDir.length === 0) continue

      const live = session.scheduler.getCached(record.gitDir)
      if (live !== null) {
        statuses.push({
          gitDir: record.gitDir,
          status: live,
          updatedAt: this.#statusAt.get(record.gitDir) ?? Date.now()
        })
        continue
      }

      const rowId = this.#rowIdByGitDir.get(record.gitDir)
      if (rowId === undefined) continue
      const cached = this.#cache.loadStatus(rowId, this.#statusTtlMs)
      if (cached !== null) {
        statuses.push({ gitDir: record.gitDir, status: cached.status, updatedAt: cached.updatedAt })
      }
    }
    return statuses
  }

  #syncRows(records: readonly RepoRecord[]): void {
    const workspaceId = this.#workspaceId
    if (workspaceId === null) return
    const rows = this.#repos.sync(workspaceId, records)
    this.#rowIdByGitDir.clear()
    for (const row of rows) {
      if (row.gitDir.length > 0) this.#rowIdByGitDir.set(row.gitDir, row.id)
    }
  }

  #onStatus(gitDir: string, status: RepoStatus): void {
    const at = Date.now()
    this.#statusAt.set(gitDir, at)

    if (this.#warmStart !== null && this.#warmTarget > 0) {
      this.#warmSeen.add(gitDir)
      if (this.#warmSeen.size >= this.#warmTarget) {
        recordWarm(performance.now() - this.#warmStart)
        this.#warmStart = null
        this.#warmSeen.clear()
      }
    }

    const rowId = this.#rowIdByGitDir.get(gitDir)
    if (rowId !== undefined) this.#cache.saveStatus(rowId, status, at)

    const root = this.#session?.root
    if (root === undefined || root.length === 0) return
    this.#emit({ type: 'status', root, update: { gitDir, status, updatedAt: at } })
  }

  #onReposChanged(diff: RepoDiff, records: readonly RepoRecord[], stats?: DiscoveryStats): void {
    const session = this.#session
    if (session === null) return
    this.#syncRows(records)
    if (this.#warmStart !== null) {
      this.#warmTarget = records.filter((record) => record.gitDir.length > 0).length
    }
    this.#emit({ type: 'reposChanged', root: session.root, diff, stats })
  }

  #onIssues(issues: string[]): void {
    const session = this.#session
    if (session === null) return
    this.#issues = [...issues]
    this.#emit({ type: 'issues', root: session.root, issues: [...issues] })
  }

  #onTreeChange(paths: readonly string[]): void {
    const session = this.#session
    if (session === null) return
    this.#emit({ type: 'treeChanged', root: session.root, paths: paths.map(toPosix) })
  }

  #onDegraded(kind: WatchScopeKind, dir: string, degraded: boolean): void {
    const session = this.#session
    if (session === null) return
    this.#emit({ type: 'degraded', root: session.root, kind, dir, degraded })
  }
}

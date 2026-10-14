import { mkdir, open, readdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { basename, join, posix, resolve } from 'node:path'
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
  GitApplyHunkRequest,
  GitBranchCheckoutRequest,
  GitBranchCreateRequest,
  GitBranchDeleteRequest,
  GitBranchRenameRequest,
  GitBranchSetUpstreamRequest,
  GitBatchResult,
  GitCheckoutDetachRequest,
  GitCheckoutRequest,
  GitCommitRequest,
  GitDiffFilesRequest,
  GitDiffRequest,
  GitDiffResponse,
  GitFetchManyRequest,
  GitFetchRequest,
  GitFetchResponse,
  GitFileLogRequest,
  GitHeadCommitRequest,
  GitHeadCommitResponse,
  GitIgnoreRequest,
  GitPathsRequest,
  GitPullManyRequest,
  GitPullRequest,
  GitPullResponse,
  GitPushRequest,
  GitPushResponse,
  GitRef,
  GitRefsRequest,
  GitRemoteAddRequest,
  GitRemoteRemoveRequest,
  GitRemotesRequest,
  GitRemotesResponse,
  GitRemoteSetUrlRequest,
  GitRemoteTagsRequest,
  GitRemoteTagsResponse,
  GitStatusRequest,
  GitTagCreateRequest,
  GitTagDeleteRemoteRequest,
  GitTagDeleteRequest,
  GitTagPushAllRequest,
  GitTagPushRequest,
  GitTagPushResponse,
  GitVersionInfo,
  PullStrategy,
  RemoteInfo,
  RepoRecord,
  RepoStatus,
  RepoStatusSnapshot,
  RecentWorkspace,
  SettingsGetRequest,
  SettingsScope,
  SettingsSetRequest,
  SettingsRemoveRequest,
  TrustGrantRequest,
  WorkspaceDescriptor,
  WorkspaceListFilesResponse,
  WatchScopeKind
} from '@gitreedesk/shared'
import {
  addRemote,
  applyPatch,
  checkoutBranch,
  checkoutDetach,
  commit as createCommit,
  createBackupRef,
  createBranch,
  createTag,
  deleteBranch,
  deleteRemoteTag,
  deleteTag,
  discardWorktreePaths,
  fetchRemote,
  GitCommandError,
  GitPool,
  isBranchMerged,
  isHeadPushed,
  listChangedFiles,
  listRefs,
  listRemoteTags,
  listRemotes,
  logCommits,
  pathExists,
  probeGitVersion,
  pullRepo,
  pushAllTags,
  pushBranch,
  pushTag,
  readDiff,
  readFileSnapshot,
  readHeadCommit,
  readHeadSha,
  removeRemote,
  renameBranch,
  resolveDefaultRemote,
  setRemoteUrl,
  setUpstream,
  stageAll as gitStageAll,
  stagePaths as gitStagePaths,
  unstageAll as gitUnstageAll,
  unstagePaths as gitUnstagePaths
} from '@gitreedesk/git-core'
import {
  createPathMatcher,
  WorkspaceSession,
  statusTargetFor,
  type RepoDiff,
  type WatchBackend
} from '@gitreedesk/workspace-core'
import {
  CacheStore,
  RepoStore,
  SettingsStore,
  UiStateStore,
  WorkspaceStore,
  normalizeWorkspaceRoot,
  openCacheDatabase,
  type SettingsChange
} from '@gitreedesk/store'
import { ServiceError } from './errors'

const toPosix = (value: string): string => value.replace(/\\/g, '/')

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

export type WorkspaceServiceEvent =
  | { type: 'reposChanged'; root: string; diff: RepoDiff }
  | { type: 'status'; root: string; update: RepoStatusSnapshot }
  | { type: 'commitOutput'; root: string; gitDir: string; chunk: string }
  | { type: 'treeChanged'; root: string; paths: string[] }
  | { type: 'issues'; root: string; issues: string[] }
  | { type: 'degraded'; root: string; kind: WatchScopeKind; dir: string; degraded: boolean }
  | { type: 'settingsChanged'; change: SettingsChange }

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
  readonly #uiState: UiStateStore
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
    this.#uiState = new UiStateStore(this.#db)

    this.#settings.onDidChange((change) => {
      this.#emit({ type: 'settingsChanged', change })
    })
  }

  /** Opens a workspace; opening the already-open root returns its current state. */
  async open(root: string): Promise<WorkspaceDescriptor> {
    this.#assertLive()

    const existing = this.#session
    if (existing !== null && normalizeWorkspaceRoot(existing.root) === normalizeWorkspaceRoot(root)) {
      return this.#descriptor()
    }
    if (existing !== null) await this.#closeSession()

    const session = new WorkspaceSession({
      root,
      pool: this.#pool,
      watchBackend: this.#watchBackend,
      onStatus: (gitDir, status) => {
        this.#onStatus(gitDir, status)
      },
      onError: (gitDir, error) => {
        console.warn(`[workspace] status read failed for ${gitDir}`, error)
      },
      onReposChanged: (diff) => {
        this.#onReposChanged(diff)
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
    try {
      result = await session.open()
    } catch (error) {
      this.#session = null
      await session.close().catch(() => undefined)
      throw error
    }

    const row = this.#workspaces.upsert(session.root, { name: session.config.name ?? basename(session.root) })
    this.#workspaceId = row.id
    this.#syncRows(session.registry.all)
    this.#stats = result.stats
    this.#issues = [...result.issues]
    return this.#descriptor()
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
    const result = await session.rescan(scoped)
    if (result !== null) this.#stats = result.stats
    return null
  }

  /** Fresh status read for one checkout (the interactive path, no fingerprint skip). */
  async getStatus(request: GitStatusRequest): Promise<{ status: RepoStatus }> {
    const session = this.#requireSession()
    const record = this.#requireCheckout(session, request.gitDir)
    const status = await session.scheduler.request(statusTargetFor(record), {
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

  /** Switches to a branch; a remote-only name creates the tracking branch (git DWIM). */
  async gitBranchCheckout(request: GitBranchCheckoutRequest): Promise<{ stash: AutoStashReport }> {
    const record = this.#requireWriteCheckout(request.gitDir)
    const stash = await this.#gitOperation(record, (repoPath) => checkoutBranch(repoPath, request.name))
    return { stash }
  }

  /** Checks out a commit, tag or remote branch into detached HEAD. */
  async gitCheckoutDetach(request: GitCheckoutDetachRequest): Promise<{ stash: AutoStashReport }> {
    const record = this.#requireWriteCheckout(request.gitDir)
    const stash = await this.#gitOperation(record, (repoPath) => checkoutDetach(repoPath, request.rev))
    return { stash }
  }

  /** Creates a branch from any ref, optionally switching to it and tracking an upstream. */
  async gitBranchCreate(
    request: GitBranchCreateRequest
  ): Promise<{ upstream: string | null; stash: AutoStashReport }> {
    const record = this.#requireWriteCheckout(request.gitDir)
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
   * backup ref first, so the deletion stays undoable.
   */
  async gitBranchDelete(
    request: GitBranchDeleteRequest
  ): Promise<{ merged: boolean; backup: BackupRef | null }> {
    const record = this.#requireWriteCheckout(request.gitDir)
    return await this.#gitOperation(record, async (repoPath) => {
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
      return { merged, backup }
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
    return { remote, updated: result.updated, output: result.output }
  }

  /** Pulls with the strategy resolved from settings (per-repo override first). */
  async gitPull(request: GitPullRequest): Promise<GitPullResponse> {
    const record = this.#requireWriteCheckout(request.gitDir)
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

  async gitPush(request: GitPushRequest): Promise<GitPushResponse> {
    const record = this.#requireCheckout(this.#requireSession(), request.gitDir)
    const remote = await this.#resolveRemote(record, request.remote)
    const result = await this.#gitOperation(
      record,
      (repoPath) =>
        pushBranch(repoPath, {
          remote,
          branch: request.branch,
          setUpstream: request.setUpstream === true,
          forceWithLease: request.forceWithLease === true
        }),
      (error) => toNetworkServiceError(error, remote)
    )
    return { remote, output: `${result.stdout}${result.stderr}`.trimEnd() }
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
      .request(statusTargetFor(record), { reason: 'interactive', refresh: true })
      .catch(() => undefined)
  }

  async watchDirectory(path: string): Promise<null> {
    const session = this.#requireSession()
    session.watchDirectory(await this.resolveInside(path))
    return null
  }

  async unwatchDirectory(path: string): Promise<null> {
    const session = this.#requireSession()
    session.unwatchDirectory(await this.resolveInside(path))
    return null
  }

  /**
   * Absolute real path of the input, which must sit inside the root or a registered
   * checkout. Resolves symlinks, so use it for directories.
   */
  async resolveInside(input: string): Promise<string> {
    const session = this.#requireSession()
    const resolved = resolve(input)
    const absolute = await realpath(resolved)
      .then(toPosix)
      .catch(() => toPosix(resolved))
    return this.#assertInsideWorkspace(session, absolute, input)
  }

  /**
   * Real path of an entry inside the workspace that keeps a trailing symlink as the
   * entry itself (renaming a link renames the link, not its target).
   */
  async resolveEntry(input: string): Promise<string> {
    const session = this.#requireSession()
    const resolved = resolve(input)
    const parent = await realpath(resolve(resolved, '..'))
      .then(toPosix)
      .catch(() => toPosix(resolve(resolved, '..')))
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

    const rowId = this.#rowIdByGitDir.get(gitDir)
    if (rowId !== undefined) this.#cache.saveStatus(rowId, status, at)

    const root = this.#session?.root
    if (root === undefined || root.length === 0) return
    this.#emit({ type: 'status', root, update: { gitDir, status, updatedAt: at } })
  }

  #onReposChanged(diff: RepoDiff): void {
    const session = this.#session
    if (session === null) return
    this.#syncRows(session.registry.all)
    this.#emit({ type: 'reposChanged', root: session.root, diff })
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

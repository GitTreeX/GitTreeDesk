import { mkdir, open, readdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { basename, join, posix, resolve } from 'node:path'
import type {
  CommitInfo,
  DiscoveryResult,
  DiscoveryStats,
  FsEntry,
  FsEntryKind,
  FsPathRequest,
  FsReadFileRequest,
  FsReadFileResponse,
  FsStatResponse,
  FsWriteFileRequest,
  FsWriteFileResponse,
  GitApplyHunkRequest,
  GitCheckoutRequest,
  GitCommitRequest,
  GitDiffRequest,
  GitDiffResponse,
  GitFileLogRequest,
  GitHeadCommitRequest,
  GitHeadCommitResponse,
  GitIgnoreRequest,
  GitPathsRequest,
  GitRef,
  GitRefsRequest,
  GitStatusRequest,
  GitVersionInfo,
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
  applyPatch,
  commit as createCommit,
  discardWorktreePaths,
  GitCommandError,
  GitPool,
  isHeadPushed,
  listRefs,
  logCommits,
  pathExists,
  probeGitVersion,
  readDiff,
  readFileSnapshot,
  readHeadCommit,
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

function toGitServiceError(error: unknown): ServiceError {
  if (error instanceof ServiceError) return error
  if (error instanceof GitCommandError) {
    const lines = error.stderr
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
    const detail = lines.find((line) => line.startsWith('error:') || line.startsWith('fatal:')) ?? lines[0]
    return new ServiceError('git-failed', (detail ?? error.message).replace(/^(error|fatal):\s*/, ''))
  }
  const message = error instanceof Error ? error.message : String(error)
  return new ServiceError('git-failed', message)
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
  async #gitOperation<T>(record: RepoRecord, task: (repoPath: string) => Promise<T>): Promise<T> {
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
      throw toGitServiceError(error)
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

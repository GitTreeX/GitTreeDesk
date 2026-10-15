import { realpath } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { DiscoveryResult, DiscoveryStats, RepoRecord, RepoStatus, WorkspaceConfig } from '@gitreedesk/shared'
import type { GitPool } from '@gitreedesk/git-core'
import { loadWorkspaceConfig } from './config'
import { discoverRepositories } from './discovery'
import { mergeScopedRecords } from './incremental'
import { canonicalPath } from './paths'
import { WorkspaceRegistry, type RepoDiff } from './registry'
import { StatusScheduler, statusTargetFor, type StatusReason } from './scheduler'
import {
  parcelWatchBackend,
  WatcherService,
  type GitDirChangeBatch,
  type WatchBackend,
  type WatchScopeKind
} from './watcher'

const toPosix = (value: string): string => value.replace(/\\/g, '/')

/** Delay before retrying a scoped rescan whose candidate confirmation failed mid-creation. */
const CONFIRM_RETRY_MS = 500
const MAX_CONFIRM_RETRIES = 2

export interface WorkspaceSessionOptions {
  root: string
  pool: GitPool
  /** Skips `workspace.json`; the given config wins. */
  config?: WorkspaceConfig
  /** `null` disables filesystem watching (tests, headless use); rescans stay available. */
  watchBackend?: WatchBackend | null
  /**
   * Records shown immediately on open (a cache-first open); the caller still runs a
   * full rescan so the tree converges on the live state. Empty or absent ⇒ the open
   * waits for discovery instead.
   */
  seedRecords?: readonly RepoRecord[]
  debounceMs?: number
  pollIntervalMs?: number
  treeWatchCap?: number
  /** Per-repo untracked listing mode for status reads; `undefined` keeps the default. */
  untrackedStrategy?: (record: RepoRecord) => 'no' | 'normal' | 'all' | undefined
  onStatus?: (key: string, status: RepoStatus) => void
  /** Per-read timing; `skipped` marks a fingerprint hit that avoided a git call. */
  onStatusRead?: (key: string, ms: number, skipped: boolean) => void
  onError?: (key: string, error: unknown) => void
  onReposChanged?: (diff: RepoDiff, records: RepoRecord[], stats?: DiscoveryStats) => void
  onIssues?: (issues: string[]) => void
  /** Raw working-tree change paths, for explorer invalidation. */
  onTreeChange?: (paths: readonly string[]) => void
  onDegraded?: (kind: WatchScopeKind, dir: string, degraded: boolean) => void
}

/**
 * Owns one open workspace: discovery and its incremental rescans, the repository
 * registry, the status scheduler, and filesystem watching. Filesystem events are
 * routed to scoped rescans (discovery) or debounced status refreshes (git dirs and
 * working trees the UI shows).
 */
export class WorkspaceSession {
  readonly #pool: GitPool
  readonly #options: WorkspaceSessionOptions
  readonly #scheduler: StatusScheduler
  #registry: WorkspaceRegistry | null = null
  #watcher: WatcherService | null = null
  #config: WorkspaceConfig | null = null
  #root = ''
  #queue: Promise<void> = Promise.resolve()
  #retryTimers = new Set<NodeJS.Timeout>()
  #retryPending = new Set<string>()
  #confirmRetries = new Map<string, number>()
  #opened = false
  #closed = false

  constructor(options: WorkspaceSessionOptions) {
    this.#pool = options.pool
    this.#options = options
    this.#scheduler = new StatusScheduler({
      pool: options.pool,
      debounceMs: options.debounceMs,
      onStatus: (key, status) => options.onStatus?.(key, status),
      onRead: (key, ms, skipped) => options.onStatusRead?.(key, ms, skipped),
      onError: (key, error) => options.onError?.(key, error)
    })
  }

  get root(): string {
    return this.#root
  }

  get config(): WorkspaceConfig {
    if (this.#config === null) throw new Error('The workspace session is not open yet')
    return this.#config
  }

  get registry(): WorkspaceRegistry {
    if (this.#registry === null) throw new Error('The workspace session is not open yet')
    return this.#registry
  }

  get scheduler(): StatusScheduler {
    return this.#scheduler
  }

  async open(): Promise<DiscoveryResult> {
    if (this.#opened) throw new Error('The workspace session is already open')
    this.#opened = true

    const root = resolve(this.#options.root)
    this.#root = await realpath(root)
      .then(toPosix)
      .catch(() => toPosix(root))

    const loaded =
      this.#options.config === undefined
        ? await loadWorkspaceConfig(this.#root)
        : { config: this.#options.config, issues: [] as string[] }
    this.#config = loaded.config

    const seed = this.#options.seedRecords
    let result: DiscoveryResult
    if (seed !== undefined && seed.length > 0) {
      // Cache-first: reuse the previous session's records so the tree paints at once;
      // the caller follows up with a full rescan that converges on the live state.
      result = {
        repos: [...seed],
        stats: {
          dirsScanned: 0,
          candidates: 0,
          repos: seed.length,
          budgetExceeded: false,
          maxDepthReached: false
        },
        issues: []
      }
    } else {
      result = await discoverRepositories({ root: this.#root, config: loaded.config, pool: this.#pool })
    }

    if (loaded.issues.length > 0) this.#options.onIssues?.(loaded.issues)
    if (result.issues.length > 0) this.#options.onIssues?.(result.issues)

    this.#registry = new WorkspaceRegistry({ root: this.#root, config: loaded.config })
    this.#registry.replace(result.repos)

    await this.#startWatcher(loaded.config, result.repos)
    void this.warmUp()
    return result
  }

  async #startWatcher(config: WorkspaceConfig, records: readonly RepoRecord[]): Promise<void> {
    const backend = this.#options.watchBackend === undefined ? parcelWatchBackend : this.#options.watchBackend
    if (backend === null) return
    this.#watcher = new WatcherService({
      backend,
      root: this.#root,
      config,
      debounceMs: this.#options.debounceMs,
      pollIntervalMs: this.#options.pollIntervalMs,
      treeWatchCap: this.#options.treeWatchCap,
      onDiscoveryChange: (dirs) => void this.rescan(dirs),
      onGitDirChange: (batches, reason) => this.#refreshGitDirs(batches, reason),
      onTreeChange: (paths) => this.#refreshTree(paths),
      onDegraded: this.#options.onDegraded
    })
    await this.#watcher.start()
    this.#watcher.updateRepos(records)
  }

  setConfig(config: WorkspaceConfig): void {
    this.#config = config
    this.#registry?.setConfig(config)
    this.#watcher?.setConfig(config)
  }

  /**
   * Re-runs discovery, either fully (`undefined`) or scoped to the given directories.
   * Full rescans resolve with the fresh discovery result; scoped ones return null.
   */
  rescan(dirs?: readonly string[]): Promise<DiscoveryResult | null> {
    if (!this.#opened) throw new Error('The workspace session is not open yet')
    return this.#enqueue(() => this.#rescanNow(dirs))
  }

  async warmUp(records?: readonly RepoRecord[]): Promise<void> {
    const targets = records ?? this.registry.all
    await Promise.allSettled(targets.map((record) => this.#requestStatus(record, 'warmup')))
  }

  /** Fallback polling cadence for degraded watch scopes; applies to future retries. */
  setPollIntervalMs(ms: number): void {
    this.#watcher?.setPollIntervalMs(ms)
  }

  /** Live watch scope counts; zeroes once the watcher is stopped. */
  watcherStats(): { scopes: number; subscribed: number; degraded: number } {
    return this.#watcher?.stats() ?? { scopes: 0, subscribed: 0, degraded: 0 }
  }

  watchDirectory(dir: string): void {
    this.#watcher?.watchTree(resolve(dir))
  }

  unwatchDirectory(dir: string): void {
    this.#watcher?.unwatchTree(resolve(dir))
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    for (const timer of this.#retryTimers) clearTimeout(timer)
    this.#retryTimers.clear()
    const watcher = this.#watcher
    this.#watcher = null
    if (watcher !== null) await watcher.stop()
    this.#scheduler.dispose()
  }

  #enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(task, task)
    this.#queue = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  async #rescanNow(dirs?: readonly string[]): Promise<DiscoveryResult | null> {
    if (this.#closed) return null
    const registry = this.registry
    const config = this.config

    if (dirs === undefined) {
      const result = await discoverRepositories({ root: this.#root, config, pool: this.#pool })
      if (result.issues.length > 0) this.#options.onIssues?.(result.issues)
      this.#applyRecords(result.repos, result.stats)
      return result
    }

    let records = registry.all
    for (const dir of dirs) {
      const scope = await this.#scopeDirFor(dir)
      const result = await discoverRepositories({ root: this.#root, config, pool: this.#pool, scope })
      if (result.issues.length > 0) this.#options.onIssues?.(result.issues)
      // A candidate that failed confirmation may have been caught mid-creation (a
      // repository is registered moments after its directory appears); retry a few times.
      if (result.repos.length === 0 && result.issues.length > 0) this.#scheduleConfirmRetry(scope)
      else this.#confirmRetries.delete(scope)
      records = mergeScopedRecords(records, result.repos, scope)
    }
    this.#applyRecords(records)
    return null
  }

  async #scopeDirFor(dir: string): Promise<string> {
    // A directory deleted behind the app's back has no real path of its own, but the
    // records it owns are still spelled canonically — hence the ancestor fallback.
    return await canonicalPath(resolve(dir))
  }

  #scheduleConfirmRetry(scope: string): void {
    if (this.#retryPending.has(scope)) return
    const attempts = this.#confirmRetries.get(scope) ?? 0
    if (attempts >= MAX_CONFIRM_RETRIES) return

    this.#confirmRetries.set(scope, attempts + 1)
    this.#retryPending.add(scope)
    const timer = setTimeout(() => {
      this.#retryTimers.delete(timer)
      this.#retryPending.delete(scope)
      void this.rescan([scope])
    }, CONFIRM_RETRY_MS)
    this.#retryTimers.add(timer)
  }

  #applyRecords(next: readonly RepoRecord[], stats?: DiscoveryStats): void {
    const diff = this.registry.replace(next)
    for (const record of diff.removed) this.#scheduler.forget(record.gitDir)
    this.#watcher?.updateRepos(next)
    if (diff.added.length > 0 || diff.updated.length > 0) void this.warmUp([...diff.added, ...diff.updated])
    const changed = diff.added.length > 0 || diff.removed.length > 0 || diff.updated.length > 0
    // A full rescan reports even an unchanged result: its stats still refresh the UI.
    if (changed || stats !== undefined) {
      this.#options.onReposChanged?.(diff, this.registry.all, stats)
    }
  }

  #refreshGitDirs(batches: readonly GitDirChangeBatch[], reason: 'event' | 'poll'): void {
    const requestReason: StatusReason = reason === 'poll' ? 'poll' : 'event'
    const records = this.registry.all
    const targets = new Map<string, RepoRecord>()

    for (const batch of batches) {
      for (const record of records) {
        if (record.gitDir === '') continue
        const affected = batch.shared
          ? record.gitDir === batch.gitDir || record.commonDir === batch.gitDir
          : record.gitDir === batch.gitDir
        if (affected) targets.set(record.gitDir, record)
      }
    }

    for (const record of targets.values()) void this.#requestStatus(record, requestReason)
  }

  #refreshTree(paths: readonly string[]): void {
    this.#options.onTreeChange?.(paths)
    const records = this.registry.all
    const seen = new Set<string>()

    for (const path of paths) {
      const dir = toPosix(dirname(path))
      const record = this.#ownerOf(dir, records)
      if (record === undefined || seen.has(record.gitDir)) continue
      seen.add(record.gitDir)
      void this.#requestStatus(record, 'event')
    }
  }

  #ownerOf(dirPosix: string, records: readonly RepoRecord[]): RepoRecord | undefined {
    let best: RepoRecord | undefined
    for (const record of records) {
      if (record.gitDir === '') continue
      if (dirPosix !== record.path && !dirPosix.startsWith(`${record.path}/`)) continue
      if (best === undefined || record.path.length > best.path.length) best = record
    }
    return best
  }

  #requestStatus(record: RepoRecord, reason: StatusReason): Promise<RepoStatus | null> {
    if (record.gitDir === '') return Promise.resolve(null)
    const target = statusTargetFor(record)
    const untracked = this.#options.untrackedStrategy?.(record)
    if (untracked !== undefined) target.untracked = untracked
    return this.#scheduler.request(target, { reason }).catch(() => null)
  }
}

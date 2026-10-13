import { stat } from 'node:fs/promises'
import { basename, dirname, relative } from 'node:path'
import { subscribe as subscribeFs, type Event as FsEvent } from '@parcel/watcher'
import type { RepoRecord, WatchScopeKind, WorkspaceConfig } from '@gitreedesk/shared'
import { matchesSubtree } from './glob'

export type { WatchScopeKind }

const toPosix = (value: string): string => value.replace(/\\/g, '/')

/** Directory names that never take part in discovery or subtree watching. */
const BUILTIN_SKIP = new Set(['node_modules', '.git', '.svn', '.hg'])

/**
 * Directory creates/deletes up to this root-relative depth trigger a scoped rescan,
 * which covers repositories added anywhere beneath. The depth leaves room for
 * "new repository inside an existing grouping folder"; deeper additions are still
 * picked up when one of their ancestor directories appears.
 */
const DISCOVERY_DIR_DEPTH = 3

export type WatchEventKind = 'create' | 'update' | 'delete'

export interface WatchEvent {
  /** Absolute native path. */
  path: string
  kind: WatchEventKind
}

export interface WatchSubscription {
  close(): Promise<void>
}

export interface WatchBackendOptions {
  dir: string
  /** Glob patterns relative to `dir`; matched subtrees do not produce events. */
  ignore?: readonly string[]
  onEvents: (events: WatchEvent[]) => void
  onError: (error: unknown) => void
}

export interface WatchBackend {
  subscribe(options: WatchBackendOptions): Promise<WatchSubscription>
}

export const parcelWatchBackend: WatchBackend = {
  async subscribe({ dir, ignore, onEvents, onError }) {
    const subscription = await subscribeFs(
      dir,
      (error: Error | null, events: FsEvent[]) => {
        if (error !== null) {
          onError(error)
          return
        }
        onEvents(events.map((event) => ({ path: event.path, kind: event.type })))
      },
      ignore === undefined || ignore.length === 0 ? undefined : { ignore: [...ignore] }
    )
    return { close: () => subscription.unsubscribe() }
  }
}

export type GitDirInterestKind = 'checkout' | 'shared'

const CHECKOUT_MARKERS = new Set(['HEAD', 'index', 'ORIG_HEAD', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD'])

/**
 * Classifies a path relative to a git dir (POSIX separators) by the status data it
 * affects. `shared` state lives in the common dir: a change there can affect every
 * checkout of the repository. `checkout` state only affects the checkout owning the
 * git dir. Returns null for paths a status read does not depend on.
 */
export function gitDirEventInterest(relPath: string): GitDirInterestKind | null {
  if (relPath.startsWith('refs/') || relPath === 'packed-refs' || relPath === 'logs/refs/stash') return 'shared'
  if (CHECKOUT_MARKERS.has(relPath) || relPath === 'stash') return 'checkout'
  if (relPath.startsWith('rebase-merge/') || relPath.startsWith('rebase-apply/')) return 'checkout'
  if (basename(relPath).startsWith('BISECT_')) return 'checkout'
  return null
}

const DISCOVERY_IGNORE = ['node_modules/**', '.svn/**', '.hg/**'] as const

/** Git-dir subtrees that never carry status-relevant state. */
const GIT_DIR_IGNORE = ['objects/**', 'hooks/**', 'info/**', 'modules/**', 'worktrees/**', 'lfs/**', 'svn/**'] as const

const TREE_IGNORE = ['node_modules/**', '.git/**', '.svn/**', '.hg/**'] as const

function ignoresFor(kind: WatchScopeKind): readonly string[] {
  switch (kind) {
    case 'discovery':
      return DISCOVERY_IGNORE
    case 'gitdir':
      return GIT_DIR_IGNORE
    case 'tree':
      return TREE_IGNORE
  }
}

export interface GitDirChangeBatch {
  gitDir: string
  /** True when ref state shared by every checkout of the repository may have changed. */
  shared: boolean
}

export interface WatcherServiceOptions {
  backend: WatchBackend
  /** Absolute workspace root; discovery events are resolved against it. */
  root: string
  config: WorkspaceConfig
  onDiscoveryChange: (dirs: string[], reason: 'event' | 'poll') => void
  onGitDirChange: (batches: GitDirChangeBatch[], reason: 'event' | 'poll') => void
  onTreeChange: (paths: string[]) => void
  onDegraded?: (kind: WatchScopeKind, dir: string, degraded: boolean) => void
  /** Polling cadence for degraded scopes; backs off up to ten times while a scope stays broken. */
  pollIntervalMs?: number
  debounceMs?: number
  /** Maximum number of working-tree subscriptions; least recently used are released first. */
  treeWatchCap?: number
}

const DEFAULT_POLL_INTERVAL_MS = 60_000
const DEFAULT_DEBOUNCE_MS = 250
const DEFAULT_TREE_WATCH_CAP = 2000

interface Scope {
  key: string
  kind: WatchScopeKind
  dir: string
  subscription: WatchSubscription | null
  degraded: boolean
  backoffMs: number
  pollTimer: NodeJS.Timeout | null
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

function isAncestorDir(ancestor: string, dir: string): boolean {
  const ancestorPosix = toPosix(ancestor)
  const dirPosix = toPosix(dir)
  return dirPosix === ancestorPosix || dirPosix.startsWith(`${ancestorPosix}/`)
}

/**
 * Plans filesystem watching for one workspace: a shallow discovery watch over the
 * root, one git-dir watch per registered checkout, and working-tree watches for the
 * directories the UI currently shows. Event bursts are debounced and coalesced;
 * scopes that fail to subscribe (or break later) degrade to backoff polling that
 * keeps retrying the subscription.
 */
export class WatcherService {
  readonly #backend: WatchBackend
  readonly #root: string
  readonly #onDiscoveryChange: WatcherServiceOptions['onDiscoveryChange']
  readonly #onGitDirChange: WatcherServiceOptions['onGitDirChange']
  readonly #onTreeChange: WatcherServiceOptions['onTreeChange']
  readonly #onDegraded: WatcherServiceOptions['onDegraded']
  readonly #pollIntervalMs: number
  readonly #debounceMs: number
  readonly #treeWatchCap: number
  #config: WorkspaceConfig
  #scopes = new Map<string, Scope>()
  #running = false
  #discoveryDirs = new Set<string>()
  #gitDirChanges = new Map<string, boolean>()
  #treePaths = new Set<string>()
  #flushTimer: NodeJS.Timeout | null = null

  constructor(options: WatcherServiceOptions) {
    this.#backend = options.backend
    this.#root = options.root
    this.#config = options.config
    this.#onDiscoveryChange = options.onDiscoveryChange
    this.#onGitDirChange = options.onGitDirChange
    this.#onTreeChange = options.onTreeChange
    this.#onDegraded = options.onDegraded
    this.#pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
    this.#debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS
    this.#treeWatchCap = options.treeWatchCap ?? DEFAULT_TREE_WATCH_CAP
  }

  async start(): Promise<void> {
    if (this.#running) return
    this.#running = true
    await this.#openScope('discovery', this.#root)
  }

  async stop(): Promise<void> {
    if (!this.#running) return
    this.#running = false
    if (this.#flushTimer !== null) {
      clearTimeout(this.#flushTimer)
      this.#flushTimer = null
    }
    this.#discoveryDirs.clear()
    this.#gitDirChanges.clear()
    this.#treePaths.clear()
    const scopes = [...this.#scopes.values()]
    this.#scopes.clear()
    await Promise.all(scopes.map((scope) => this.#closeScope(scope)))
  }

  setConfig(config: WorkspaceConfig): void {
    this.#config = config
  }

  /** Keeps one git-dir watch per registered checkout; bare repositories have no status to watch. */
  updateRepos(records: readonly RepoRecord[]): void {
    if (!this.#running) return
    const wanted = new Set<string>()
    for (const record of records) {
      if (record.kind === 'bare' || record.gitDir === '') continue
      wanted.add(record.gitDir)
    }

    for (const scope of [...this.#scopes.values()]) {
      if (scope.kind === 'gitdir' && !wanted.has(scope.dir)) void this.#closeScope(scope)
    }
    for (const gitDir of wanted) {
      if (!this.#scopes.has(this.#key('gitdir', gitDir))) void this.#openScope('gitdir', gitDir)
    }
  }

  /**
   * Watches a directory the UI currently shows. Subscriptions are recursive, so a
   * directory already covered by a watched ancestor adds no subscription.
   */
  watchTree(dir: string): void {
    if (!this.#running) return
    const exact = this.#scopes.get(this.#key('tree', dir))
    if (exact !== undefined) {
      this.#touchTreeScope(exact)
      return
    }
    for (const scope of this.#scopes.values()) {
      if (scope.kind === 'tree' && isAncestorDir(scope.dir, dir)) {
        this.#touchTreeScope(scope)
        return
      }
    }
    void this.#openScope('tree', dir)
  }

  /** Releases the watch for a collapsed directory. Ancestor coverage stays in place. */
  unwatchTree(dir: string): void {
    const exact = this.#scopes.get(this.#key('tree', dir))
    if (exact !== undefined) void this.#closeScope(exact)
  }

  #key(kind: WatchScopeKind, dir: string): string {
    return `${kind}\u0000${dir}`
  }

  async #openScope(kind: WatchScopeKind, dir: string): Promise<void> {
    if (!this.#running) return
    const key = this.#key(kind, dir)
    if (this.#scopes.has(key)) return

    const scope: Scope = {
      key,
      kind,
      dir,
      subscription: null,
      degraded: false,
      backoffMs: this.#pollIntervalMs,
      pollTimer: null
    }
    this.#scopes.set(key, scope)
    if (kind === 'tree') this.#enforceTreeCap()

    try {
      await this.#subscribe(scope)
    } catch {
      this.#degrade(scope)
    }
  }

  async #closeScope(scope: Scope): Promise<void> {
    if (this.#scopes.get(scope.key) === scope) this.#scopes.delete(scope.key)
    if (scope.pollTimer !== null) {
      clearTimeout(scope.pollTimer)
      scope.pollTimer = null
    }
    const subscription = scope.subscription
    scope.subscription = null
    if (subscription !== null) await subscription.close().catch(() => undefined)
  }

  async #subscribe(scope: Scope): Promise<void> {
    const subscription = await this.#backend.subscribe({
      dir: scope.dir,
      ignore: ignoresFor(scope.kind),
      onEvents: (events) => this.#handleEvents(scope, events),
      onError: () => this.#degrade(scope)
    })
    if (!this.#running || this.#scopes.get(scope.key) !== scope) {
      await subscription.close().catch(() => undefined)
      return
    }
    scope.subscription = subscription
  }

  #touchTreeScope(scope: Scope): void {
    this.#scopes.delete(scope.key)
    this.#scopes.set(scope.key, scope)
  }

  #enforceTreeCap(): void {
    const trees = [...this.#scopes.values()].filter((scope) => scope.kind === 'tree')
    for (let i = 0; i < trees.length - this.#treeWatchCap; i += 1) {
      const scope = trees[i]
      if (scope !== undefined) void this.#closeScope(scope)
    }
  }

  #handleEvents(scope: Scope, events: WatchEvent[]): void {
    switch (scope.kind) {
      case 'discovery':
        void this.#handleDiscoveryEvents(events)
        return
      case 'gitdir':
        this.#handleGitDirEvents(scope.dir, events)
        return
      case 'tree':
        for (const event of events) this.#treePaths.add(event.path)
        this.#scheduleFlush()
        return
    }
  }

  async #handleDiscoveryEvents(events: WatchEvent[]): Promise<void> {
    for (const event of events) {
      if (event.kind === 'update') continue
      const rel = toPosix(relative(this.#root, event.path))
      if (rel === '' || rel.startsWith('..')) continue
      const segments = rel.split('/')
      const name = segments[segments.length - 1] ?? ''

      // A repository appears (or disappears) as its `.git` marker does; the marker sits
      // one level below the checkout, so it is interesting slightly deeper than plain dirs.
      if (name === '.git') {
        if (segments.length > DISCOVERY_DIR_DEPTH + 1) continue
        const dir = dirname(event.path)
        if (!this.#isExcluded(dir)) this.#discoveryDirs.add(dir)
        continue
      }

      if (segments.length > DISCOVERY_DIR_DEPTH) continue
      if (segments.some((segment) => BUILTIN_SKIP.has(segment))) continue
      if (this.#isExcluded(event.path)) continue
      if (event.kind === 'delete') {
        this.#discoveryDirs.add(event.path)
        continue
      }
      if (await isDirectory(event.path)) this.#discoveryDirs.add(event.path)
    }
    this.#scheduleFlush()
  }

  #handleGitDirEvents(dir: string, events: WatchEvent[]): void {
    let matched = false
    let shared = false
    for (const event of events) {
      const interest = gitDirEventInterest(toPosix(relative(dir, event.path)))
      if (interest === null) continue
      matched = true
      if (interest === 'shared') shared = true
    }
    if (!matched) return
    this.#gitDirChanges.set(dir, (this.#gitDirChanges.get(dir) ?? false) || shared)
    this.#scheduleFlush()
  }

  #isExcluded(path: string): boolean {
    return matchesSubtree(this.#config.exclude, toPosix(relative(this.#root, path)))
  }

  #scheduleFlush(): void {
    if (!this.#running || this.#flushTimer !== null) return
    this.#flushTimer = setTimeout(() => {
      this.#flushTimer = null
      this.#flush()
    }, this.#debounceMs)
  }

  #flush(): void {
    const discovery = [...this.#discoveryDirs]
    const gitDirs = [...this.#gitDirChanges]
    const tree = [...this.#treePaths]
    this.#discoveryDirs.clear()
    this.#gitDirChanges.clear()
    this.#treePaths.clear()

    if (discovery.length > 0) this.#onDiscoveryChange(this.#collapseToTopMost(discovery), 'event')
    if (gitDirs.length > 0) {
      this.#onGitDirChange(
        gitDirs.map(([gitDir, shared]) => ({ gitDir, shared })),
        'event'
      )
    }
    if (tree.length > 0) this.#onTreeChange(tree)
  }

  /** Drops candidates covered by a shallower candidate: rescanning the ancestor covers them. */
  #collapseToTopMost(dirs: readonly string[]): string[] {
    const relByDir = new Map(dirs.map((dir) => [dir, toPosix(relative(this.#root, dir))]))
    const sorted = [...dirs].sort((a, b) => {
      const aDepth = (relByDir.get(a) ?? '').split('/').length
      const bDepth = (relByDir.get(b) ?? '').split('/').length
      return aDepth - bDepth
    })

    const kept: string[] = []
    for (const dir of sorted) {
      const rel = relByDir.get(dir) ?? ''
      const covered = kept.some((candidate) => {
        const candidateRel = relByDir.get(candidate) ?? ''
        return candidateRel === '' || rel === candidateRel || rel.startsWith(`${candidateRel}/`)
      })
      if (!covered) kept.push(dir)
    }
    return kept
  }

  #degrade(scope: Scope): void {
    if (!this.#running || this.#scopes.get(scope.key) !== scope) return
    if (scope.degraded) return

    scope.degraded = true
    scope.backoffMs = this.#pollIntervalMs
    const subscription = scope.subscription
    scope.subscription = null
    if (subscription !== null) void subscription.close().catch(() => undefined)
    this.#onDegraded?.(scope.kind, scope.dir, true)
    this.#schedulePoll(scope)
  }

  #schedulePoll(scope: Scope): void {
    if (!this.#running || this.#scopes.get(scope.key) !== scope) return
    scope.pollTimer = setTimeout(() => {
      scope.pollTimer = null
      void this.#pollTick(scope)
    }, scope.backoffMs)
  }

  /** Degraded scopes emit synthetic change notifications, then retry the subscription. */
  async #pollTick(scope: Scope): Promise<void> {
    if (!this.#running || this.#scopes.get(scope.key) !== scope) return

    if (scope.kind === 'discovery') this.#onDiscoveryChange([scope.dir], 'poll')
    else if (scope.kind === 'gitdir') this.#onGitDirChange([{ gitDir: scope.dir, shared: true }], 'poll')
    else this.#onTreeChange([scope.dir])

    try {
      await this.#subscribe(scope)
    } catch {
      scope.backoffMs = Math.min(scope.backoffMs * 2, this.#pollIntervalMs * 10)
      this.#schedulePoll(scope)
      return
    }
    if (this.#scopes.get(scope.key) !== scope) return
    scope.degraded = false
    scope.backoffMs = this.#pollIntervalMs
    this.#onDegraded?.(scope.kind, scope.dir, false)
  }
}

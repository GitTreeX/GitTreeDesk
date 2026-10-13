import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { RepoRecord, RepoStatus } from '@gitreedesk/shared'
import { type GitPool, type GitTaskPriority, readStatus } from '@gitreedesk/git-core'

export interface StatusTarget {
  repoId: string
  /** Absolute path of this checkout (native separators accepted). */
  path: string
  gitDir: string
  commonDir: string
  /** Per-repo untracked listing mode. */
  untracked?: 'no' | 'normal' | 'all'
}

/** Builds the status target of a registry record. */
export function statusTargetFor(record: RepoRecord): StatusTarget {
  return { repoId: record.id, path: record.path, gitDir: record.gitDir, commonDir: record.commonDir }
}

export type StatusReason = 'interactive' | 'event' | 'poll' | 'warmup'

export interface StatusRequestOptions {
  reason?: StatusReason
  /** Force a full read, bypassing the fingerprint cache. */
  refresh?: boolean
  signal?: AbortSignal
}

export const DEFAULT_DEBOUNCE_MS = 250

const WORKTREE_STAMPS = [
  'index',
  'HEAD',
  'ORIG_HEAD',
  'MERGE_HEAD',
  'CHERRY_PICK_HEAD',
  'REVERT_HEAD',
  'BISECT_LOG',
  'rebase-merge',
  'rebase-apply'
] as const

const COMMON_STAMPS = ['refs', 'packed-refs', join('logs', 'refs', 'stash')] as const

async function stamp(path: string): Promise<string> {
  try {
    const info = await stat(path)
    return `${String(info.mtimeMs)}:${String(info.size)}`
  } catch {
    return '-'
  }
}

/** Cheap change detector over the files that decide a status read. */
export async function statusFingerprint(target: Pick<StatusTarget, 'gitDir' | 'commonDir'>): Promise<string> {
  const stamps: string[] = []
  for (const name of WORKTREE_STAMPS) stamps.push(await stamp(join(target.gitDir, name)))
  for (const name of COMMON_STAMPS) stamps.push(await stamp(join(target.commonDir, name)))
  return stamps.join('|')
}

export interface StatusSchedulerOptions {
  pool: GitPool
  /** Receives `(key, status)` — the key is a checkout's git dir. */
  onStatus?: (key: string, status: RepoStatus) => void
  onError?: (key: string, error: unknown) => void
  debounceMs?: number
}

interface Job {
  refresh: boolean
  checkFingerprint: boolean
  priority: GitTaskPriority
  signal: AbortSignal | undefined
  resolve: (status: RepoStatus) => void
  reject: (error: unknown) => void
}

interface PendingEvent {
  promise: Promise<RepoStatus>
  resolve: (status: RepoStatus) => void
  reject: (error: unknown) => void
  timer: NodeJS.Timeout
}

interface RepoState {
  cached: { status: RepoStatus; fingerprint: string | null } | null
  queue: Job[]
  running: boolean
  event: PendingEvent | null
}

function abortError(): DOMException {
  return new DOMException('The status request was aborted', 'AbortError')
}

/**
 * Serializes status reads per repository. Event-driven requests are debounced and coalesced,
 * poll/warm-up requests skip unchanged repositories via the fingerprint, and interactive
 * requests always produce a fresh read.
 */
export class StatusScheduler {
  readonly #pool: GitPool
  readonly #onStatus: ((repoId: string, status: RepoStatus) => void) | undefined
  readonly #onError: ((repoId: string, error: unknown) => void) | undefined
  readonly #debounceMs: number
  readonly #controller = new AbortController()
  #states = new Map<string, RepoState>()
  #disposed = false

  constructor(options: StatusSchedulerOptions) {
    this.#pool = options.pool
    this.#onStatus = options.onStatus
    this.#onError = options.onError
    this.#debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS
  }

  /** `gitDir` is the checkout key shared by all scheduler entry points. */
  getCached(gitDir: string): RepoStatus | null {
    return this.#states.get(gitDir)?.cached?.status ?? null
  }

  /** Drops the cached status so the next poll performs a full read. */
  invalidate(gitDir: string): void {
    const state = this.#states.get(gitDir)
    if (state !== undefined) state.cached = null
  }

  /** Forgets a checkout entirely, cancelling any debounced request. */
  forget(gitDir: string): void {
    const state = this.#states.get(gitDir)
    if (state === undefined) return

    if (state.event !== null) {
      clearTimeout(state.event.timer)
      state.event.reject(abortError())
      state.event = null
    }
    for (const job of state.queue) job.reject(abortError())
    state.queue.length = 0
    this.#states.delete(gitDir)
  }

  request(target: StatusTarget, options: StatusRequestOptions = {}): Promise<RepoStatus> {
    if (this.#disposed) return Promise.reject(abortError())

    const reason = options.reason ?? 'interactive'
    const interactive = options.refresh === true || reason === 'interactive'
    const state = this.#state(target.gitDir)

    if (reason === 'event' && !interactive) {
      if (state.event !== null) return state.event.promise

      let resolveEvent!: (status: RepoStatus) => void
      let rejectEvent!: (error: unknown) => void
      const promise = new Promise<RepoStatus>((resolve, reject) => {
        resolveEvent = resolve
        rejectEvent = reject
      })
      const timer = setTimeout(() => {
        const pending = state.event
        state.event = null
        if (pending === null) return
        // The event itself is the change signal; the fingerprint check only serves poll loops.
        this.#enqueue(target, state, {
          refresh: false,
          checkFingerprint: false,
          priority: 'background',
          signal: undefined,
          resolve: pending.resolve,
          reject: pending.reject
        })
      }, this.#debounceMs)
      state.event = { promise, resolve: resolveEvent, reject: rejectEvent, timer }
      return promise
    }

    return new Promise<RepoStatus>((resolve, reject) => {
      this.#enqueue(target, state, {
        refresh: interactive,
        checkFingerprint: reason === 'poll' || reason === 'warmup',
        priority: interactive ? 'interactive' : 'background',
        signal: options.signal,
        resolve,
        reject
      })
    })
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#controller.abort()

    for (const state of this.#states.values()) {
      if (state.event !== null) {
        clearTimeout(state.event.timer)
        state.event.reject(abortError())
        state.event = null
      }
      for (const job of state.queue) job.reject(abortError())
      state.queue.length = 0
    }
    this.#states.clear()
  }

  #state(repoId: string): RepoState {
    let state = this.#states.get(repoId)
    if (state === undefined) {
      state = { cached: null, queue: [], running: false, event: null }
      this.#states.set(repoId, state)
    }
    return state
  }

  #enqueue(target: StatusTarget, state: RepoState, job: Job): void {
    state.queue.push(job)
    void this.#pump(target, state)
  }

  async #pump(target: StatusTarget, state: RepoState): Promise<void> {
    if (state.running) return
    state.running = true
    try {
      while (state.queue.length > 0 && !this.#disposed) {
        const job = state.queue.shift()
        if (job === undefined) break
        try {
          job.resolve(await this.#execute(target, state, job))
        } catch (error) {
          job.reject(error)
          const disposedAbort = this.#disposed && error instanceof Error && error.name === 'AbortError'
          if (!disposedAbort) this.#onError?.(target.gitDir, error)
        }
      }
    } finally {
      state.running = false
    }
  }

  async #execute(target: StatusTarget, state: RepoState, job: Job): Promise<RepoStatus> {
    if (this.#disposed) throw abortError()

    if (job.checkFingerprint && state.cached !== null && state.cached.fingerprint !== null) {
      const fingerprint = await statusFingerprint(target)
      if (fingerprint === state.cached.fingerprint) return state.cached.status
    }

    // The pre-read fingerprint is what the next poll compares against: a change during the
    // read leaves the next fingerprint different, forcing a re-read instead of a stale skip.
    const fingerprint = await statusFingerprint(target)
    const signal =
      job.signal === undefined
        ? this.#controller.signal
        : AbortSignal.any([this.#controller.signal, job.signal])

    const status = await this.#pool.run(
      (taskSignal) =>
        readStatus({
          repoPath: target.path,
          gitDir: target.gitDir,
          commonDir: target.commonDir,
          untracked: target.untracked,
          signal: taskSignal
        }),
      { priority: job.priority, signal }
    )

    state.cached = { status, fingerprint }
    this.#onStatus?.(target.gitDir, status)
    return status
  }
}

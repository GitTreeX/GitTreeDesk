import type { RepoStatusSnapshot } from '@gitreedesk/shared'

export interface StatusBatcherOptions {
  /** Coalescing window; the sustained send rate is at most one flush per interval. */
  intervalMs?: number
  onFlush: (root: string, updates: RepoStatusSnapshot[]) => void
}

const DEFAULT_INTERVAL_MS = 33

/**
 * Coalesces status refreshes into batched flushes: at most one send per interval,
 * latest status per checkout wins.
 */
export class StatusBatcher {
  readonly #intervalMs: number
  readonly #onFlush: (root: string, updates: RepoStatusSnapshot[]) => void
  readonly #pending = new Map<string, { root: string; update: RepoStatusSnapshot }>()
  #timer: NodeJS.Timeout | null = null

  constructor(options: StatusBatcherOptions) {
    this.#intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS
    this.#onFlush = options.onFlush
  }

  push(root: string, update: RepoStatusSnapshot): void {
    this.#pending.set(update.gitDir, { root, update })
    if (this.#timer !== null) return
    this.#timer = setTimeout(() => {
      this.#timer = null
      this.flush()
    }, this.#intervalMs)
  }

  flush(): void {
    if (this.#pending.size === 0) return

    const byRoot = new Map<string, RepoStatusSnapshot[]>()
    for (const { root, update } of this.#pending.values()) {
      const updates = byRoot.get(root)
      if (updates === undefined) byRoot.set(root, [update])
      else updates.push(update)
    }
    this.#pending.clear()

    for (const [root, updates] of byRoot) this.#onFlush(root, updates)
  }

  dispose(): void {
    if (this.#timer !== null) {
      clearTimeout(this.#timer)
      this.#timer = null
    }
    this.#pending.clear()
  }
}

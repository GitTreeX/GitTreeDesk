export type GitTaskPriority = 'interactive' | 'background'

interface QueuedTask {
  priority: GitTaskPriority
  start: (signal: AbortSignal) => Promise<unknown>
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
  externalSignal: AbortSignal | undefined
}

export interface GitPoolOptions {
  concurrency?: number
}

function abortError(): DOMException {
  return new DOMException('The git task was aborted', 'AbortError')
}

/**
 * Bounded-concurrency queue for git processes. Interactive work (a click in the UI)
 * jumps ahead of background refreshes, and disposal cancels everything outstanding.
 */
export class GitPool {
  readonly #concurrency: number
  readonly #interactive: QueuedTask[] = []
  readonly #background: QueuedTask[] = []
  readonly #controller = new AbortController()
  #active = 0
  #disposed = false

  constructor(options: GitPoolOptions = {}) {
    this.#concurrency = Math.max(1, options.concurrency ?? 6)
  }

  get activeCount(): number {
    return this.#active
  }

  get queuedCount(): number {
    return this.#interactive.length + this.#background.length
  }

  run<T>(
    task: (signal: AbortSignal) => Promise<T>,
    options: { priority?: GitTaskPriority; signal?: AbortSignal } = {}
  ): Promise<T> {
    if (this.#disposed) return Promise.reject(abortError())
    if (options.signal?.aborted === true) return Promise.reject(abortError())

    return new Promise<T>((resolve, reject) => {
      const entry: QueuedTask = {
        priority: options.priority ?? 'background',
        start: task as (signal: AbortSignal) => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
        externalSignal: options.signal
      }
      if (entry.priority === 'interactive') this.#interactive.push(entry)
      else this.#background.push(entry)
      this.#pump()
    })
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#controller.abort()

    for (const entry of [...this.#interactive, ...this.#background]) {
      entry.reject(abortError())
    }
    this.#interactive.length = 0
    this.#background.length = 0
  }

  #pump(): void {
    while (this.#active < this.#concurrency) {
      const entry = this.#interactive.shift() ?? this.#background.shift()
      if (entry === undefined) return

      this.#active += 1
      const signal =
        entry.externalSignal === undefined
          ? this.#controller.signal
          : AbortSignal.any([this.#controller.signal, entry.externalSignal])

      const started = (async () => entry.start(signal))()

      started
        .then(entry.resolve, entry.reject)
        .finally(() => {
          this.#active -= 1
          this.#pump()
        })
    }
  }
}

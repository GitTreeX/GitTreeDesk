import { describe, expect, it, vi } from 'vitest'
import { GitPool } from '../src/pool'

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('GitPool', () => {
  it('caps concurrency and starts queued work when a slot frees', async () => {
    const pool = new GitPool({ concurrency: 2 })
    const gate1 = deferred()
    const gate2 = deferred()
    const gate3 = deferred()
    const started: string[] = []

    const p1 = pool.run(async () => {
      started.push('a')
      await gate1.promise
    })
    const p2 = pool.run(async () => {
      started.push('b')
      await gate2.promise
    })
    const p3 = pool.run(async () => {
      started.push('c')
      await gate3.promise
    })

    expect(started).toEqual(['a', 'b'])
    expect(pool.queuedCount).toBe(1)

    gate2.resolve()
    await p2
    await vi.waitFor(() => {
      expect(started).toEqual(['a', 'b', 'c'])
    })

    gate1.resolve()
    gate3.resolve()
    await Promise.all([p1, p2, p3])
    expect(pool.activeCount).toBe(0)
  })

  it('starts interactive work before queued background work', async () => {
    const pool = new GitPool({ concurrency: 1 })
    const gate = deferred()
    const order: string[] = []

    const blocker = pool.run(async () => {
      order.push('blocker')
      await gate.promise
    })
    const background = pool.run(async () => {
      order.push('background')
    })
    const interactive = pool.run(
      async () => {
        order.push('interactive')
      },
      { priority: 'interactive' }
    )

    gate.resolve()
    await Promise.all([blocker, background, interactive])
    expect(order).toEqual(['blocker', 'interactive', 'background'])
  })

  it('rejects queued and running tasks once disposed', async () => {
    const pool = new GitPool({ concurrency: 1 })
    const running = pool.run(
      (signal) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted by pool')), { once: true })
        })
    )
    const queued = pool.run(async () => 'never')

    pool.dispose()

    await expect(queued).rejects.toThrow(/abort/i)
    await expect(running).rejects.toThrow(/abort/i)
    await expect(pool.run(async () => 1)).rejects.toThrow(/abort/i)
  })

  it('rejects immediately when the external signal is already aborted', async () => {
    const pool = new GitPool()
    const controller = new AbortController()
    controller.abort()
    await expect(pool.run(async () => 1, { signal: controller.signal })).rejects.toThrow(/abort/i)
    pool.dispose()
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RepoStatus, RepoStatusSnapshot } from '@gitreedesk/shared'
import { StatusBatcher } from '../src/main/services/status-batcher'

function status(): RepoStatus {
  return {
    head: { ref: 'main', sha: 'a'.repeat(40), detached: false, unborn: false },
    upstream: null,
    staged: [],
    unstaged: [],
    untracked: [],
    conflicted: [],
    operation: 'none',
    stashCount: 0,
    submodulesPresent: false
  }
}

function snapshot(gitDir: string): RepoStatusSnapshot {
  return { gitDir, status: status(), updatedAt: Date.now() }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('StatusBatcher', () => {
  it('coalesces pushes into one flush per interval, newest per checkout wins', () => {
    vi.useFakeTimers()
    const flushes: Array<{ root: string; updates: RepoStatusSnapshot[] }> = []
    const batcher = new StatusBatcher({
      intervalMs: 33,
      onFlush: (root, updates) => flushes.push({ root, updates })
    })

    const first = snapshot('/work/acme/.git')
    const second = snapshot('/work/acme/api/.git')
    const firstAgain = snapshot('/work/acme/.git')
    batcher.push('/work/acme', first)
    batcher.push('/work/acme', second)
    batcher.push('/work/acme', firstAgain)

    expect(flushes).toHaveLength(0)
    vi.advanceTimersByTime(33)

    expect(flushes).toHaveLength(1)
    const flush = flushes[0]
    expect(flush?.root).toBe('/work/acme')
    expect(flush?.updates).toHaveLength(2)
    const byDir = new Map(flush?.updates.map((update) => [update.gitDir, update]))
    expect(byDir.get('/work/acme/.git')).toBe(firstAgain)
    expect(byDir.get('/work/acme/api/.git')).toBe(second)
  })

  it('starts a new window for pushes arriving after a flush', () => {
    vi.useFakeTimers()
    const flushes: string[][] = []
    const batcher = new StatusBatcher({
      intervalMs: 33,
      onFlush: (_root, updates) => flushes.push(updates.map((update) => update.gitDir))
    })

    batcher.push('/root', snapshot('a'))
    vi.advanceTimersByTime(33)
    batcher.push('/root', snapshot('b'))
    vi.advanceTimersByTime(33)

    expect(flushes).toEqual([['a'], ['b']])
  })

  it('keeps roots apart across a shared window', () => {
    vi.useFakeTimers()
    const flushes: Array<{ root: string; dirs: string[] }> = []
    const batcher = new StatusBatcher({
      intervalMs: 33,
      onFlush: (root, updates) => flushes.push({ root, dirs: updates.map((update) => update.gitDir) })
    })

    batcher.push('/one', snapshot('/one/.git'))
    batcher.push('/two', snapshot('/two/.git'))
    vi.advanceTimersByTime(33)

    expect(flushes).toHaveLength(2)
    expect(flushes.every((flush) => flush.dirs.length === 1)).toBe(true)
  })

  it('dispose drops pending updates and the scheduled flush', () => {
    vi.useFakeTimers()
    const flushes: unknown[] = []
    const batcher = new StatusBatcher({ intervalMs: 33, onFlush: () => flushes.push(null) })

    batcher.push('/root', snapshot('a'))
    batcher.dispose()
    vi.advanceTimersByTime(100)

    expect(flushes).toHaveLength(0)
  })
})

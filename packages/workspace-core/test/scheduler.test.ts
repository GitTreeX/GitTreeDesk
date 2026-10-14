import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { RepoStatus } from '@gitreedesk/shared'
import { GitPool, resolveRepoDirs, runGitOrThrow } from '@gitreedesk/git-core'
import { StatusScheduler, type StatusSchedulerOptions, type StatusTarget } from '../src/scheduler'

const IDENTITY = ['-c', 'user.name=GitTreeDesk Test', '-c', 'user.email=test@gitreedesk.invalid']

let dirs: string[] = []
let pools: GitPool[] = []
let schedulers: StatusScheduler[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'gtd-sched-'))
  dirs.push(dir)
  return dir
}

function pool(): GitPool {
  const instance = new GitPool()
  pools.push(instance)
  return instance
}

function scheduler(options: Omit<StatusSchedulerOptions, 'pool'> = {}): StatusScheduler {
  const instance = new StatusScheduler({ pool: pool(), debounceMs: 20, ...options })
  schedulers.push(instance)
  return instance
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const result = await runGitOrThrow([...IDENTITY, ...args], { cwd })
  return result.stdout
}

async function repoFixture(): Promise<{ target: StatusTarget; path: string }> {
  const path = await tempDir()
  await git(path, ['init', '-q', '-b', 'main'])
  await writeFile(join(path, 'readme.md'), 'hello\n')
  await git(path, ['add', '.'])
  await git(path, ['commit', '-q', '-m', 'init'])

  const dirs = await resolveRepoDirs(path)
  return {
    target: { repoId: dirs.commonDir, path, gitDir: dirs.gitDir, commonDir: dirs.commonDir },
    path
  }
}

afterEach(async () => {
  for (const instance of schedulers) instance.dispose()
  schedulers = []
  for (const instance of pools) instance.dispose()
  pools = []
  for (const dir of dirs) await rm(dir, { recursive: true, force: true })
  dirs = []
})

describe('StatusScheduler', () => {
  it(
    'reuses the cached status for polls until something changes',
    async () => {
      const { target } = await repoFixture()
      const statuses: RepoStatus[] = []
      const s = scheduler({ onStatus: (_key, status) => statuses.push(status) })

      const first = await s.request(target, { reason: 'warmup' })
      const poll = await s.request(target, { reason: 'poll' })
      expect(poll).toBe(first)
      expect(statuses).toHaveLength(1)

      const forced = await s.request(target, { refresh: true })
      expect(forced).not.toBe(first)
      expect(statuses).toHaveLength(2)
      expect(forced.head.ref).toBe(first.head.ref)
    },
    30_000
  )

  it(
    're-reads on events even when the fingerprint is unchanged',
    async () => {
      const { target, path } = await repoFixture()
      const s = scheduler()

      const warm = await s.request(target, { reason: 'warmup' })
      expect(warm.untracked).toEqual([])

      await writeFile(join(path, 'notes.txt'), 'draft\n')

      // Untracked trees are not part of the fingerprint, so polls intentionally keep the
      // cached read; the watcher's event request is what makes the new file visible.
      const poll = await s.request(target, { reason: 'poll' })
      expect(poll).toBe(warm)

      const event = await s.request(target, { reason: 'event' })
      expect(event.untracked).toEqual(['notes.txt'])

      const after = await s.request(target, { reason: 'poll' })
      expect(after).toBe(event)

      await git(path, ['add', 'notes.txt'])
      const staged = await s.request(target, { reason: 'event' })
      expect(staged.staged.map((entry) => entry.path)).toEqual(['notes.txt'])
      expect(staged.untracked).toEqual([])
    },
    30_000
  )

  it(
    'coalesces rapid event requests into one debounced read',
    async () => {
      const { target } = await repoFixture()
      let calls = 0
      const s = scheduler({ debounceMs: 30, onStatus: () => (calls += 1) })

      const first = s.request(target, { reason: 'event' })
      const second = s.request(target, { reason: 'event' })
      expect(second).toBe(first)

      const [a, b] = await Promise.all([first, second])
      expect(b).toBe(a)
      expect(calls).toBe(1)
    },
    30_000
  )

  it(
    'rejects pending event requests when the scheduler is disposed',
    async () => {
      const { target } = await repoFixture()
      const s = scheduler({ debounceMs: 50 })

      const pending = s.request(target, { reason: 'event' })
      s.dispose()
      await expect(pending).rejects.toThrow(/abort/i)
      await expect(s.request(target)).rejects.toThrow(/abort/i)
    },
    30_000
  )

  it(
    'forget cancels a pending debounced request without breaking the scheduler',
    async () => {
      const { target } = await repoFixture()
      const s = scheduler({ debounceMs: 50 })

      const pending = s.request(target, { reason: 'event' })
      s.forget(target.gitDir)
      await expect(pending).rejects.toThrow(/abort/i)
      expect(s.getCached(target.gitDir)).toBeNull()

      const fresh = await s.request(target, { refresh: true })
      expect(fresh.untracked).toEqual([])
    },
    30_000
  )

  it(
    'reports per-read timing, marking fingerprint hits as skipped',
    async () => {
      const { target } = await repoFixture()
      const reads: { ms: number; skipped: boolean }[] = []
      const s = scheduler({ onRead: (_key, ms, skipped) => reads.push({ ms, skipped }) })

      await s.request(target, { reason: 'warmup' })
      expect(reads).toHaveLength(1)
      expect(reads[0]?.skipped).toBe(false)
      expect(reads[0]?.ms).toBeGreaterThanOrEqual(0)

      await s.request(target, { reason: 'poll' })
      expect(reads).toHaveLength(2)
      expect(reads[1]?.skipped).toBe(true)

      await s.request(target, { reason: 'event' })
      expect(reads).toHaveLength(3)
      expect(reads[2]?.skipped).toBe(false)
    },
    30_000
  )
})

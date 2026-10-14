import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RepoStatus } from '@gitreedesk/shared'
import { GitPool, runGitOrThrow } from '@gitreedesk/git-core'
import { WorkspaceSession, type WorkspaceSessionOptions } from '../src/session'
import { parcelWatchBackend } from '../src/watcher'

const IDENTITY = ['-c', 'user.name=GitTreeDesk Test', '-c', 'user.email=test@gitreedesk.invalid']

let dirs: string[] = []
let pools: GitPool[] = []
let sessions: WorkspaceSession[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'gtd-sess-'))
  dirs.push(dir)
  return dir
}

function pool(): GitPool {
  const instance = new GitPool()
  pools.push(instance)
  return instance
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const result = await runGitOrThrow([...IDENTITY, ...args], { cwd })
  return result.stdout
}

async function initRepo(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  await git(dir, ['init', '-q', '-b', 'main'])
  await git(dir, ['commit', '-q', '--allow-empty', '-m', 'init'])
}

function session(root: string, overrides: Partial<WorkspaceSessionOptions> = {}): WorkspaceSession {
  const instance = new WorkspaceSession({
    root,
    pool: pool(),
    debounceMs: 40,
    watchBackend: parcelWatchBackend,
    onError: () => undefined,
    ...overrides
  })
  sessions.push(instance)
  return instance
}

const relPaths = (instance: WorkspaceSession): string[] =>
  instance.registry.all.map((record) => record.relPath).sort()

// Aborted git processes can outlive `dispose()` by a moment on Windows; deleting the
// directory they ran in fails with EBUSY until they are gone.
async function removeDir(dir: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rm(dir, { recursive: true, force: true })
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (attempt >= 9 || (code !== 'EBUSY' && code !== 'EPERM' && code !== 'ENOTEMPTY')) throw error
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
  }
}

afterEach(async () => {
  for (const instance of sessions) await instance.close()
  sessions = []
  for (const instance of pools) instance.dispose()
  pools = []
  for (const dir of dirs) await removeDir(dir)
  dirs = []
})

describe('WorkspaceSession', () => {
  it(
    'discovers repositories created after open, including inside existing folders, and removes deleted ones',
    async () => {
      const root = await tempDir()
      await mkdir(join(root, 'group', 'team'), { recursive: true })
      const changes: { added: string[]; removed: string[] }[] = []
      const instance = session(root, {
        onReposChanged: (diff) =>
          changes.push({
            added: diff.added.map((record) => record.relPath),
            removed: diff.removed.map((record) => record.relPath)
          })
      })
      await instance.open()
      expect(relPaths(instance)).toEqual([])

      await initRepo(join(root, 'group', 'team', 'app'))
      await vi.waitFor(() => expect(relPaths(instance)).toContain('group/team/app'), {
        timeout: 30_000,
        interval: 250
      })

      await initRepo(join(root, 'solo'))
      await vi.waitFor(() => expect(relPaths(instance)).toEqual(['group/team/app', 'solo']), {
        timeout: 30_000,
        interval: 250
      })

      await removeDir(join(root, 'group'))
      await vi.waitFor(() => expect(relPaths(instance)).toEqual(['solo']), { timeout: 30_000, interval: 250 })

      await removeDir(join(root, 'solo'))
      await vi.waitFor(() => expect(relPaths(instance)).toEqual([]), { timeout: 30_000, interval: 250 })

      expect(changes.some((change) => change.added.includes('group/team/app'))).toBe(true)
      expect(changes.some((change) => change.removed.includes('group/team/app'))).toBe(true)
    },
    120_000
  )

  it(
    'attaches a linked worktree created at runtime to its repository',
    async () => {
      const root = await tempDir()
      await initRepo(join(root, 'app'))
      const instance = session(root)
      await instance.open()

      await git(join(root, 'app'), ['worktree', 'add', '-q', join(root, 'app-wt'), '-b', 'feat'])
      await vi.waitFor(() => expect(relPaths(instance)).toEqual(['app', 'app-wt']), {
        timeout: 60_000,
        interval: 250
      })

      const main = instance.registry.all.find((record) => record.relPath === 'app')
      const worktree = instance.registry.all.find((record) => record.relPath === 'app-wt')
      expect(worktree?.kind).toBe('worktree')
      expect(worktree?.id).toBe(main?.id)
      expect(worktree?.parentId).toBe(main?.id)
    },
    120_000
  )

  it(
    'refreshes status when a watched working-tree directory changes',
    async () => {
      const root = await tempDir()
      await initRepo(join(root, 'app'))
      const statuses = new Map<string, RepoStatus>()
      const instance = session(root, { onStatus: (key, status) => statuses.set(key, status) })
      await instance.open()

      const record = instance.registry.all[0]
      expect(record).toBeDefined()
      if (record === undefined) return
      await instance.warmUp()
      expect(statuses.get(record.gitDir)?.untracked).toEqual([])

      await mkdir(join(root, 'app', 'notes'), { recursive: true })
      instance.watchDirectory(join(root, 'app', 'notes'))

      let counter = 0
      await vi.waitFor(
        async () => {
          counter += 1
          await writeFile(join(root, 'app', 'notes', `draft-${counter}.txt`), 'note\n')
          const status = statuses.get(record.gitDir)
          expect(status?.untracked.some((path) => path.startsWith('notes/'))).toBe(true)
        },
        { timeout: 30_000, interval: 400 }
      )
    },
    120_000
  )

  it(
    'refreshes status when the git dir changes',
    async () => {
      const root = await tempDir()
      await initRepo(join(root, 'app'))
      const statuses = new Map<string, RepoStatus>()
      const instance = session(root, { onStatus: (key, status) => statuses.set(key, status) })
      await instance.open()

      const record = instance.registry.all[0]
      expect(record).toBeDefined()
      if (record === undefined) return
      await instance.warmUp()

      let counter = 0
      await vi.waitFor(
        async () => {
          counter += 1
          await writeFile(join(root, 'app', 'readme.md'), `change ${counter}\n`)
          await git(join(root, 'app'), ['add', 'readme.md'])
          const status = statuses.get(record.gitDir)
          expect(status?.staged.map((entry) => entry.path)).toContain('readme.md')
        },
        { timeout: 30_000, interval: 400 }
      )
    },
    120_000
  )

  it(
    'works without a watch backend through manual rescans',
    async () => {
      const root = await tempDir()
      await initRepo(join(root, 'app'))
      const instance = session(root, { watchBackend: null })
      await instance.open()
      expect(relPaths(instance)).toEqual(['app'])

      await initRepo(join(root, 'solo'))
      await instance.rescan()
      expect(relPaths(instance)).toEqual(['app', 'solo'])

      await removeDir(join(root, 'app'))
      await instance.rescan([join(root, 'app')])
      expect(relPaths(instance)).toEqual(['solo'])
    },
    60_000
  )
})

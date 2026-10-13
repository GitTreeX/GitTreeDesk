import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RepoKind, RepoRecord } from '@gitreedesk/shared'
import { defaultWorkspaceConfig } from '../src/config'
import {
  WatcherService,
  type GitDirChangeBatch,
  type WatchBackend,
  type WatchBackendOptions,
  type WatchEvent,
  type WatchScopeKind,
  type WatchSubscription
} from '../src/watcher'

class FakeBackend implements WatchBackend {
  readonly subscriptions = new Map<string, { options: WatchBackendOptions; closed: boolean }>()
  readonly failDirs = new Set<string>()
  readonly failRuntime = new Map<string, Error>()

  async subscribe(options: WatchBackendOptions): Promise<WatchSubscription> {
    if (this.failDirs.has(options.dir)) throw new Error(`subscribe failed: ${options.dir}`)
    const entry = { options, closed: false }
    this.subscriptions.set(options.dir, entry)
    return {
      close: async () => {
        entry.closed = true
        this.subscriptions.delete(options.dir)
      }
    }
  }

  emit(dir: string, events: WatchEvent[]): void {
    const entry = this.subscriptions.get(dir)
    if (entry === undefined) throw new Error(`No subscription for ${dir}`)
    entry.options.onEvents(events)
  }

  break(dir: string): void {
    const entry = this.subscriptions.get(dir)
    if (entry === undefined) throw new Error(`No subscription for ${dir}`)
    entry.options.onError(new Error(`watcher failed: ${dir}`))
  }
}

interface Recorded {
  discovery: { dirs: string[]; reason: string }[]
  gitDirs: { batches: GitDirChangeBatch[]; reason: string }[]
  tree: string[][]
  degraded: { kind: WatchScopeKind; dir: string; degraded: boolean }[]
}

let dirs: string[] = []
let services: WatcherService[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'gtd-watch-'))
  dirs.push(dir)
  return dir
}

function watcherService(
  root: string,
  overrides: Partial<ConstructorParameters<typeof WatcherService>[0]> = {}
): { backend: FakeBackend; service: WatcherService; events: Recorded } {
  const backend = new FakeBackend()
  const events: Recorded = { discovery: [], gitDirs: [], tree: [], degraded: [] }
  const service = new WatcherService({
    backend,
    root,
    config: defaultWorkspaceConfig('acme'),
    debounceMs: 20,
    onDiscoveryChange: (discoveryDirs, reason) => events.discovery.push({ dirs: discoveryDirs, reason }),
    onGitDirChange: (batches, reason) => events.gitDirs.push({ batches: [...batches], reason }),
    onTreeChange: (paths) => events.tree.push([...paths]),
    onDegraded: (kind, dir, degraded) => events.degraded.push({ kind, dir, degraded }),
    ...overrides
  })
  services.push(service)
  return { backend, service, events }
}

function repoRecord(path: string, gitDir: string, kind: RepoKind = 'repository'): RepoRecord {
  return {
    id: gitDir,
    root: '/ws',
    relPath: path.split(/[\\/]/).pop() ?? path,
    path,
    gitDir,
    commonDir: gitDir,
    kind,
    parentId: null,
    name: path.split(/[\\/]/).pop() ?? path,
    external: false,
    hasSubmodules: false
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

afterEach(async () => {
  for (const service of services) await service.stop()
  services = []
  for (const dir of dirs) await rm(dir, { recursive: true, force: true })
  dirs = []
})

describe('WatcherService', () => {
  it('collapses nested discovery candidates to the shallowest and ignores files and deep trees', async () => {
    const root = await tempDir()
    const { backend, service, events } = watcherService(root)
    await service.start()
    expect(backend.subscriptions.has(root)).toBe(true)

    await mkdir(join(root, 'group', 'app'), { recursive: true })
    await writeFile(join(root, 'note.md'), 'x\n')
    backend.emit(root, [
      { path: join(root, 'group', 'app'), kind: 'create' },
      { path: join(root, 'group'), kind: 'create' },
      { path: join(root, 'note.md'), kind: 'create' },
      { path: join(root, 'note.md'), kind: 'update' }
    ])
    await vi.waitFor(() => expect(events.discovery).toHaveLength(1))
    expect(events.discovery[0]).toEqual({ dirs: [join(root, 'group')], reason: 'event' })

    await mkdir(join(root, 'a', 'b', 'c', 'd'), { recursive: true })
    backend.emit(root, [{ path: join(root, 'a', 'b', 'c', 'd'), kind: 'create' }])
    await sleep(80)
    expect(events.discovery).toHaveLength(1)
  })

  it('treats .git markers as repository candidates and ignores internal churn', async () => {
    const root = await tempDir()
    const { backend, service, events } = watcherService(root)
    await service.start()

    await mkdir(join(root, 'app', '.git', 'objects'), { recursive: true })
    backend.emit(root, [
      { path: join(root, 'app', '.git'), kind: 'create' },
      { path: join(root, 'app', '.git', 'objects'), kind: 'create' },
      { path: join(root, 'app', '.git', 'HEAD'), kind: 'update' }
    ])
    await vi.waitFor(() => expect(events.discovery).toHaveLength(1))
    expect(events.discovery[0]?.dirs).toEqual([join(root, 'app')])
  })

  it('ignores excluded subtrees', async () => {
    const root = await tempDir()
    const config = defaultWorkspaceConfig('acme')
    config.exclude = ['vendor']
    const { backend, service, events } = watcherService(root, { config })
    await service.start()

    await mkdir(join(root, 'vendor', 'lib'), { recursive: true })
    backend.emit(root, [
      { path: join(root, 'vendor'), kind: 'create' },
      { path: join(root, 'vendor', 'lib'), kind: 'create' }
    ])
    await sleep(80)
    expect(events.discovery).toHaveLength(0)
  })

  it('routes git-dir events by interest, flags shared ref state, and skips bare repositories', async () => {
    const root = await tempDir()
    const gitDir = join(root, 'app', '.git')
    await mkdir(gitDir, { recursive: true })
    const { backend, service, events } = watcherService(root)
    await service.start()

    service.updateRepos([repoRecord(join(root, 'app'), gitDir), repoRecord(join(root, 'bare.git'), join(root, 'bare.git'), 'bare')])
    await vi.waitFor(() => expect(backend.subscriptions.has(gitDir)).toBe(true))
    expect(backend.subscriptions.get(gitDir)?.options.ignore).toContain('objects/**')
    expect(backend.subscriptions.has(join(root, 'bare.git'))).toBe(false)

    backend.emit(gitDir, [
      { path: join(gitDir, 'objects', 'ab', 'cdef'), kind: 'create' },
      { path: join(gitDir, 'index'), kind: 'update' }
    ])
    await vi.waitFor(() => expect(events.gitDirs).toHaveLength(1))
    expect(events.gitDirs[0]).toEqual({ batches: [{ gitDir, shared: false }], reason: 'event' })

    backend.emit(gitDir, [{ path: join(gitDir, 'refs', 'heads', 'main'), kind: 'update' }])
    await vi.waitFor(() => expect(events.gitDirs).toHaveLength(2))
    expect(events.gitDirs[1]).toEqual({ batches: [{ gitDir, shared: true }], reason: 'event' })

    // A record disappearing releases its subscription.
    service.updateRepos([])
    await vi.waitFor(() => expect(backend.subscriptions.has(gitDir)).toBe(false))
  })

  it('covers tree watches with a watched ancestor and evicts the least recently used', async () => {
    const root = await tempDir()
    const a = join(root, 'a')
    const b = join(root, 'b')
    const c = join(root, 'c')
    await mkdir(join(a, 'sub'), { recursive: true })
    await mkdir(b, { recursive: true })
    await mkdir(c, { recursive: true })
    const { backend, service, events } = watcherService(root, { treeWatchCap: 2 })
    await service.start()

    service.watchTree(a)
    await vi.waitFor(() => expect(backend.subscriptions.has(a)).toBe(true))

    service.watchTree(join(a, 'sub'))
    await sleep(30)
    expect(backend.subscriptions.has(join(a, 'sub'))).toBe(false)

    service.watchTree(b)
    await vi.waitFor(() => expect(backend.subscriptions.has(b)).toBe(true))
    service.watchTree(c)
    await vi.waitFor(() => expect(backend.subscriptions.has(c)).toBe(true))
    await vi.waitFor(() => expect(backend.subscriptions.has(a)).toBe(false))
    expect(backend.subscriptions.has(b)).toBe(true)

    backend.emit(b, [{ path: join(b, 'file.txt'), kind: 'create' }])
    await vi.waitFor(() => expect(events.tree).toHaveLength(1))
    expect(events.tree[0]).toEqual([join(b, 'file.txt')])

    service.unwatchTree(b)
    await vi.waitFor(() => expect(backend.subscriptions.has(b)).toBe(false))
  })

  it('degrades a failing scope to polling and recovers when the subscription succeeds again', async () => {
    const root = await tempDir()
    const gitDir = join(root, 'app', '.git')
    await mkdir(gitDir, { recursive: true })
    const { backend, service, events } = watcherService(root, { pollIntervalMs: 60 })
    await service.start()

    backend.failDirs.add(gitDir)
    service.updateRepos([repoRecord(join(root, 'app'), gitDir)])
    await vi.waitFor(() =>
      expect(events.degraded).toContainEqual({ kind: 'gitdir', dir: gitDir, degraded: true })
    )

    await vi.waitFor(() => expect(events.gitDirs.some((change) => change.reason === 'poll')).toBe(true), {
      timeout: 5000
    })
    expect(events.gitDirs.find((change) => change.reason === 'poll')?.batches).toEqual([
      { gitDir, shared: true }
    ])

    backend.failDirs.delete(gitDir)
    await vi.waitFor(
      () => expect(events.degraded).toContainEqual({ kind: 'gitdir', dir: gitDir, degraded: false }),
      { timeout: 5000 }
    )
    await vi.waitFor(() => expect(backend.subscriptions.has(gitDir)).toBe(true))
  })

  it('degrades the discovery scope to polling when the root cannot be watched', async () => {
    const root = await tempDir()
    const { backend, service, events } = watcherService(root, { pollIntervalMs: 50 })
    backend.failDirs.add(root)
    await service.start()

    await vi.waitFor(() =>
      expect(events.degraded).toContainEqual({ kind: 'discovery', dir: root, degraded: true })
    )
    await vi.waitFor(
      () => expect(events.discovery.some((change) => change.reason === 'poll' && change.dirs.includes(root))).toBe(true),
      { timeout: 5000 }
    )
  })

  it('stops cleanly, closing every subscription', async () => {
    const root = await tempDir()
    const gitDir = join(root, 'app', '.git')
    await mkdir(gitDir, { recursive: true })
    const { backend, service } = watcherService(root)
    await service.start()
    service.updateRepos([repoRecord(join(root, 'app'), gitDir)])
    service.watchTree(join(root, 'app'))
    await vi.waitFor(() => expect(backend.subscriptions.size).toBe(3))

    await service.stop()
    expect(backend.subscriptions.size).toBe(0)
  })
})

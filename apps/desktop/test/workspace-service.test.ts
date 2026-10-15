import { realpathSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { GitPool, runGitOrThrow } from '@gitreedesk/git-core'
import { ServiceError } from '../src/main/services/errors'
import { WorkspaceService, type WorkspaceServiceEvent } from '../src/main/services/workspace-service'

const IDENTITY = ['-c', 'user.name=GitTreeDesk Test', '-c', 'user.email=test@gitreedesk.invalid']

type StatusEvent = Extract<WorkspaceServiceEvent, { type: 'status' }>

const isStatus = (event: WorkspaceServiceEvent): event is StatusEvent => event.type === 'status'

// Mirrors the service, which canonicalizes with `fs.promises.realpath`: the native
// implementation, so a Windows 8.3 short temp directory comes back in its long form.
const real = (path: string): string => realpathSync.native(path).replace(/\\/g, '/')

let dirs: string[] = []
let pools: GitPool[] = []
let services: WorkspaceService[] = []
let servers: Server[] = []

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
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

async function commitAll(cwd: string, message: string): Promise<void> {
  await git(cwd, ['add', '.'])
  await git(cwd, ['commit', '-q', '-m', message])
}

async function initRepo(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  await git(dir, ['init', '-q', '-b', 'main'])
  await git(dir, ['config', 'user.name', 'GitTreeDesk Test'])
  await git(dir, ['config', 'user.email', 'test@gitreedesk.invalid'])
  await git(dir, ['commit', '-q', '--allow-empty', '-m', 'init'])
}

/** A clone of the given origin, configured with a committer identity. */
async function cloneRepo(origin: string): Promise<string> {
  const parent = await tempDir('gtd-svc-clone-')
  const clone = join(parent, 'clone')
  await git(parent, ['clone', '-q', origin, clone])
  await git(clone, ['config', 'user.name', 'GitTreeDesk Test'])
  await git(clone, ['config', 'user.email', 'test@gitreedesk.invalid'])
  return clone
}

/** Bare repository to use as an origin. */
async function bareOrigin(): Promise<string> {
  const origin = await tempDir('gtd-svc-origin-')
  await git(origin, ['init', '-q', '--bare'])
  return origin
}

function service(userDataDir: string, events: WorkspaceServiceEvent[]): WorkspaceService {
  const instance = new WorkspaceService({
    userDataDir,
    pool: pool(),
    watchBackend: null,
    emit: (event) => {
      events.push(event)
    }
  })
  services.push(instance)
  return instance
}

// Aborted git processes can outlive `dispose()` by a moment on Windows; deleting the
// directory they ran in fails with EBUSY until they are gone.
async function removeDir(dir: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rm(dir, { recursive: true, force: true })
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      const retriable = code === 'EBUSY' || code === 'EPERM' || code === 'ENOTEMPTY'
      if (!retriable || attempt >= 9) throw error
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
  }
}

afterEach(async () => {
  for (const server of servers) {
    server.closeAllConnections()
    await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()))
  }
  servers = []
  for (const instance of services) await instance.dispose()
  services = []
  for (const instance of pools) instance.dispose()
  pools = []
  const pending = dirs
  dirs = []
  for (const dir of pending) await removeDir(dir)
})

describe('WorkspaceService', () => {
  it('opens a workspace, discovers repositories and streams statuses', async () => {
    const root = await tempDir('gtd-svc-root-')
    const userData = await tempDir('gtd-svc-data-')
    await initRepo(join(root, 'api-server'))
    await initRepo(join(root, 'site'))

    const events: WorkspaceServiceEvent[] = []
    const instance = service(userData, events)

    const descriptor = await instance.open(root)
    expect(descriptor.root).toBe(real(root))
    expect(descriptor.records.map((record) => record.relPath).sort()).toEqual(['api-server', 'site'])
    expect(descriptor.trusted).toBe(false)
    expect(descriptor.stats.repos).toBe(2)

    await vi.waitFor(() => {
      expect(events.filter(isStatus).length).toBeGreaterThanOrEqual(2)
    })
    const statuses = events.filter(isStatus)
    for (const event of statuses) {
      expect(event.update.status.head.ref).toBe('main')
    }
    expect(new Set(statuses.map((event) => event.update.gitDir)).size).toBe(2)
  })

  it('returns the current state when the open root is already open', async () => {
    const root = await tempDir('gtd-svc-idem-')
    const userData = await tempDir('gtd-svc-data-')
    await initRepo(join(root, 'api-server'))

    const events: WorkspaceServiceEvent[] = []
    const instance = service(userData, events)
    await instance.open(root)
    await vi.waitFor(() => {
      expect(events.filter(isStatus)).toHaveLength(1)
    })

    const again = await instance.open(root)
    expect(again.records).toHaveLength(1)
    // The scheduler's in-memory status backs the descriptor of a repeated open.
    expect(again.statuses).toHaveLength(1)
    expect(again.statuses[0]?.status.head.ref).toBe('main')
  })

  it('paints a previously opened workspace from cache before the fresh scan lands', async () => {
    const root = await tempDir('gtd-svc-cache-')
    const userData = await tempDir('gtd-svc-data-')
    await initRepo(join(root, 'api-server'))
    await initRepo(join(root, 'site'))

    const firstEvents: WorkspaceServiceEvent[] = []
    const first = service(userData, firstEvents)
    await first.open(root)
    await vi.waitFor(() => {
      expect(firstEvents.filter(isStatus)).toHaveLength(2)
    })
    await first.dispose()

    await initRepo(join(root, 'tools'))
    const secondEvents: WorkspaceServiceEvent[] = []
    const second = service(userData, secondEvents)
    const descriptor = await second.open(root)
    // Cached records and statuses paint immediately; nothing has been scanned yet.
    expect(descriptor.records.map((record) => record.relPath).sort()).toEqual(['api-server', 'site'])
    expect(descriptor.stats.dirsScanned).toBe(0)
    expect(descriptor.statuses).toHaveLength(2)

    await vi.waitFor(() => {
      expect(
        secondEvents.some((event) => event.type === 'reposChanged' && event.stats !== undefined)
      ).toBe(true)
    }, 30_000)
    const landed = secondEvents.find((event) => event.type === 'reposChanged' && event.stats !== undefined)
    if (landed?.type !== 'reposChanged') throw new Error('the fresh scan did not land')
    expect(landed.diff.added.map((record) => record.relPath)).toEqual(['tools'])
    expect(landed.stats?.repos).toBe(3)
  })

  it('reads a fresh status by git dir and rejects unknown checkouts', async () => {
    const root = await tempDir('gtd-svc-status-')
    const userData = await tempDir('gtd-svc-data-')
    await initRepo(join(root, 'api-server'))

    const events: WorkspaceServiceEvent[] = []
    const instance = service(userData, events)
    const descriptor = await instance.open(root)
    const record = descriptor.records[0]
    expect(record).toBeDefined()

    const { status } = await instance.getStatus({ gitDir: record?.gitDir ?? '' })
    expect(status.head.ref).toBe('main')
    expect(status.operation).toBe('none')

    await expect(instance.getStatus({ gitDir: '/nowhere/.git' })).rejects.toMatchObject({
      code: 'unknown-repo'
    })
  })

  it('requires an open workspace for workspace-scoped calls', async () => {
    const userData = await tempDir('gtd-svc-data-')
    const events: WorkspaceServiceEvent[] = []
    const instance = service(userData, events)

    await expect(instance.getStatus({ gitDir: '/nowhere/.git' })).rejects.toBeInstanceOf(ServiceError)
    await expect(instance.getStatus({ gitDir: '/nowhere/.git' })).rejects.toMatchObject({
      code: 'not-open'
    })
    expect(() => instance.trustQuery()).toThrow(ServiceError)
    await expect(instance.settingsGetEffective(['theme'])).resolves.toEqual({ value: undefined })
  })

  it('rescans into new repositories, fully and scoped', async () => {
    const root = await tempDir('gtd-svc-rescan-')
    const userData = await tempDir('gtd-svc-data-')
    await initRepo(join(root, 'api-server'))

    const events: WorkspaceServiceEvent[] = []
    const instance = service(userData, events)
    await instance.open(root)

    await initRepo(join(root, 'added-after-open'))
    await instance.rescan()
    const added = events.flatMap((event) => (event.type === 'reposChanged' ? event.diff.added : []))
    expect(added.map((record) => record.relPath)).toContain('added-after-open')

    await initRepo(join(root, 'code', 'web-client'))
    await instance.rescan([join(root, 'code')])
    const scoped = events.flatMap((event) => (event.type === 'reposChanged' ? event.diff.added : []))
    expect(scoped.map((record) => record.relPath)).toContain('code/web-client')

    await expect(instance.rescan([join(root, '..')])).rejects.toMatchObject({
      code: 'outside-workspace'
    })
  })

  it('rejects watch requests outside the workspace and accepts inside ones', async () => {
    const root = await tempDir('gtd-svc-watch-')
    const userData = await tempDir('gtd-svc-data-')
    await initRepo(join(root, 'api-server'))

    const events: WorkspaceServiceEvent[] = []
    const instance = service(userData, events)
    await instance.open(root)

    await expect(instance.watchDirectory(join(root, 'api-server'))).resolves.toBeNull()
    await expect(instance.unwatchDirectory(join(root, 'api-server'))).resolves.toBeNull()
    await expect(instance.watchDirectory(root)).resolves.toBeNull()
    await expect(instance.watchDirectory(join(root, '..'))).rejects.toBeInstanceOf(ServiceError)
  })

  it('round-trips settings with workspace overriding user scope', async () => {
    const root = await tempDir('gtd-svc-settings-')
    const userData = await tempDir('gtd-svc-data-')
    await initRepo(join(root, 'api-server'))

    const events: WorkspaceServiceEvent[] = []
    const instance = service(userData, events)
    await instance.open(root)

    await instance.settingsSet({ scope: 'user', keyPath: ['editor', 'fontSize'], value: 12 })
    await expect(
      instance.settingsGet({ scope: 'user', keyPath: ['editor', 'fontSize'] })
    ).resolves.toEqual({ value: 12 })
    await expect(instance.settingsGetEffective(['editor', 'fontSize'])).resolves.toEqual({ value: 12 })

    await instance.settingsSet({ scope: 'workspace', keyPath: ['editor', 'fontSize'], value: 16 })
    await expect(instance.settingsGetEffective(['editor', 'fontSize'])).resolves.toEqual({ value: 16 })
    await expect(instance.settingsGetAll('workspace')).resolves.toEqual({
      value: { editor: { fontSize: 16 } }
    })

    const changes = events.filter((event) => event.type === 'settingsChanged')
    expect(changes).toHaveLength(2)
    expect(changes[1]).toMatchObject({
      type: 'settingsChanged',
      change: { scope: 'workspace', root: real(root), keyPath: ['editor', 'fontSize'], value: 16 }
    })

    await instance.settingsSet({ scope: 'user', keyPath: ['editor'], value: undefined })
    await expect(instance.settingsGet({ scope: 'user', keyPath: ['editor'] })).resolves.toEqual({
      value: undefined
    })
    await expect(instance.settingsGetEffective(['editor', 'fontSize'])).resolves.toEqual({ value: 16 })
  })

  it('applies untracked listing modes from settings to status reads', async () => {
    const root = await tempDir('gtd-svc-untracked-')
    const userData = await tempDir('gtd-svc-data-')
    await initRepo(join(root, 'api-server'))
    await mkdir(join(root, 'api-server', 'scratch'), { recursive: true })
    await writeFile(join(root, 'api-server', 'scratch', 'draft-a.txt'), 'a\n', 'utf8')
    await writeFile(join(root, 'api-server', 'scratch', 'draft-b.txt'), 'b\n', 'utf8')

    const events: WorkspaceServiceEvent[] = []
    const instance = service(userData, events)
    const descriptor = await instance.open(root)
    const gitDir = descriptor.records[0]?.gitDir ?? ''

    // git's default collapses untracked directories into a single entry
    const initial = await instance.getStatus({ gitDir })
    expect(initial.status.untracked).toEqual(['scratch/'])

    await instance.settingsSet({
      scope: 'workspace',
      keyPath: ['git', 'untrackedStrategy'],
      value: 'all'
    })
    await vi.waitFor(
      () => {
        expect(
          events.some(
            (event) => isStatus(event) && event.update.status.untracked.includes('scratch/draft-a.txt')
          )
        ).toBe(true)
      },
      { timeout: 5000 }
    )
    const expanded = await instance.getStatus({ gitDir })
    expect([...expanded.status.untracked].sort()).toEqual(['scratch/draft-a.txt', 'scratch/draft-b.txt'])

    await instance.settingsSet({
      scope: 'workspace',
      keyPath: ['repos', 'api-server', 'untrackedStrategy'],
      value: 'normal'
    })
    await vi.waitFor(
      () => {
        const latest = events.filter(isStatus).at(-1)
        expect(latest?.update.status.untracked).toEqual(['scratch/'])
      },
      { timeout: 5000 }
    )
  })

  it('stores keybinding overrides and streams change events', async () => {
    const root = await tempDir('gtd-svc-keybinding-')
    const userData = await tempDir('gtd-svc-data-')
    await initRepo(join(root, 'api-server'))

    const events: WorkspaceServiceEvent[] = []
    const instance = service(userData, events)
    await instance.open(root)

    await expect(instance.keybindingsGet()).resolves.toEqual({ overrides: {} })
    await instance.keybindingsSet({ command: 'view.scm', keys: 'Ctrl+Alt+S' })
    await instance.keybindingsSet({ command: 'view.terminal', keys: null })
    await expect(instance.keybindingsGet()).resolves.toEqual({
      overrides: { 'view.scm': 'Ctrl+Alt+S', 'view.terminal': null }
    })

    await instance.keybindingsReset({ command: 'view.scm' })
    await expect(instance.keybindingsGet()).resolves.toEqual({ overrides: { 'view.terminal': null } })

    expect(events.filter((event) => event.type === 'keybindingsChanged')).toEqual([
      { type: 'keybindingsChanged', change: { command: 'view.scm', keys: 'Ctrl+Alt+S' } },
      { type: 'keybindingsChanged', change: { command: 'view.terminal', keys: null } },
      { type: 'keybindingsChanged', change: { command: 'view.scm', keys: undefined } }
    ])
  })

  it('persists trust and recent workspaces across service restarts', async () => {
    const root = await tempDir('gtd-svc-trust-')
    const userData = await tempDir('gtd-svc-data-')
    await initRepo(join(root, 'api-server'))

    const firstEvents: WorkspaceServiceEvent[] = []
    const first = service(userData, firstEvents)
    await first.open(root)
    expect(first.trustQuery()).toEqual({ trusted: false })
    expect(first.trustGrant({ trusted: true })).toEqual({ trusted: true })
    await first.dispose()
    services = services.filter((entry) => entry !== first)

    const secondEvents: WorkspaceServiceEvent[] = []
    const second = service(userData, secondEvents)
    const descriptor = await second.open(root)
    expect(descriptor.trusted).toBe(true)
    expect(second.trustQuery()).toEqual({ trusted: true })

    const recent = second.recent()
    expect(recent).toHaveLength(1)
    expect(recent[0]?.root).toBe(real(root))
    expect(recent[0]?.name).toBe(root.split(/[\\/]/).pop())
    expect(recent[0]?.lastOpenedAt).toBeTypeOf('number')
  })

  it('serves cached statuses from the previous session on open', async () => {
    const root = await tempDir('gtd-svc-cache-')
    const userData = await tempDir('gtd-svc-data-')
    await initRepo(join(root, 'api-server'))
    await initRepo(join(root, 'site'))

    const firstEvents: WorkspaceServiceEvent[] = []
    const first = service(userData, firstEvents)
    await first.open(root)
    await vi.waitFor(() => {
      expect(firstEvents.filter(isStatus)).toHaveLength(2)
    })
    await first.dispose()
    services = services.filter((entry) => entry !== first)

    const secondEvents: WorkspaceServiceEvent[] = []
    const second = service(userData, secondEvents)
    const descriptor = await second.open(root)
    expect(descriptor.statuses).toHaveLength(2)
    for (const snapshot of descriptor.statuses) {
      expect(snapshot.status.head.ref).toBe('main')
      expect(snapshot.updatedAt).toBeTypeOf('number')
    }
  })

  it('lists, creates and renames entries inside the workspace', async () => {
    const root = await tempDir('gtd-svc-fs-')
    const userData = await tempDir('gtd-svc-data-')
    await initRepo(join(root, 'api-server'))
    await mkdir(join(root, 'docs'), { recursive: true })
    await writeFile(join(root, 'README.md'), '# hello')

    const events: WorkspaceServiceEvent[] = []
    const instance = service(userData, events)
    await instance.open(root)
    const base = real(root)

    const listing = await instance.readDir(base)
    const names = listing.entries.map((entry) => entry.name).sort()
    expect(names).toEqual(['README.md', 'api-server', 'docs'])
    expect(names).not.toContain('.git')
    expect(listing.entries.find((entry) => entry.name === 'docs')?.kind).toBe('dir')
    expect(listing.entries.find((entry) => entry.name === 'README.md')?.kind).toBe('file')
    expect(listing.entries.every((entry) => entry.path.startsWith(`${base}/`))).toBe(true)

    const folder = await instance.createEntry(base, 'notes', 'dir')
    expect(folder.path).toBe(`${base}/notes`)
    const file = await instance.createEntry(base, 'notes.txt', 'file')
    expect(file.path).toBe(`${base}/notes.txt`)

    await expect(instance.createEntry(base, 'notes.txt', 'file')).rejects.toMatchObject({
      code: 'exists'
    })
    await expect(instance.createEntry(base, 'notes', 'dir')).rejects.toMatchObject({ code: 'exists' })
    await expect(instance.createEntry(base, '../escape', 'file')).rejects.toMatchObject({
      code: 'invalid-name'
    })
    await expect(instance.createEntry(base, 'nested/name', 'file')).rejects.toMatchObject({
      code: 'invalid-name'
    })

    const renamed = await instance.renameEntry(`${base}/notes.txt`, 'changelog.md')
    expect(renamed.path).toBe(`${base}/changelog.md`)
    await expect(instance.renameEntry(`${base}/README.md`, 'api-server')).rejects.toMatchObject({
      code: 'exists'
    })
    await expect(instance.renameEntry(`${base}/README.md`, 'bad\\name')).rejects.toMatchObject({
      code: 'invalid-name'
    })
    await expect(instance.renameEntry(join(root, '..'), 'elsewhere')).rejects.toMatchObject({
      code: 'outside-workspace'
    })

    await expect(instance.readDir(join(root, '..'))).rejects.toMatchObject({
      code: 'outside-workspace'
    })
  })

  it('stores ui state and closes the workspace explicitly', async () => {
    const root = await tempDir('gtd-svc-ui-')
    const userData = await tempDir('gtd-svc-data-')
    await initRepo(join(root, 'api-server'))

    const events: WorkspaceServiceEvent[] = []
    const instance = service(userData, events)
    await instance.open(root)

    expect(instance.uiStateGet('explorer:expanded')).toEqual({ value: null })
    instance.uiStateSet('explorer:expanded', ['api-server'])
    expect(instance.uiStateGet('explorer:expanded')).toEqual({ value: ['api-server'] })
    expect(instance.uiStateKeys('explorer:')).toEqual({ keys: ['explorer:expanded'] })
    instance.uiStateDelete('explorer:expanded')
    expect(instance.uiStateKeys()).toEqual({ keys: [] })

    await instance.close()
    await expect(instance.getStatus({ gitDir: '/nowhere/.git' })).rejects.toMatchObject({
      code: 'not-open'
    })

    const reopened = await instance.open(root)
    expect(reopened.records).toHaveLength(1)
  })

  it('serves diff payloads, hunk staging, file history and refs', async () => {
    const root = await tempDir('gtd-svc-diff-')
    const userData = await tempDir('gtd-svc-data-')
    const repo = join(root, 'api-server')
    await initRepo(repo)
    await writeFile(join(repo, 'app.txt'), 'first\n')
    await git(repo, ['add', '.'])
    await git(repo, ['commit', '-q', '-m', 'add app'])
    await writeFile(join(repo, 'app.txt'), 'second\n')

    const events: WorkspaceServiceEvent[] = []
    const instance = service(userData, events)
    const descriptor = await instance.open(root)
    const gitDir = descriptor.records[0]?.gitDir ?? ''

    const diff = await instance.gitDiff({
      gitDir,
      path: 'app.txt',
      from: { kind: 'index' },
      to: { kind: 'worktree' }
    })
    expect(diff.kind).toBe('text')
    expect(diff.old.text).toBe('first\n')
    expect(diff.new.text).toBe('second\n')
    expect(diff.patch).toContain('-first')

    await instance.gitApplyHunk({ gitDir, patch: diff.patch, mode: 'stage' })
    expect(await git(repo, ['show', ':app.txt'])).toBe('second\n')

    const staged = await instance.gitDiff({
      gitDir,
      path: 'app.txt',
      from: { kind: 'rev', rev: 'HEAD' },
      to: { kind: 'index' }
    })
    await instance.gitApplyHunk({ gitDir, patch: staged.patch, mode: 'unstage' })
    expect(await git(repo, ['show', ':app.txt'])).toBe('first\n')

    const history = await instance.gitFileLog({ gitDir, path: 'app.txt', limit: 10 })
    expect(history.commits.map((commit) => commit.subject)).toEqual(['add app'])
    expect(history.hasMore).toBe(false)

    const refs = await instance.gitRefs({ gitDir })
    expect(refs.refs.some((ref) => ref.fullName === 'refs/heads/main')).toBe(true)

    await expect(
      instance.gitDiff({
        gitDir: '/nowhere/.git',
        path: 'app.txt',
        from: { kind: 'index' },
        to: { kind: 'worktree' }
      })
    ).rejects.toMatchObject({ code: 'unknown-repo' })
  })

  it('reads, stats and saves editor files and lists workspace files', async () => {
    const root = await tempDir('gtd-svc-editor-')
    const userData = await tempDir('gtd-svc-data-')
    await initRepo(join(root, 'api-server'))
    await writeFile(join(root, 'README.md'), '# hello')
    await mkdir(join(root, 'api-server', 'node_modules'), { recursive: true })
    await writeFile(join(root, 'api-server', 'node_modules', 'skip.js'), 'skip')

    const events: WorkspaceServiceEvent[] = []
    const instance = service(userData, events)
    await instance.open(root)
    const base = real(root)

    const read = await instance.readFileForEditor({ path: `${base}/README.md` })
    expect(read.exists).toBe(true)
    expect(read.kind).toBe('text')
    expect(read.text).toBe('# hello')
    expect(read.mtimeMs).toBeGreaterThan(0)

    const missing = await instance.readFileForEditor({ path: `${base}/gone.md` })
    expect(missing.exists).toBe(false)

    const statInfo = await instance.statPath({ path: `${base}/README.md` })
    expect(statInfo).toMatchObject({ exists: true, kind: 'file' })
    expect(await instance.statPath({ path: `${base}/gone.md` })).toMatchObject({
      exists: false,
      kind: 'missing'
    })

    const saved = await instance.writeFileForEditor({
      path: `${base}/README.md`,
      text: '# hello v2',
      expectedMtimeMs: read.mtimeMs
    })
    expect(saved.mtimeMs).toBeGreaterThanOrEqual(read.mtimeMs)
    expect(await instance.readFileForEditor({ path: `${base}/README.md` })).toMatchObject({
      text: '# hello v2'
    })

    await expect(
      instance.writeFileForEditor({
        path: `${base}/README.md`,
        text: 'stale write',
        expectedMtimeMs: read.mtimeMs
      })
    ).rejects.toMatchObject({ code: 'file-changed' })

    const created = await instance.writeFileForEditor({ path: `${base}/new-file.md`, text: 'fresh' })
    expect(created.mtimeMs).toBeGreaterThan(0)

    await expect(
      instance.writeFileForEditor({ path: join(root, '..', 'escape.md'), text: 'nope' })
    ).rejects.toMatchObject({ code: 'outside-workspace' })

    const listing = await instance.listFiles()
    expect(listing.files).toEqual(['README.md', 'new-file.md'])
    expect(listing.truncated).toBe(false)
  })
})

describe('branch operations', () => {
  it(
    'runs the branch lifecycle with backups for unmerged deletes',
    async () => {
      const root = await tempDir('gtd-svc-branch-')
      const userData = await tempDir('gtd-svc-data-')
      const repo = join(root, 'api-server')
      await initRepo(repo)
      const lines = 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\neleven\ntwelve\n'
      await writeFile(join(repo, 'a.txt'), lines)
      await commitAll(repo, 'first')

      const events: WorkspaceServiceEvent[] = []
      const instance = service(userData, events)
      const descriptor = await instance.open(root)
      const gitDir = descriptor.records[0]?.gitDir ?? ''

      const created = await instance.gitBranchCreate({ gitDir, name: 'feat', checkout: true })
      expect(created).toEqual({
        upstream: null,
        stash: { stashed: false, stashRestored: false, stashConflict: false }
      })
      expect((await git(repo, ['branch', '--show-current'])).trim()).toBe('feat')

      await instance.gitBranchRename({ gitDir, name: 'feat', newName: 'feature' })
      expect((await git(repo, ['branch', '--show-current'])).trim()).toBe('feature')

      await instance.gitBranchCheckout({ gitDir, name: 'main' })
      const merged = await instance.gitBranchDelete({ gitDir, name: 'feature' })
      expect(merged).toEqual({
        merged: true,
        backup: null,
        undo: expect.objectContaining({ op: 'branch-delete' })
      })
      expect((await git(repo, ['branch', '--list', 'feature'])).trim()).toBe('')

      // An unmerged branch requires the force confirmation and leaves a backup ref.
      await instance.gitBranchCreate({ gitDir, name: 'topic' })
      expect((await git(repo, ['branch', '--show-current'])).trim()).toBe('main')
      await instance.gitBranchCheckout({ gitDir, name: 'topic' })
      await writeFile(join(repo, 'topic.txt'), 'topic\n')
      await commitAll(repo, 'topic work')
      const topicSha = (await git(repo, ['rev-parse', 'refs/heads/topic'])).trim()
      await instance.gitBranchCheckout({ gitDir, name: 'main' })

      await expect(instance.gitBranchDelete({ gitDir, name: 'topic' })).rejects.toMatchObject({
        code: 'branch-unmerged'
      })
      expect((await git(repo, ['rev-parse', '--verify', 'refs/heads/topic'])).trim()).toBe(topicSha)

      const forced = await instance.gitBranchDelete({ gitDir, name: 'topic', force: true })
      expect(forced.merged).toBe(false)
      expect(forced.backup?.op).toBe('branch-delete')
      expect(forced.backup?.sha).toBe(topicSha)
      expect(forced.undo?.backupRef).toBe(forced.backup?.ref)
      expect((await git(repo, ['rev-parse', '--verify', forced.backup?.ref ?? ''])).trim()).toBe(topicSha)
      expect((await git(repo, ['branch', '--list', 'topic'])).trim()).toBe('')

      // Detaching at a commit leaves no branch checked out.
      await instance.gitCheckoutDetach({ gitDir, rev: 'main' })
      expect((await git(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()).toBe('HEAD')

      // Upstream wiring against an existing remote-tracking ref.
      await git(repo, ['remote', 'add', 'origin', 'https://example.invalid/acme/api-server.git'])
      await git(repo, ['update-ref', 'refs/remotes/origin/main', 'HEAD'])
      await instance.gitBranchSetUpstream({ gitDir, name: 'main', upstream: 'origin/main' })
      expect((await git(repo, ['config', '--get', 'branch.main.merge'])).trim()).toBe('refs/heads/main')
      expect((await git(repo, ['config', '--get', 'branch.main.remote'])).trim()).toBe('origin')

      const tracked = await instance.gitBranchCreate({
        gitDir,
        name: 'tracker',
        startPoint: 'main',
        checkout: true,
        upstream: 'origin/main'
      })
      expect(tracked.upstream).toBe('origin/main')
      expect((await git(repo, ['branch', '--show-current'])).trim()).toBe('tracker')
      expect((await git(repo, ['config', '--get', 'branch.tracker.merge'])).trim()).toBe('refs/heads/main')

      // A switch blocked by local changes auto-stashes around the retry and
      // restores the edit afterwards (far enough from the branch-side change
      // that the pop merges without a conflict).
      await instance.gitBranchCheckout({ gitDir, name: 'main' })
      await writeFile(join(repo, 'a.txt'), lines.replace('two', 'TWO'))
      await commitAll(repo, 'main edit')
      await instance.gitBranchCheckout({ gitDir, name: 'tracker' })
      await writeFile(join(repo, 'a.txt'), `${lines}extra\n`)
      const stashed = await instance.gitBranchCheckout({ gitDir, name: 'main' })
      expect(stashed.stash).toEqual({ stashed: true, stashRestored: true, stashConflict: false })
      expect((await readFile(join(repo, 'a.txt'), 'utf8')).replace(/\r\n/g, '\n')).toBe(
        `${lines.replace('two', 'TWO')}extra\n`
      )

      await expect(instance.gitBranchCreate({ gitDir, name: 'bad name' })).rejects.toMatchObject({
        code: 'git-failed'
      })
      await expect(instance.gitBranchCheckout({ gitDir: '/nowhere/.git', name: 'main' })).rejects.toMatchObject(
        { code: 'unknown-repo' }
      )
    },
    60_000
  )
})

describe('sync operations', () => {
  it(
    'drives remotes, fetch, pull, push and tags against a real origin',
    async () => {
      const root = await tempDir('gtd-svc-sync-')
      const userData = await tempDir('gtd-svc-data-')
      const origin = await bareOrigin()
      const repo = join(root, 'api-server')
      await initRepo(repo)
      await writeFile(join(repo, 'app.txt'), 'one\n')
      await commitAll(repo, 'first')
      await git(repo, ['remote', 'add', 'origin', origin])
      await git(repo, ['push', '-q', '-u', 'origin', 'main'])
      await git(origin, ['symbolic-ref', 'HEAD', 'refs/heads/main'])
      const site = join(root, 'site')
      await initRepo(site)

      const events: WorkspaceServiceEvent[] = []
      const instance = service(userData, events)
      const descriptor = await instance.open(root)
      const gitDir =
        descriptor.records.find((record) => record.relPath === 'api-server')?.gitDir ?? ''
      const siteGitDir = descriptor.records.find((record) => record.relPath === 'site')?.gitDir ?? ''

      const remotes = await instance.gitRemotes({ gitDir })
      expect(remotes.remotes).toEqual([{ name: 'origin', fetchUrl: origin, pushUrl: origin }])
      expect(remotes.defaultRemote).toBe('origin')

      await instance.gitRemoteAdd({ gitDir, name: 'mirror', url: 'https://example.invalid/acme/api-server.git' })
      await instance.gitRemoteSetUrl({
        gitDir,
        name: 'mirror',
        url: 'https://example.invalid/acme/api-server-mirror.git',
        push: true
      })
      const withMirror = await instance.gitRemotes({ gitDir })
      const mirror = withMirror.remotes.find((entry) => entry.name === 'mirror')
      expect(mirror?.fetchUrl).toBe('https://example.invalid/acme/api-server.git')
      expect(mirror?.pushUrl).toBe('https://example.invalid/acme/api-server-mirror.git')

      // The `git.defaultRemote` override wins when it names a real remote and
      // falls back to origin when it does not.
      await instance.settingsSet({ scope: 'user', keyPath: ['git', 'defaultRemote'], value: 'mirror' })
      expect((await instance.gitRemotes({ gitDir })).defaultRemote).toBe('mirror')
      await instance.settingsSet({ scope: 'user', keyPath: ['git', 'defaultRemote'], value: 'ghost' })
      expect((await instance.gitRemotes({ gitDir })).defaultRemote).toBe('origin')
      await instance.settingsSet({ scope: 'user', keyPath: ['git', 'defaultRemote'], value: undefined })
      await instance.gitRemoteRemove({ gitDir, name: 'mirror' })
      expect((await instance.gitRemotes({ gitDir })).remotes.map((entry) => entry.name)).toEqual(['origin'])

      // Fetch: the first run may materialize origin/HEAD; once everything is
      // known a fetch without new refs reports no update, and a pushed commit
      // flips the flag to true.
      expect((await instance.gitFetch({ gitDir })).remote).toBe('origin')
      expect((await instance.gitFetch({ gitDir })).updated).toBe(false)
      const clone = await cloneRepo(origin)
      await writeFile(join(clone, 'from-clone.txt'), 'clone work\n')
      await commitAll(clone, 'clone work')
      await git(clone, ['push', '-q', 'origin', 'main'])
      const fetched = await instance.gitFetch({ gitDir })
      expect(fetched.remote).toBe('origin')
      expect(fetched.updated).toBe(true)
      expect(fetched.output).toBeTypeOf('string')

      const pulled = await instance.gitPull({ gitDir })
      expect(pulled.updated).toBe(true)
      expect(pulled.stash).toEqual({ stashed: false, stashRestored: false, stashConflict: false })
      expect((await readFile(join(repo, 'from-clone.txt'), 'utf8')).replace(/\r\n/g, '\n')).toBe(
        'clone work\n'
      )

      // Divergence: ff-only refuses, the per-repo rebase override succeeds.
      await writeFile(join(repo, 'local.txt'), 'local\n')
      await commitAll(repo, 'local work')
      await writeFile(join(clone, 'remote2.txt'), 'remote\n')
      await commitAll(clone, 'remote work')
      await git(clone, ['push', '-q', 'origin', 'main'])
      await expect(instance.gitPull({ gitDir })).rejects.toMatchObject({ code: 'git-failed' })
      await instance.settingsSet({
        scope: 'workspace',
        keyPath: ['repos', 'api-server', 'pullStrategy'],
        value: 'rebase'
      })
      const rebased = await instance.gitPull({ gitDir })
      expect(rebased.updated).toBe(true)
      expect((await git(repo, ['log', '-1', '--format=%s'])).trim()).toBe('local work')

      // Publishing a new branch sets its upstream.
      await git(repo, ['switch', '-q', '-c', 'feat'])
      await writeFile(join(repo, 'feat.txt'), 'feat\n')
      await commitAll(repo, 'feat work')
      const pushed = await instance.gitPush({
        gitDir,
        branch: 'feat',
        remotes: ['origin'],
        upstreamRemote: 'origin'
      })
      expect(pushed.results).toEqual([
        { remote: 'origin', ok: true, output: expect.any(String), error: null }
      ])
      const featSha = (await git(repo, ['rev-parse', 'feat'])).trim()
      expect((await git(origin, ['rev-parse', '--verify', 'refs/heads/feat'])).trim()).toBe(featSha)
      expect((await git(repo, ['config', '--get', 'branch.feat.merge'])).trim()).toBe('refs/heads/feat')

      // One push can target several remotes; each reports its own result.
      const mirrorOrigin = await bareOrigin()
      await instance.gitRemoteAdd({ gitDir, name: 'mirror', url: mirrorOrigin })
      const both = await instance.gitPush({ gitDir, branch: 'feat', remotes: ['origin', 'mirror'] })
      expect(both.results.map((result) => [result.remote, result.ok])).toEqual([
        ['origin', true],
        ['mirror', true]
      ])
      expect((await git(mirrorOrigin, ['rev-parse', '--verify', 'refs/heads/feat'])).trim()).toBe(
        featSha
      )

      // A remote that rejects the push does not hide the one that accepted it.
      const scratch = await tempDir('gtd-svc-scratch-')
      await initRepo(scratch)
      await git(scratch, ['switch', '-q', '-c', 'multi'])
      await writeFile(join(scratch, 'drift.txt'), 'drift\n')
      await commitAll(scratch, 'mirror-only work')
      await git(scratch, ['push', '-q', mirrorOrigin, 'multi'])
      await git(repo, ['switch', '-q', '-c', 'multi'])
      await writeFile(join(repo, 'multi.txt'), 'multi\n')
      await commitAll(repo, 'multi work')
      const mixed = await instance.gitPush({ gitDir, branch: 'multi', remotes: ['origin', 'mirror'] })
      expect(mixed.results.map((result) => [result.remote, result.ok])).toEqual([
        ['origin', true],
        ['mirror', false]
      ])
      expect(mixed.results[1]?.error).toBeTypeOf('string')
      expect(mixed.results[1]?.output).toContain('[rejected]')
      await instance.gitRemoteRemove({ gitDir, name: 'mirror' })
      await git(repo, ['switch', '-q', 'main'])

      // Tags: annotated with push-on-create, lightweight pushed separately.
      const headSha = (await git(repo, ['rev-parse', 'HEAD'])).trim()
      const annotated = await instance.gitTagCreate({
        gitDir,
        name: 'v1.0.0',
        target: 'HEAD',
        message: 'release one',
        push: true
      })
      expect(annotated.remote).toBe('origin')
      expect((await git(repo, ['cat-file', '-t', 'v1.0.0'])).trim()).toBe('tag')
      expect((await git(origin, ['rev-parse', 'refs/tags/v1.0.0^{commit}'])).trim()).toBe(headSha)

      await instance.gitTagCreate({ gitDir, name: 'light', target: 'HEAD' })
      expect((await git(repo, ['cat-file', '-t', 'light'])).trim()).toBe('commit')

      const remoteTags = await instance.gitRemoteTags({ gitDir, remote: 'origin' })
      expect(remoteTags.remote).toBe('origin')
      expect(remoteTags.tags).toEqual([{ name: 'v1.0.0', sha: headSha }])

      const lightPushed = await instance.gitTagPush({ gitDir, name: 'light' })
      expect(lightPushed.remote).toBe('origin')
      expect((await git(origin, ['rev-parse', 'refs/tags/light'])).trim()).toBe(headSha)
      await instance.gitTagPushAll({ gitDir })
      const remoteDeleted = await instance.gitTagDeleteRemote({ gitDir, name: 'light' })
      expect(remoteDeleted.remote).toBe('origin')
      await expect(git(origin, ['rev-parse', '--verify', 'refs/tags/light'])).rejects.toThrow()
      await instance.gitTagDelete({ gitDir, name: 'light' })
      expect((await git(repo, ['tag', '--list'])).trim()).toBe('v1.0.0')

      // Comparing revisions uses rename-aware listing.
      const compared = await instance.gitDiffFiles({ gitDir, from: 'main', to: 'feat' })
      expect(compared.files).toEqual([{ path: 'feat.txt', kind: 'added' }])

      // Batch calls report per repository, including failures.
      const batch = await instance.gitFetchMany({ gitDirs: [gitDir, siteGitDir, '/nowhere/.git'] })
      expect(batch.results.map((result) => result.ok)).toEqual([true, false, false])
      expect(batch.results[0]).toMatchObject({ name: 'api-server', error: null, stash: null })
      expect(batch.results[1]?.error).toContain('No remote is configured')
      expect(batch.results[2]?.error).toContain('No checkout')

      const pullBatch = await instance.gitPullMany({ gitDirs: [gitDir] })
      expect(pullBatch.results[0]).toMatchObject({
        ok: true,
        updated: false,
        stash: { stashed: false, stashRestored: false, stashConflict: false }
      })

      await expect(instance.gitFetch({ gitDir, remote: 'missing' })).rejects.toMatchObject({
        code: 'git-failed'
      })
      await expect(instance.gitRemotes({ gitDir: '/nowhere/.git' })).rejects.toMatchObject({
        code: 'unknown-repo'
      })
    },
    120_000
  )
})

describe('network error mapping', () => {
  it(
    'classifies credential failures with a typed code and raw details',
    async () => {
      const root = await tempDir('gtd-svc-auth-')
      const userData = await tempDir('gtd-svc-data-')
      const repo = join(root, 'api-server')
      await initRepo(repo)

      const server = createServer((request, response) => {
        response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="acme"' })
        response.end('unauthorized')
      })
      servers.push(server)
      await new Promise<void>((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise))
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/acme/api-server.git`
      await git(repo, ['remote', 'add', 'secure', url])
      // An empty value resets the accumulated helper list, neutralizing machine
      // level helpers so the request fails fast instead of prompting.
      await git(repo, ['config', 'credential.helper', ''])

      const events: WorkspaceServiceEvent[] = []
      const instance = service(userData, events)
      const descriptor = await instance.open(root)
      const gitDir = descriptor.records[0]?.gitDir ?? ''

      const failure: unknown = await instance.gitFetch({ gitDir, remote: 'secure' }).catch(
        (error: unknown) => error
      )
      expect(failure).toBeInstanceOf(ServiceError)
      expect(failure).toMatchObject({
        code: 'auth-required',
        message: 'Credential required for "secure"'
      })
      expect((failure as ServiceError).details).toContain('terminal prompts disabled')

      const tagsFailure: unknown = await instance.gitRemoteTags({ gitDir, remote: 'secure' }).catch(
        (error: unknown) => error
      )
      expect(tagsFailure).toMatchObject({ code: 'auth-required' })
    },
    60_000
  )
})

describe('bare repositories', () => {
  it(
    'allows configuration but rejects working-tree operations',
    async () => {
      const root = await tempDir('gtd-svc-bare-')
      const userData = await tempDir('gtd-svc-data-')
      const bare = join(root, 'mirror.git')
      await mkdir(bare, { recursive: true })
      await git(bare, ['init', '-q', '--bare'])

      const events: WorkspaceServiceEvent[] = []
      const instance = service(userData, events)
      const descriptor = await instance.open(root)
      const record = descriptor.records.find((entry) => entry.relPath === 'mirror.git')
      expect(record?.kind).toBe('bare')
      const gitDir = record?.gitDir ?? ''

      await instance.gitRemoteAdd({
        gitDir,
        name: 'origin',
        url: 'https://example.invalid/acme/mirror.git'
      })
      expect((await instance.gitRemotes({ gitDir })).defaultRemote).toBe('origin')

      await expect(instance.gitBranchCheckout({ gitDir, name: 'main' })).rejects.toMatchObject({
        code: 'git-failed'
      })
      await expect(instance.gitPull({ gitDir })).rejects.toMatchObject({ code: 'git-failed' })
      await expect(
        instance.gitTagCreate({ gitDir, name: 'v0', target: 'HEAD' })
      ).rejects.toMatchObject({ code: 'git-failed' })
    },
    30_000
  )
})

describe('worktree operations', () => {
  it(
    'adds an in-root worktree and registers it through a scoped rescan',
    async () => {
      const root = await tempDir('gtd-svc-wt-')
      const userData = await tempDir('gtd-svc-data-')
      const repo = join(root, 'api-server')
      await initRepo(repo)

      const events: WorkspaceServiceEvent[] = []
      const instance = service(userData, events)
      const descriptor = await instance.open(root)
      const main = descriptor.records[0]
      const gitDir = main?.gitDir ?? ''

      const target = join(root, '__worktree__', 'api-server_feature')
      const created = await instance.gitWorktreeAdd({ gitDir, path: target, newBranch: 'feature/wt' })
      expect(created.path).toBe(real(target))

      const added = events.flatMap((event) => (event.type === 'reposChanged' ? event.diff.added : []))
      const record = added.find((entry) => entry.relPath === '__worktree__/api-server_feature')
      expect(record).toMatchObject({ kind: 'worktree', external: false, parentId: main?.id })

      const { worktrees } = await instance.gitWorktrees({ gitDir })
      expect(worktrees).toHaveLength(2)
      expect(worktrees.find((entry) => entry.branch === 'refs/heads/feature/wt')?.path).toBe(real(target))

      await expect(
        instance.gitWorktreeAdd({ gitDir, path: join(root, '__worktree__', 'duplicate'), branch: 'feature/wt' })
      ).rejects.toMatchObject({ code: 'branch-in-use' })
    },
    30_000
  )

  it(
    'registers an out-of-root worktree as external, refuses dirty removals and drops it after a forced one',
    async () => {
      const root = await tempDir('gtd-svc-wt-')
      const userData = await tempDir('gtd-svc-data-')
      const repo = join(root, 'api-server')
      await initRepo(repo)

      const events: WorkspaceServiceEvent[] = []
      const instance = service(userData, events)
      const descriptor = await instance.open(root)
      const gitDir = descriptor.records[0]?.gitDir ?? ''

      const outside = join(await tempDir('gtd-svc-wt-ext-'), 'linked')
      await instance.gitWorktreeAdd({ gitDir, path: outside, newBranch: 'side' })

      const added = events.flatMap((event) => (event.type === 'reposChanged' ? event.diff.added : []))
      const record = added.find((entry) => entry.external === true)
      expect(record).toMatchObject({ kind: 'worktree', path: real(outside) })
      expect(record?.relPath.startsWith('..')).toBe(true)
      expect((await git(repo, ['worktree', 'list'])).trim()).toContain('linked')

      await writeFile(join(outside, 'notes.txt'), 'wip\n')
      await expect(instance.gitWorktreeRemove({ gitDir, path: outside })).rejects.toMatchObject({
        code: 'worktree-dirty'
      })

      const removed = await instance.gitWorktreeRemove({ gitDir, path: outside, force: true })
      expect(removed.backup?.op).toBe('worktree-remove')
      expect(removed.undo).toMatchObject({ op: 'worktree-remove' })

      const dropped = events.flatMap((event) => (event.type === 'reposChanged' ? event.diff.removed : []))
      expect(dropped.map((entry) => entry.path)).toContain(record?.path)
      expect((await git(repo, ['worktree', 'list'])).trim()).not.toContain('linked')
    },
    30_000
  )

  it(
    'protects locked worktrees, removes after unlock and prunes deleted worktrees',
    async () => {
      const root = await tempDir('gtd-svc-wt-')
      const userData = await tempDir('gtd-svc-data-')
      const repo = join(root, 'api-server')
      await initRepo(repo)

      const events: WorkspaceServiceEvent[] = []
      const instance = service(userData, events)
      const descriptor = await instance.open(root)
      const gitDir = descriptor.records[0]?.gitDir ?? ''

      const target = join(root, '__worktree__', 'api-server_locked')
      await instance.gitWorktreeAdd({ gitDir, path: target, newBranch: 'locked-branch' })

      // Locking refreshes the row through a scoped rescan: the renderer learns
      // about the lock from an `updated` diff carrying the reason.
      const beforeLock = events.length
      await instance.gitWorktreeLock({ gitDir, path: target, reason: 'in use elsewhere' })
      const lockUpdated = events
        .slice(beforeLock)
        .flatMap((event) => (event.type === 'reposChanged' ? event.diff.updated : []))
      expect(lockUpdated.map((entry) => entry.path)).toEqual([real(target)])
      expect(lockUpdated[0]?.worktreeLocked).toBe('in use elsewhere')

      const locked = (await instance.gitWorktrees({ gitDir })).worktrees
      expect(locked.find((entry) => entry.path === real(target))?.locked).toBe('in use elsewhere')

      await expect(instance.gitWorktreeRemove({ gitDir, path: target })).rejects.toMatchObject({
        code: 'worktree-locked'
      })
      const beforeUnlock = events.length
      await instance.gitWorktreeUnlock({ gitDir, path: target })
      const unlockUpdated = events
        .slice(beforeUnlock)
        .flatMap((event) => (event.type === 'reposChanged' ? event.diff.updated : []))
      expect(unlockUpdated.map((entry) => entry.path)).toEqual([real(target)])
      expect(unlockUpdated[0]?.worktreeLocked).toBeNull()
      const done = await instance.gitWorktreeRemove({ gitDir, path: target })
      expect(done).toMatchObject({ backup: null, undo: { op: 'worktree-remove' } })

      // A worktree deleted behind the app's back leaves prunable metadata behind:
      // a scoped rescan keeps a row for it (no git directory) until prune drops it.
      const stale = join(root, '__worktree__', 'api-server_stale')
      await instance.gitWorktreeAdd({ gitDir, path: stale, newBranch: 'stale-branch' })
      const stalePath = real(stale)
      await removeDir(stale)
      const beforeRescan = events.length
      await instance.rescan([repo])
      const rescanned = events
        .slice(beforeRescan)
        .flatMap((event) =>
          event.type === 'reposChanged' ? [...event.diff.added, ...event.diff.updated] : []
        )
      const prunable = rescanned.find((entry) => entry.path === stalePath)
      expect(prunable).toMatchObject({
        kind: 'worktree',
        gitDir: '',
        worktreePrunable: expect.any(String)
      })
      await instance.gitWorktreePrune({ gitDir })

      const remaining = (await instance.gitWorktrees({ gitDir })).worktrees
      expect(remaining.map((entry) => entry.path)).not.toContain(stalePath)
      const dropped = events.flatMap((event) => (event.type === 'reposChanged' ? event.diff.removed : []))
      expect(dropped.map((entry) => entry.path)).toContain(stalePath)
    },
    60_000
  )
})

describe('submodule operations', () => {
  // Cloning from a local path uses the file protocol, which git blocks for
  // submodules unless it is explicitly allowed; the allowance has to live in the
  // environment because git runs in child processes.
  let previousAllow: string | undefined

  beforeAll(() => {
    previousAllow = process.env.GIT_ALLOW_PROTOCOL
    process.env.GIT_ALLOW_PROTOCOL = 'file'
  })

  afterAll(() => {
    if (previousAllow === undefined) delete process.env.GIT_ALLOW_PROTOCOL
    else process.env.GIT_ALLOW_PROTOCOL = previousAllow
  })

  it(
    'updates a drifted submodule, streams per-submodule output and syncs urls',
    async () => {
      const root = await tempDir('gtd-svc-sub-')
      const userData = await tempDir('gtd-svc-data-')
      const library = await tempDir('gtd-svc-sub-lib-')
      await git(library, ['init', '-q', '-b', 'main'])
      await writeFile(join(library, 'lib.txt'), 'lib\n')
      await commitAll(library, 'library')

      const repo = join(root, 'api-server')
      await initRepo(repo)
      await git(repo, ['submodule', 'add', '-q', library.replace(/\\/g, '/'), 'libs/core'])
      await commitAll(repo, 'add library submodule')

      const events: WorkspaceServiceEvent[] = []
      const instance = service(userData, events)
      const descriptor = await instance.open(root)
      const gitDir = descriptor.records.find((entry) => entry.relPath === 'api-server')?.gitDir ?? ''

      const initial = (await instance.gitSubmodules({ gitDir })).submodules
      expect(initial).toHaveLength(1)
      expect(initial[0]).toMatchObject({ path: 'libs/core', checkout: 'in-sync' })

      const submodule = join(repo, 'libs', 'core')
      await writeFile(join(submodule, 'extra.txt'), 'wip\n')
      await commitAll(submodule, 'drift')
      expect((await instance.gitSubmodules({ gitDir })).submodules[0]?.checkout).toBe('different')

      const update = await instance.gitSubmoduleUpdate({ gitDir, paths: ['libs/core'] })
      expect(update.results).toHaveLength(1)
      expect(update.results[0]).toMatchObject({ path: 'libs/core', ok: true, updated: true, error: null })

      const streamed = events.flatMap((event) => (event.type === 'submoduleOutput' ? [event] : []))
      expect(streamed.length).toBeGreaterThan(0)
      expect(streamed[0]).toMatchObject({ root: real(root), gitDir, path: 'libs/core' })
      expect(streamed.map((event) => event.chunk).join('')).toContain('libs/core')

      expect((await instance.gitSubmodules({ gitDir })).submodules[0]?.checkout).toBe('in-sync')

      await git(repo, ['config', 'submodule.libs/core.url', 'https://example.invalid/core.git'])
      await instance.gitSubmoduleSync({ gitDir, paths: ['libs/core'] })
      expect((await git(repo, ['config', 'submodule.libs/core.url'])).trim()).toBe(
        library.replace(/\\/g, '/')
      )
    },
    60_000
  )

  it(
    'registers a submodule checkout once it is initialized',
    async () => {
      const root = await tempDir('gtd-svc-sub-')
      const userData = await tempDir('gtd-svc-data-')
      const library = await tempDir('gtd-svc-sub-lib-')
      await git(library, ['init', '-q', '-b', 'main'])
      await writeFile(join(library, 'lib.txt'), 'lib\n')
      await commitAll(library, 'library')

      const repo = join(root, 'api-server')
      await initRepo(repo)
      await git(repo, ['submodule', 'add', '-q', library.replace(/\\/g, '/'), 'libs/core'])
      await commitAll(repo, 'add library submodule')
      await git(repo, ['submodule', 'deinit', '-f', 'libs/core'])

      const events: WorkspaceServiceEvent[] = []
      const instance = service(userData, events)
      const descriptor = await instance.open(root)
      const main = descriptor.records.find((entry) => entry.relPath === 'api-server')
      const gitDir = main?.gitDir ?? ''

      const before = (await instance.gitSubmodules({ gitDir })).submodules
      expect(before).toHaveLength(1)
      expect(before[0]?.checkout).toBe('uninitialized')

      const { results } = await instance.gitSubmoduleUpdate({ gitDir, init: true })
      expect(results).toHaveLength(1)
      expect(results[0]).toMatchObject({ path: 'libs/core', ok: true, updated: true })

      // The initialized checkout registers through a scoped rescan as a
      // repository nested under the superproject.
      const added = events.flatMap((event) => (event.type === 'reposChanged' ? event.diff.added : []))
      const child = added.find((entry) => entry.relPath === 'api-server/libs/core')
      expect(child).toMatchObject({ kind: 'repository', parentId: main?.id })
    },
    60_000
  )

  it('pages the commit graph with refs, filters and upstream marks', async () => {
    const root = await tempDir('gtd-svc-graph-')
    const userData = await tempDir('gtd-svc-data-')
    const repo = join(root, 'api-server')
    await initRepo(repo)
    await writeFile(join(repo, 'app.txt'), 'one\n')
    await commitAll(repo, 'second')
    await writeFile(join(repo, 'app.txt'), 'two\n')
    await commitAll(repo, 'third')

    const events: WorkspaceServiceEvent[] = []
    const instance = service(userData, events)
    const descriptor = await instance.open(root)
    const gitDir = descriptor.records[0]?.gitDir ?? ''

    const page = await instance.gitGraph({ gitDir, countTotal: true })
    expect(page.commits.map((commit) => commit.subject)).toEqual(['third', 'second', 'init'])
    expect(page.hasMore).toBe(false)
    expect(page.total).toBe(3)
    expect(page.refs.some((ref) => ref.fullName === 'refs/heads/main' && ref.isHead)).toBe(true)
    expect(page.upstream).toBeNull()
    expect(page.outgoing).toEqual([])
    expect(page.incoming).toEqual([])

    const limited = await instance.gitGraph({ gitDir, limit: 2, countTotal: true })
    expect(limited.commits).toHaveLength(2)
    expect(limited.hasMore).toBe(true)
    expect(limited.total).toBe(3)

    const rest = await instance.gitGraph({ gitDir, limit: 2, skip: 2 })
    expect(rest.commits.map((commit) => commit.subject)).toEqual(['init'])
    expect(rest.hasMore).toBe(false)
    expect(rest.total).toBeNull()

    const none = await instance.gitGraph({ gitDir, author: 'Nobody' })
    expect(none.commits).toEqual([])

    const head = await instance.gitGraph({ gitDir, revs: ['HEAD'] })
    expect(head.commits).toHaveLength(3)
  })

  it('reads commit details and rewrites history with a backup and undo', async () => {
    const root = await tempDir('gtd-svc-edit-')
    const userData = await tempDir('gtd-svc-data-')
    const repo = join(root, 'api-server')
    await initRepo(repo)
    await writeFile(join(repo, 'app.txt'), 'one\ntwo\n')
    await commitAll(repo, 'add app')

    const events: WorkspaceServiceEvent[] = []
    const instance = service(userData, events)
    const descriptor = await instance.open(root)
    const gitDir = descriptor.records[0]?.gitDir ?? ''
    const head = (await git(repo, ['rev-parse', 'HEAD'])).trim()

    const details = await instance.gitCommitDetails({ gitDir, sha: head })
    expect(details.commit.message).toBe('add app')
    expect(details.commit.author.name).toBe('GitTreeDesk Test')
    expect(details.commit.pushed).toBe(false)
    const stat = details.commit.files.find((file) => file.path === 'app.txt')
    expect(stat?.additions).toBe(2)
    expect(stat?.deletions).toBe(0)
    await expect(instance.gitCommitDetails({ gitDir, sha: 'deadbeef' })).rejects.toMatchObject({
      code: 'git-failed'
    })

    await expect(
      instance.gitEditCommit({ gitDir, targets: ['a', 'b'], message: 'shared' })
    ).rejects.toMatchObject({ code: 'invalid-request' })

    const result = await instance.gitEditCommit({
      gitDir,
      targets: [head],
      message: 'add app (reworded)'
    })
    expect(result.stopped).toBe(false)
    expect(result.sha).not.toBe(head)
    expect(result.backup.op).toBe('edit-commit')
    expect(result.undo.entryId).toBeGreaterThan(0)
    expect((await git(repo, ['log', '-1', '--format=%s'])).trim()).toBe('add app (reworded)')

    const oplog = await instance.gitOpLog({ gitDir })
    expect(oplog.entries[0]).toMatchObject({ op: 'edit-commit', target: 'main' })

    const backups = await instance.gitBackups({ gitDir })
    expect(backups.entries[0]).toMatchObject({ op: 'edit-commit', target: 'main' })

    // Undo through the operation log restores the pre-rewrite tip.
    await instance.gitOpLogUndo({ gitDir, entryId: result.undo.entryId })
    expect((await git(repo, ['rev-parse', 'HEAD'])).trim()).toBe(head)

    // A batch rewrite including the root applies the author to every target.
    const shas = (await git(repo, ['log', '--format=%H'])).trim().split('\n')
    const batch = await instance.gitEditCommit({
      gitDir,
      targets: [shas[1] ?? '', shas[0] ?? ''],
      authorName: 'Batch Author',
      authorEmail: 'batch@example.com'
    })
    expect(batch.stopped).toBe(false)
    expect((await git(repo, ['log', '--format=%an|%ae'])).trim().split('\n')).toEqual([
      'Batch Author|batch@example.com',
      'Batch Author|batch@example.com'
    ])
    expect((await git(repo, ['log', '--format=%s'])).trim().split('\n')).toEqual(['add app', 'init'])
  }, 60_000)
})

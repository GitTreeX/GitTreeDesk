import { realpathSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GitPool, runGitOrThrow } from '@gitreedesk/git-core'
import { ServiceError } from '../src/main/services/errors'
import { WorkspaceService, type WorkspaceServiceEvent } from '../src/main/services/workspace-service'

const IDENTITY = ['-c', 'user.name=GitTreeDesk Test', '-c', 'user.email=test@gitreedesk.invalid']

type StatusEvent = Extract<WorkspaceServiceEvent, { type: 'status' }>

const isStatus = (event: WorkspaceServiceEvent): event is StatusEvent => event.type === 'status'

const real = (path: string): string => realpathSync(path).replace(/\\/g, '/')

let dirs: string[] = []
let pools: GitPool[] = []
let services: WorkspaceService[] = []

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

async function initRepo(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  await git(dir, ['init', '-q', '-b', 'main'])
  await git(dir, ['commit', '-q', '--allow-empty', '-m', 'init'])
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

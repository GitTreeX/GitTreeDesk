import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createBackupRef, GitPool, runGitOrThrow } from '@gitreedesk/git-core'
import { WorkspaceService, type WorkspaceServiceEvent } from '../src/main/services/workspace-service'

const IDENTITY = ['-c', 'user.name=GitTreeDesk Test', '-c', 'user.email=test@gitreedesk.invalid']

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

async function commitAll(cwd: string, message: string): Promise<string> {
  await git(cwd, ['add', '.'])
  await git(cwd, ['commit', '-q', '-m', message])
  return headSha(cwd)
}

async function headSha(cwd: string): Promise<string> {
  return (await git(cwd, ['rev-parse', 'HEAD'])).trim()
}

async function initRepo(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  await git(dir, ['init', '-q', '-b', 'main'])
  await git(dir, ['config', 'user.name', 'GitTreeDesk Test'])
  await git(dir, ['config', 'user.email', 'test@gitreedesk.invalid'])
  // Keep checked-out bytes identical to the authored fixtures on any machine.
  await git(dir, ['config', 'core.autocrlf', 'false'])
  await writeFile(join(dir, 'a.txt'), 'one\n')
  await commitAll(dir, 'first')
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

interface Fixture {
  root: string
  repo: string
  gitDir: string
  events: WorkspaceServiceEvent[]
  instance: WorkspaceService
}

/** Open workspace with a single `api-server` repository. */
async function fixture(prefix: string): Promise<Fixture> {
  const root = await tempDir(prefix)
  const userData = await tempDir('gtd-ops-data-')
  const repo = join(root, 'api-server')
  await initRepo(repo)

  const events: WorkspaceServiceEvent[] = []
  const instance = service(userData, events)
  const descriptor = await instance.open(root)
  const gitDir = descriptor.records[0]?.gitDir ?? ''
  return { root, repo, gitDir, events, instance }
}

describe('merge and conflicts', () => {
  it(
    'stops on conflicts, guards other writes, resolves through the service and aborts',
    async () => {
      const { instance, repo, gitDir } = await fixture('gtd-ops-merge-')

      await git(repo, ['checkout', '-q', '-b', 'feature'])
      await writeFile(join(repo, 'a.txt'), 'feature line\n')
      await commitAll(repo, 'feature edit')
      await git(repo, ['checkout', '-q', 'main'])
      await writeFile(join(repo, 'a.txt'), 'main line\n')
      await commitAll(repo, 'main edit')

      const stopped = await instance.gitMerge({ gitDir, rev: 'feature' })
      expect(stopped.stopped).toBe(true)
      expect(stopped.output).toContain('CONFLICT')

      const { status } = await instance.getStatus({ gitDir })
      expect(status.operation).toBe('merge')
      expect(status.conflicted.map((entry) => entry.path)).toEqual(['a.txt'])

      // Other write paths refuse while the merge is stopped.
      await expect(instance.gitMerge({ gitDir, rev: 'feature' })).rejects.toMatchObject({
        code: 'operation-in-progress'
      })
      await expect(instance.gitRebase({ gitDir, onto: 'feature' })).rejects.toMatchObject({
        code: 'operation-in-progress'
      })
      await expect(instance.gitReset({ gitDir, target: 'main', mode: 'hard' })).rejects.toMatchObject(
        { code: 'operation-in-progress' }
      )
      await expect(instance.gitStashCreate({ gitDir })).rejects.toMatchObject({
        code: 'operation-in-progress'
      })
      await expect(instance.gitBranchCheckout({ gitDir, name: 'feature' })).rejects.toMatchObject({
        code: 'operation-in-progress'
      })
      await expect(instance.gitOpSkip({ gitDir })).rejects.toMatchObject({ code: 'invalid-request' })

      // Continuing while the conflict is unresolved keeps the merge stopped.
      const unresolved = await instance.gitOpContinue({ gitDir })
      expect(unresolved.stopped).toBe(true)

      await instance.gitConflictResolve({ gitDir, path: 'a.txt', resolution: 'theirs' })
      const done = await instance.gitOpContinue({ gitDir })
      expect(done.stopped).toBe(false)
      const parents = (await git(repo, ['rev-list', '--parents', '-1', 'HEAD'])).trim().split(' ')
      expect(parents).toHaveLength(3)
      expect((await instance.getStatus({ gitDir })).status.operation).toBe('none')

      // A clean checkout reports conflicted paths as not conflicted.
      await expect(
        instance.gitConflictResolve({ gitDir, path: 'a.txt', resolution: 'ours' })
      ).rejects.toMatchObject({ code: 'not-conflicted' })

      // Second round: abort restores the pre-merge state exactly.
      await git(repo, ['checkout', '-q', 'feature'])
      await writeFile(join(repo, 'a.txt'), 'feature again\n')
      await commitAll(repo, 'feature again')
      await git(repo, ['checkout', '-q', 'main'])
      await writeFile(join(repo, 'a.txt'), 'main again\n')
      const mainAgain = await commitAll(repo, 'main again')

      await instance.gitMerge({ gitDir, rev: 'feature' })
      await instance.gitOpAbort({ gitDir })
      expect(await headSha(repo)).toBe(mainAgain)
      expect((await git(repo, ['status', '--porcelain'])).trim()).toBe('')
      expect((await instance.getStatus({ gitDir })).status.operation).toBe('none')

      // With nothing in progress, continue and abort refuse.
      await expect(instance.gitOpContinue({ gitDir })).rejects.toMatchObject({ code: 'no-operation' })
      await expect(instance.gitOpAbort({ gitDir })).rejects.toMatchObject({ code: 'no-operation' })
    },
    60_000
  )
})

describe('rebase operations', () => {
  it(
    'replays onto another ref, records an undo hint and restores it',
    async () => {
      const { instance, repo, gitDir } = await fixture('gtd-ops-rebase-')

      await git(repo, ['checkout', '-q', '-b', 'feature'])
      await writeFile(join(repo, 'b.txt'), 'feature\n')
      await commitAll(repo, 'feature work')
      await git(repo, ['checkout', '-q', 'main'])
      await writeFile(join(repo, 'c.txt'), 'main\n')
      const mainSha = await commitAll(repo, 'main work')
      await git(repo, ['checkout', '-q', 'feature'])
      const featureTip = await headSha(repo)

      const result = await instance.gitRebase({ gitDir, onto: 'main' })
      expect(result.stopped).toBe(false)
      expect(result.undo?.op).toBe('rebase')
      const parents = (await git(repo, ['rev-list', '--parents', '-1', 'HEAD'])).trim().split(' ')
      expect(parents[1]).toBe(mainSha)
      expect((await git(repo, ['rev-parse', result.undo?.backupRef ?? ''])).trim()).toBe(featureTip)

      const log = instance.gitOpLog({ gitDir })
      expect(log.entries[0]).toMatchObject({
        op: 'rebase',
        target: 'feature',
        backupRef: result.undo?.backupRef
      })

      // Unknown targets fail before anything is recorded.
      await expect(instance.gitRebase({ gitDir, onto: 'no-such-ref' })).rejects.toMatchObject({
        code: 'git-failed'
      })
      expect(instance.gitOpLog({ gitDir }).entries).toHaveLength(1)

      await instance.gitOpLogUndo({ gitDir, entryId: log.entries[0]?.id ?? -1 })
      expect(await headSha(repo)).toBe(featureTip)
      expect((await git(repo, ['branch', '--show-current'])).trim()).toBe('feature')
    },
    60_000
  )

  it(
    'runs an interactive plan and undoes it through the operation log',
    async () => {
      const { instance, repo, gitDir } = await fixture('gtd-ops-rebase-i-')

      await git(repo, ['checkout', '-q', '-b', 'feature'])
      await writeFile(join(repo, 'f1.txt'), '1\n')
      await commitAll(repo, 'one')
      await writeFile(join(repo, 'f2.txt'), '2\n')
      await commitAll(repo, 'two')
      await writeFile(join(repo, 'f3.txt'), '3\n')
      await commitAll(repo, 'three')
      const tip = await headSha(repo)

      const plan = await instance.gitRebasePlan({ gitDir, base: 'main' })
      expect(plan.commits.map((commit) => commit.subject)).toEqual(['one', 'two', 'three'])

      const drop = plan.commits.find((commit) => commit.subject === 'two')
      const result = await instance.gitRebaseInteractive({
        gitDir,
        base: 'main',
        steps: [
          { sha: plan.commits[0]?.sha ?? '', action: 'pick' },
          { sha: drop?.sha ?? '', action: 'drop' },
          { sha: plan.commits[2]?.sha ?? '', action: 'pick' }
        ]
      })
      expect(result.stopped).toBe(false)
      expect((await git(repo, ['log', '--format=%s'])).trim().split('\n')).toEqual([
        'three',
        'one',
        'first'
      ])

      const log = instance.gitOpLog({ gitDir })
      expect(log.entries[0]).toMatchObject({ op: 'rebase-interactive', target: 'feature' })
      await instance.gitOpLogUndo({ gitDir, entryId: log.entries[0]?.id ?? -1 })
      expect(await headSha(repo)).toBe(tip)
    },
    60_000
  )
})

describe('cherry-pick and revert', () => {
  it(
    'picks a commit onto another branch and reverts it',
    async () => {
      const { instance, repo, gitDir } = await fixture('gtd-ops-pick-')

      await git(repo, ['checkout', '-q', '-b', 'feature'])
      await writeFile(join(repo, 'b.txt'), 'feature\n')
      const featureSha = await commitAll(repo, 'feature work')
      await git(repo, ['checkout', '-q', 'main'])
      await writeFile(join(repo, 'c.txt'), 'main side\n')
      await commitAll(repo, 'main side')

      const picked = await instance.gitCherryPick({ gitDir, revs: [featureSha] })
      expect(picked.stopped).toBe(false)
      expect(picked.undo).toBeNull()
      expect((await git(repo, ['log', '-1', '--format=%s'])).trim()).toBe('feature work')

      const reverted = await instance.gitRevert({ gitDir, revs: ['HEAD'] })
      expect(reverted.stopped).toBe(false)
      expect((await git(repo, ['log', '-1', '--format=%s'])).trim()).toBe(
        'Revert "feature work"'
      )
      await expect(readFile(join(repo, 'b.txt'), 'utf8')).rejects.toThrow()
    },
    60_000
  )

  it(
    'applies a discrete batch of revisions in the order sent',
    async () => {
      const { instance, repo, gitDir } = await fixture('gtd-ops-pick-batch-')

      await git(repo, ['checkout', '-q', '-b', 'feature'])
      await writeFile(join(repo, 'b.txt'), 'one\n')
      const first = await commitAll(repo, 'first work')
      await writeFile(join(repo, 'c.txt'), 'two\n')
      const second = await commitAll(repo, 'second work')
      await git(repo, ['checkout', '-q', 'main'])

      // Newest first, as the graph selection is; the dialog reverses it for a pick.
      const result = await instance.gitCherryPick({ gitDir, revs: [second, first] })
      expect(result.stopped).toBe(false)
      expect(
        (await git(repo, ['log', '-2', '--format=%s'])).trim().split(/\r?\n/)
      ).toEqual(['first work', 'second work'])
    },
    60_000
  )
})

describe('reset and backups', () => {
  it(
    'backs up a hard reset, undoes it, and restores the captured tip',
    async () => {
      const { instance, repo, gitDir } = await fixture('gtd-ops-reset-')

      await writeFile(join(repo, 't.txt'), 'tracked\n')
      const second = await commitAll(repo, 'second')
      const first = (await git(repo, ['rev-parse', 'HEAD~1'])).trim()

      const reset = await instance.gitReset({ gitDir, target: first, mode: 'hard' })
      expect(reset.before).toBe(second)
      expect(reset.after).toBe(first)
      expect(reset.backup?.op).toBe('reset-hard')
      expect(reset.undo?.op).toBe('reset-hard')
      expect(reset.undo?.backupRef).toBe(reset.backup?.ref)
      expect(await headSha(repo)).toBe(first)
      await expect(readFile(join(repo, 't.txt'), 'utf8')).rejects.toThrow()

      const log = instance.gitOpLog({ gitDir })
      expect(log.entries[0]).toMatchObject({ op: 'reset-hard', target: 'main' })
      expect(log.entries[0]?.backupRef).toBe(reset.backup?.ref)

      const backups = await instance.gitBackups({ gitDir })
      const entry = backups.entries.find((row) => row.op === 'reset-hard')
      expect(entry?.sha).toBe(second)
      expect(entry?.target).toBe('main')

      await instance.gitOpLogUndo({ gitDir, entryId: log.entries[0]?.id ?? -1 })
      expect(await headSha(repo)).toBe(second)
      expect(await readFile(join(repo, 't.txt'), 'utf8')).toBe('tracked\n')

      // A second hard reset, then restoring from its backup list entry.
      await instance.gitReset({ gitDir, target: first, mode: 'hard' })
      await instance.gitRestoreBackup({ gitDir, ref: entry?.ref ?? '' })
      expect(await headSha(repo)).toBe(second)
      expect(await readFile(join(repo, 't.txt'), 'utf8')).toBe('tracked\n')

      // Restoring over a different tip protects the current state with its own ref.
      const after = await instance.gitBackups({ gitDir })
      const guard = after.entries.find((row) => row.op === 'restore')
      expect(guard?.sha).toBe(first)

      await expect(
        instance.gitRestoreBackup({ gitDir, ref: 'refs/gitreedesk/backup/reset-hard/20990101-000000' })
      ).rejects.toMatchObject({ code: 'invalid-request' })
    },
    60_000
  )

  it(
    'restores a backup ref that has no operation-log row',
    async () => {
      const { instance, repo, gitDir } = await fixture('gtd-ops-orphan-backup-')

      await writeFile(join(repo, 't.txt'), 'tracked\n')
      const second = await commitAll(repo, 'second')
      const first = (await git(repo, ['rev-parse', 'HEAD~1'])).trim()
      await instance.gitReset({ gitDir, target: first, mode: 'hard' })

      // A backup ref on its own — the operation log never saw it.
      const backup = await createBackupRef({ repoPath: repo, op: 'restore', target: second })
      const backups = await instance.gitBackups({ gitDir })
      const entry = backups.entries.find((row) => row.ref === backup.ref)
      expect(entry).toMatchObject({ op: 'restore', sha: second, target: null })

      await instance.gitRestoreBackup({ gitDir, ref: backup.ref })
      expect(await headSha(repo)).toBe(second)
      expect(await readFile(join(repo, 't.txt'), 'utf8')).toBe('tracked\n')

      // Restoring from a foreign tip is destructive, so the previous state is guarded too.
      const guard = (await instance.gitBackups({ gitDir })).entries.find(
        (row) => row.op === 'restore' && row.sha === first
      )
      expect(guard).toBeDefined()
    },
    60_000
  )
})

describe('stash operations', () => {
  it(
    'creates, inspects, applies, drops and restores a stash',
    async () => {
      const { instance, repo, gitDir } = await fixture('gtd-ops-stash-')
      await writeFile(join(repo, 'a.txt'), 'changed\n')

      const created = await instance.gitStashCreate({ gitDir, message: 'wip work' })
      expect(created.created).toBe(true)
      expect((await git(repo, ['status', '--porcelain'])).trim()).toBe('')

      const list = await instance.gitStashList({ gitDir })
      expect(list.stashes).toHaveLength(1)
      expect(list.stashes[0]).toMatchObject({ selector: 'stash@{0}', branch: 'main', files: 1 })
      expect(list.stashes[0]?.subject).toContain('wip work')

      const files = await instance.gitStashFiles({ gitDir, stash: 'stash@{0}' })
      expect(files.files).toEqual([{ path: 'a.txt', kind: 'modified' }])

      const diff = await instance.gitStashDiff({ gitDir, stash: 'stash@{0}' })
      expect(diff.diff).toContain('+changed')

      const applied = await instance.gitStashApply({ gitDir, stash: 'stash@{0}' })
      expect(applied.stopped).toBe(false)
      expect(await readFile(join(repo, 'a.txt'), 'utf8')).toBe('changed\n')
      expect((await instance.gitStashList({ gitDir })).stashes).toHaveLength(1)

      // Clean the worktree so the drop is the only change, then drop it.
      await git(repo, ['checkout', '--', 'a.txt'])
      const dropped = await instance.gitStashDrop({ gitDir, stash: 'stash@{0}' })
      expect(dropped.backup?.op).toBe('stash-drop')
      expect(dropped.undo?.backupRef).toBe(dropped.backup?.ref)
      expect((await instance.gitStashList({ gitDir })).stashes).toHaveLength(0)
      await expect(instance.gitStashDrop({ gitDir, stash: 'stash@{0}' })).rejects.toMatchObject({
        code: 'invalid-request'
      })

      const backups = await instance.gitBackups({ gitDir })
      const entry = backups.entries.find((row) => row.op === 'stash-drop')
      expect(entry?.target).toContain('wip work')

      const log = instance.gitOpLog({ gitDir })
      expect(log.entries[0]).toMatchObject({ op: 'stash-drop' })
      await instance.gitOpLogUndo({ gitDir, entryId: log.entries[0]?.id ?? -1 })
      const restored = await instance.gitStashList({ gitDir })
      expect(restored.stashes).toHaveLength(1)
      expect(restored.stashes[0]?.subject).toContain('wip work')
    },
    60_000
  )
})

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createBackupRef, readBackupSha, verifyRevision } from '../src/backup'
import { resolveConflict } from '../src/conflicts'
import { mergeAbort, mergeContinue, mergeRepo } from '../src/merge'
import { cherryPick, cherryPickAction, revertCommit } from '../src/pick'
import { rebaseAction, rebaseInteractive, rebaseOnto } from '../src/rebase'
import { resetRepo } from '../src/reset'
import { runGitOrThrow } from '../src/run'
import {
  applyStash,
  createStash,
  dropStash,
  listStashes,
  popStash,
  readStashEntry
} from '../src/stashes'
import { encodeUndoState, parseUndoState, performUndo } from '../src/undo'

let dirs: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'gtd-ops-'))
  dirs.push(dir)
  return dir
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const result = await runGitOrThrow(args, { cwd })
  return result.stdout
}

async function write(cwd: string, relative: string, content: string): Promise<void> {
  const full = join(cwd, relative)
  await mkdir(dirname(full), { recursive: true })
  await writeFile(full, content, 'utf8')
}

async function initRepo(): Promise<string> {
  const dir = await tempDir()
  await git(dir, ['init', '-q', '-b', 'main'])
  await git(dir, ['config', 'user.name', 'GitTreeDesk Test'])
  await git(dir, ['config', 'user.email', 'test@gitreedesk.invalid'])
  // Keep checked-out bytes identical to the authored fixtures on any machine.
  await git(dir, ['config', 'core.autocrlf', 'false'])
  await write(dir, 'a.txt', 'one\n')
  await git(dir, ['add', '.'])
  await git(dir, ['commit', '-q', '-m', 'first'])
  return dir
}

async function headSha(cwd: string): Promise<string> {
  return (await git(cwd, ['rev-parse', 'HEAD'])).trim()
}

async function commitAll(cwd: string, message: string): Promise<string> {
  await git(cwd, ['add', '.'])
  await git(cwd, ['commit', '-q', '-m', message])
  return await headSha(cwd)
}

async function porcelain(cwd: string): Promise<string> {
  return (await git(cwd, ['status', '--porcelain'])).trim()
}

/** Repo whose main and feature edits of a.txt collide on merge. */
async function initConflict(): Promise<{ repo: string; mainSha: string; featureSha: string }> {
  const repo = await initRepo()
  await git(repo, ['checkout', '-q', '-b', 'feature'])
  await write(repo, 'a.txt', 'feature line\n')
  const featureSha = await commitAll(repo, 'feature edit')
  await git(repo, ['checkout', '-q', 'main'])
  await write(repo, 'a.txt', 'main line\n')
  const mainSha = await commitAll(repo, 'main edit')
  return { repo, mainSha, featureSha }
}

afterEach(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true })
  dirs = []
})

describe('mergeRepo', () => {
  it(
    'fast-forwards, reports up-to-date and completes a --no-ff merge',
    async () => {
      const repo = await initRepo()
      await git(repo, ['checkout', '-q', '-b', 'feature'])
      await write(repo, 'b.txt', 'feature\n')
      const featureSha = await commitAll(repo, 'feature work')
      await git(repo, ['checkout', '-q', 'main'])

      const ff = await mergeRepo(repo, { rev: 'feature' })
      expect(ff).toMatchObject({ stopped: false, fastForward: true, upToDate: false })
      expect(await headSha(repo)).toBe(featureSha)

      // Diverge again, then verify the --no-ff and up-to-date paths.
      await git(repo, ['checkout', '-q', 'feature'])
      await write(repo, 'd.txt', 'more feature\n')
      const featureSha2 = await commitAll(repo, 'more feature work')
      await git(repo, ['checkout', '-q', 'main'])
      await write(repo, 'c.txt', 'main side\n')
      const mainSha = await commitAll(repo, 'main side')

      const merge = await mergeRepo(repo, { rev: 'feature', mode: 'no-ff' })
      expect(merge).toMatchObject({ stopped: false, fastForward: false, upToDate: false })
      const parents = (await git(repo, ['rev-list', '--parents', '-1', 'HEAD'])).trim().split(' ')
      expect(parents).toHaveLength(3)
      expect(parents[1]).toBe(mainSha)
      expect(parents[2]).toBe(featureSha2)

      const again = await mergeRepo(repo, { rev: 'feature' })
      expect(again.upToDate).toBe(true)
    },
    30_000
  )

  it(
    'stops on conflicts and concludes with mergeContinue or mergeAbort',
    async () => {
      const { repo, mainSha } = await initConflict()

      const stopped = await mergeRepo(repo, { rev: 'feature' })
      expect(stopped.stopped).toBe(true)
      expect(stopped.output).toContain('CONFLICT')
      expect(await porcelain(repo)).toContain('UU a.txt')

      // Unresolved paths keep the merge stopped instead of failing mid-way.
      const unresolved = await mergeContinue(repo)
      expect(unresolved.stopped).toBe(true)

      await write(repo, 'a.txt', 'merged line\n')
      await git(repo, ['add', 'a.txt'])
      const done = await mergeContinue(repo)
      expect(done.stopped).toBe(false)
      const parents = (await git(repo, ['rev-list', '--parents', '-1', 'HEAD'])).trim().split(' ')
      expect(parents).toHaveLength(3)
      expect(parents[1]).toBe(mainSha)

      // A second conflict, aborted this time.
      await git(repo, ['checkout', '-q', 'feature'])
      await write(repo, 'a.txt', 'feature again\n')
      await commitAll(repo, 'feature edit again')
      await git(repo, ['checkout', '-q', 'main'])
      await write(repo, 'a.txt', 'main again\n')
      const mainAgain = await commitAll(repo, 'main edit again')

      const stoppedAgain = await mergeRepo(repo, { rev: 'feature' })
      expect(stoppedAgain.stopped).toBe(true)
      await mergeAbort(repo)
      expect(await headSha(repo)).toBe(mainAgain)
      expect(await porcelain(repo)).toBe('')
      expect(await readFile(join(repo, 'a.txt'), 'utf8')).toBe('main again\n')
    },
    30_000
  )
})

describe('cherryPick and revert', () => {
  it(
    'picks a commit onto another branch',
    async () => {
      const repo = await initRepo()
      await git(repo, ['checkout', '-q', '-b', 'feature'])
      await write(repo, 'b.txt', 'feature\n')
      const featureSha = await commitAll(repo, 'feature work')
      await git(repo, ['checkout', '-q', 'main'])
      await write(repo, 'c.txt', 'main side\n')
      await commitAll(repo, 'main side')

      const result = await cherryPick(repo, { rev: featureSha })
      expect(result.stopped).toBe(false)
      expect(await readFile(join(repo, 'b.txt'), 'utf8')).toBe('feature\n')
      expect((await git(repo, ['log', '-1', '--format=%s'])).trim()).toBe('feature work')
      expect(await headSha(repo)).not.toBe(featureSha)
    },
    30_000
  )

  it(
    'stages range picks, stops on the conflicting row and skips it',
    async () => {
      const { repo } = await initConflict()
      const base = (await git(repo, ['rev-parse', 'HEAD~1'])).trim()
      await git(repo, ['checkout', '-q', 'feature'])
      await write(repo, 'b.txt', 'added by second\n')
      const secondSha = await commitAll(repo, 'feature add')
      await git(repo, ['checkout', '-q', 'main'])

      const stopped = await cherryPick(repo, { rev: `${base}..${secondSha}` })
      expect(stopped.stopped).toBe(true)
      expect(await porcelain(repo)).toContain('UU a.txt')

      const skipped = await cherryPickAction('skip', repo)
      expect(skipped.stopped).toBe(false)
      expect(await readFile(join(repo, 'a.txt'), 'utf8')).toBe('main line\n')
      expect(await readFile(join(repo, 'b.txt'), 'utf8')).toBe('added by second\n')
      expect(await porcelain(repo)).toBe('')
    },
    30_000
  )

  it(
    'aborts a conflicted pick back to the pre-pick state',
    async () => {
      const { repo, featureSha } = await initConflict()
      await git(repo, ['checkout', '-q', 'feature'])

      const stopped = await cherryPick(repo, { rev: 'main' })
      expect(stopped.stopped).toBe(true)
      await cherryPickAction('abort', repo)
      expect(await headSha(repo)).toBe(featureSha)
      expect(await porcelain(repo)).toBe('')
    },
    30_000
  )

  it(
    'reverts a commit',
    async () => {
      const repo = await initRepo()
      await write(repo, 'a.txt', 'one\ntwo\n')
      const second = await commitAll(repo, 'second')

      const result = await revertCommit(repo, { rev: second })
      expect(result.stopped).toBe(false)
      expect(await readFile(join(repo, 'a.txt'), 'utf8')).toBe('one\n')
      expect((await git(repo, ['log', '-1', '--format=%s'])).trim()).toBe(
        `Revert "second"`
      )
    },
    30_000
  )
})

describe('rebaseOnto and rebaseAction', () => {
  it(
    'replays the branch and aborts a conflicted rebase',
    async () => {
      const repo = await initRepo()
      await git(repo, ['checkout', '-q', '-b', 'feature'])
      await write(repo, 'b.txt', 'feature\n')
      await commitAll(repo, 'feature work')
      await git(repo, ['checkout', '-q', 'main'])
      await write(repo, 'c.txt', 'main\n')
      const mainSha = await commitAll(repo, 'main work')
      await git(repo, ['checkout', '-q', 'feature'])

      const result = await rebaseOnto(repo, { onto: 'main' })
      expect(result.stopped).toBe(false)
      const parents = (await git(repo, ['rev-list', '--parents', '-1', 'HEAD'])).trim().split(' ')
      expect(parents[1]).toBe(mainSha)

      // Rebase the same work onto a conflicting main.
      await git(repo, ['checkout', '-q', 'main'])
      await write(repo, 'b.txt', 'main edits b\n')
      await commitAll(repo, 'main edits b')
      await git(repo, ['checkout', '-q', 'feature'])
      await write(repo, 'b.txt', 'feature edits b\n')
      const featureTip = await commitAll(repo, 'feature edits b')

      const stopped = await rebaseOnto(repo, { onto: 'main' })
      expect(stopped.stopped).toBe(true)
      await rebaseAction('abort', repo)
      expect((await git(repo, ['branch', '--show-current'])).trim()).toBe('feature')
      expect(await headSha(repo)).toBe(featureTip)
      expect(await porcelain(repo)).toBe('')
    },
    30_000
  )
})

describe('rebaseInteractive', () => {
  it(
    'applies reword and squash steps through the prepared queues',
    async () => {
      const repo = await initRepo()
      const base = await headSha(repo)
      await write(repo, 'f1.txt', '1\n')
      const c1 = await commitAll(repo, 'one')
      await write(repo, 'f2.txt', '2\n')
      const c2 = await commitAll(repo, 'two')
      await write(repo, 'f3.txt', '3\n')
      const c3 = await commitAll(repo, 'three')

      const result = await rebaseInteractive(repo, {
        base,
        steps: [
          { sha: c1, action: 'pick' },
          { sha: c2, action: 'reword', subject: 'two', message: 'two reworded' },
          { sha: c3, action: 'squash', message: 'combined three' }
        ]
      })
      expect(result.stopped).toBe(false)

      const subjects = (await git(repo, ['log', '--format=%s'])).trim().split('\n')
      expect(subjects).toEqual(['combined three', 'one', 'first'])
      expect((await git(repo, ['rev-list', '--count', 'HEAD'])).trim()).toBe('3')
      expect(await readFile(join(repo, 'f3.txt'), 'utf8')).toBe('3\n')
    },
    60_000
  )

  it(
    'drops a commit from the plan',
    async () => {
      const repo = await initRepo()
      const base = await headSha(repo)
      await write(repo, 'f1.txt', '1\n')
      const c1 = await commitAll(repo, 'one')
      await write(repo, 'f2.txt', '2\n')
      const c2 = await commitAll(repo, 'two')
      await write(repo, 'f3.txt', '3\n')
      const c3 = await commitAll(repo, 'three')

      const result = await rebaseInteractive(repo, {
        base,
        steps: [
          { sha: c1, action: 'pick' },
          { sha: c2, action: 'drop' },
          { sha: c3, action: 'pick' }
        ]
      })
      expect(result.stopped).toBe(false)
      const subjects = (await git(repo, ['log', '--format=%s'])).trim().split('\n')
      expect(subjects).toEqual(['three', 'one', 'first'])
      await expect(readFile(join(repo, 'f2.txt'), 'utf8')).rejects.toThrow()
    },
    60_000
  )
})

describe('resetRepo', () => {
  it(
    'moves the branch and the working tree per mode',
    async () => {
      const repo = await initRepo()
      const first = await headSha(repo)
      await write(repo, 't.txt', 'tracked\n')
      const second = await commitAll(repo, 'second')

      await resetRepo(repo, { target: first, mode: 'mixed' })
      expect(await headSha(repo)).toBe(first)
      expect(await readFile(join(repo, 't.txt'), 'utf8')).toBe('tracked\n')
      expect(await porcelain(repo)).toContain('?? t.txt')

      await resetRepo(repo, { target: second, mode: 'hard' })
      expect(await headSha(repo)).toBe(second)
      expect((await git(repo, ['status', '--porcelain'])).trim()).toBe('')
    },
    30_000
  )
})

describe('stash flows', () => {
  it(
    'creates, lists, applies, pops and drops',
    async () => {
      const repo = await initRepo()
      await write(repo, 'a.txt', 'changed\n')
      await write(repo, 'u.txt', 'untracked\n')

      const created = await createStash(repo, { message: 'wip work', includeUntracked: true })
      expect(created.created).toBe(true)
      expect(await readFile(join(repo, 'a.txt'), 'utf8')).toBe('one\n')
      await expect(readFile(join(repo, 'u.txt'), 'utf8')).rejects.toThrow()

      const list = await listStashes({ repoPath: repo })
      expect(list).toHaveLength(1)
      expect(list[0]).toMatchObject({ selector: 'stash@{0}', branch: 'main', files: 2 })
      expect(list[0]?.subject).toContain('wip work')

      const applied = await applyStash(repo, { stash: 'stash@{0}' })
      expect(applied.stopped).toBe(false)
      expect(await readFile(join(repo, 'a.txt'), 'utf8')).toBe('changed\n')
      expect(await listStashes({ repoPath: repo })).toHaveLength(1)

      // Clean up before the pop so it applies cleanly.
      await git(repo, ['checkout', '--', 'a.txt'])
      await rm(join(repo, 'u.txt'), { force: true })

      const popped = await popStash(repo, { stash: 'stash@{0}' })
      expect(popped.stopped).toBe(false)
      expect(await listStashes({ repoPath: repo })).toHaveLength(0)
      expect(await readFile(join(repo, 'a.txt'), 'utf8')).toBe('changed\n')

      // Drop path: stash again, then drop the entry.
      const again = await createStash(repo, { message: 'to drop', includeUntracked: true })
      expect(again.created).toBe(true)
      await dropStash(repo, { stash: 'stash@{0}' })
      expect(await listStashes({ repoPath: repo })).toHaveLength(0)
    },
    30_000
  )

  it(
    'limits a stash to the given paths',
    async () => {
      const repo = await initRepo()
      await write(repo, 'b.txt', 'b\n')
      await commitAll(repo, 'add b')
      await write(repo, 'a.txt', 'changed a\n')
      await write(repo, 'b.txt', 'changed b\n')

      const created = await createStash(repo, { paths: ['b.txt'] })
      expect(created.created).toBe(true)
      expect(await readFile(join(repo, 'a.txt'), 'utf8')).toBe('changed a\n')
      expect(await readFile(join(repo, 'b.txt'), 'utf8')).toBe('b\n')
      const list = await listStashes({ repoPath: repo })
      expect(list[0]?.files).toBe(1)
    },
    30_000
  )

  it(
    'keeps the entry when a pop conflicts',
    async () => {
      const repo = await initRepo()
      await write(repo, 'a.txt', 'stashed\n')
      await createStash(repo, { message: 'conflicting' })
      // Move the base so applying the stash collides on the same lines.
      await write(repo, 'a.txt', 'main moved\n')
      await commitAll(repo, 'main moved')

      const popped = await popStash(repo, { stash: 'stash@{0}' })
      expect(popped.stopped).toBe(true)
      expect(await porcelain(repo)).toContain('UU a.txt')
      expect(await listStashes({ repoPath: repo })).toHaveLength(1)
    },
    30_000
  )
})

describe('resolveConflict', () => {
  it(
    'resolves a modify/modify conflict onto ours or theirs',
    async () => {
      const { repo } = await initConflict()
      const stopped = await mergeRepo(repo, { rev: 'feature' })
      expect(stopped.stopped).toBe(true)

      await resolveConflict(repo, { path: 'a.txt', code: 'UU', resolution: 'ours' })
      expect(await readFile(join(repo, 'a.txt'), 'utf8')).toBe('main line\n')
      // Ours equals the merge target here, so the index matches HEAD again.
      expect(await porcelain(repo)).toBe('')
    },
    30_000
  )

  it(
    'union-merges both sides of a text conflict',
    async () => {
      const { repo } = await initConflict()
      await mergeRepo(repo, { rev: 'feature' })

      await resolveConflict(repo, { path: 'a.txt', code: 'UU', resolution: 'both' })
      expect(await readFile(join(repo, 'a.txt'), 'utf8')).toBe('main line\nfeature line\n')
      expect(await porcelain(repo)).toBe('M  a.txt')
    },
    30_000
  )

  it(
    'resolves a modify/delete conflict onto the deleted side',
    async () => {
      const repo = await initRepo()
      await git(repo, ['checkout', '-q', '-b', 'feature'])
      await git(repo, ['rm', '-q', 'a.txt'])
      await commitAll(repo, 'delete a')
      await git(repo, ['checkout', '-q', 'main'])
      await write(repo, 'a.txt', 'main change\n')
      await commitAll(repo, 'main change')

      const stopped = await mergeRepo(repo, { rev: 'feature' })
      expect(stopped.stopped).toBe(true)
      expect(await porcelain(repo)).toContain('UD a.txt')

      await resolveConflict(repo, { path: 'a.txt', code: 'UD', resolution: 'theirs' })
      expect(await porcelain(repo)).toBe('D  a.txt')
      await expect(readFile(join(repo, 'a.txt'), 'utf8')).rejects.toThrow()
    },
    30_000
  )
})

describe('performUndo', () => {
  it('round-trips descriptors through encode and parse', () => {
    const descriptor = { kind: 'reset', mode: 'hard', before: 'abc', target: 'main' } as const
    expect(parseUndoState(encodeUndoState(descriptor))).toEqual(descriptor)
    expect(parseUndoState(null)).toBeNull()
    expect(parseUndoState('not json')).toBeNull()
    expect(parseUndoState('{"kind":"unknown"}')).toBeNull()
  })

  it(
    'restores a hard reset',
    async () => {
      const repo = await initRepo()
      const first = await headSha(repo)
      await write(repo, 't.txt', 'tracked\n')
      const second = await commitAll(repo, 'second')

      await resetRepo(repo, { target: first, mode: 'hard' })
      expect(await headSha(repo)).toBe(first)

      await performUndo(repo, { descriptor: { kind: 'reset', mode: 'hard', before: second } })
      expect(await headSha(repo)).toBe(second)
      expect(await readFile(join(repo, 't.txt'), 'utf8')).toBe('tracked\n')
    },
    30_000
  )

  it(
    'recreates a dropped stash and a deleted branch',
    async () => {
      const repo = await initRepo()
      await write(repo, 'a.txt', 'stashed\n')
      await createStash(repo, { message: 'to undo' })
      const entry = await readStashEntry(repo, { stash: 'stash@{0}' })
      expect(entry).not.toBeNull()
      await dropStash(repo, { stash: 'stash@{0}' })
      expect(await listStashes({ repoPath: repo })).toHaveLength(0)

      await performUndo(repo, {
        descriptor: { kind: 'stash-drop', before: entry?.sha, subject: entry?.subject }
      })
      const restored = await listStashes({ repoPath: repo })
      expect(restored).toHaveLength(1)
      expect(restored[0]?.subject).toContain('to undo')

      const tip = await headSha(repo)
      await git(repo, ['branch', 'topic'])
      await git(repo, ['branch', '-D', 'topic'])
      await performUndo(repo, { descriptor: { kind: 'branch-delete', name: 'topic', before: tip } })
      expect((await git(repo, ['rev-parse', 'topic'])).trim()).toBe(tip)
    },
    30_000
  )
})

describe('backup refs', () => {
  it(
    'verifies revisions and reads backup tips',
    async () => {
      const repo = await initRepo()
      const head = await headSha(repo)

      expect(await verifyRevision(repo, 'main')).toBe(head)
      await expect(verifyRevision(repo, 'nope')).rejects.toThrow()

      const backup = await createBackupRef({ repoPath: repo, op: 'reset-hard', target: 'HEAD' })
      expect(backup.sha).toBe(head)
      expect(await readBackupSha(repo, backup.ref)).toBe(head)
      expect(await readBackupSha(repo, 'refs/heads/main')).toBeNull()
      expect(await readBackupSha(repo, 'refs/gitreedesk/backup/reset-hard/20990101-000000')).toBeNull()
    },
    30_000
  )
})

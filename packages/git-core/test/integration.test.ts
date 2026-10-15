import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createBackupRef, listBackupRefs, BACKUP_REF_PREFIX } from '../src/backup'
import { logCommits } from '../src/log'
import { listRefs } from '../src/refs'
import { resolveRepoDirs } from '../src/repo'
import { runGitOrThrow } from '../src/run'
import { discardWorktreePaths, stageAll, stagePaths, unstageAll, unstagePaths } from '../src/staging'
import { listStashes } from '../src/stashes'
import { readStatus } from '../src/status'
import { listSubmodules } from '../src/submodules'
import { probeGitVersion } from '../src/version'
import { listWorktrees } from '../src/worktrees'

const IDENTITY = ['-c', 'user.name=GitTreeDesk Test', '-c', 'user.email=test@gitreedesk.invalid']

let dirs: string[] = []

/**
 * The temp directory is canonicalized first: macOS hands out `/var/...` while git
 * reports `/private/var/...`, so `--show-toplevel` would otherwise never compare equal.
 */
async function tempDir(): Promise<string> {
  const base = await realpath(tmpdir()).catch(() => tmpdir())
  const dir = await mkdtemp(join(base, 'gtd-int-'))
  dirs.push(dir)
  return dir
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const result = await runGitOrThrow([...IDENTITY, ...args], { cwd })
  return result.stdout
}

async function initRepo(): Promise<string> {
  const dir = await tempDir()
  await git(dir, ['init', '-q', '-b', 'main'])
  return dir
}

async function commit(cwd: string, message: string): Promise<void> {
  await git(cwd, ['commit', '-q', '--allow-empty', '-m', message])
}

async function write(cwd: string, relative: string, content: string): Promise<void> {
  const full = join(cwd, relative)
  await mkdir(dirname(full), { recursive: true })
  await writeFile(full, content, 'utf8')
}

const sha40 = /^[0-9a-f]{40}$/

afterEach(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true })
  dirs = []
})

describe('status against a real repository', () => {
  it(
    'reads a staged rename with CJK paths and untracked files',
    async () => {
      const repo = await initRepo()
      await write(repo, 'content/中文 文档/笔记.md', 'hello\n')
      await git(repo, ['add', '.'])
      await commit(repo, 'initial')
      await git(repo, ['mv', 'content/中文 文档/笔记.md', 'content/中文 文档/新 笔记.md'])
      await write(repo, 'notes/草稿.txt', 'draft\n')

      const status = await readStatus({ repoPath: repo })
      expect(status.head.ref).toBe('main')
      expect(status.head.unborn).toBe(false)
      expect(status.staged).toEqual([
        { path: 'content/中文 文档/新 笔记.md', origPath: 'content/中文 文档/笔记.md', kind: 'renamed' }
      ])
      expect(status.untracked).toEqual(['notes/'])
      expect(status.operation).toBe('none')
      expect(status.stashCount).toBe(0)
      expect(status.submodulesPresent).toBe(false)

      // The default `normal` mode reports a directory; file-level listing needs `all`.
      const verbose = await readStatus({ repoPath: repo, untracked: 'all' })
      expect(verbose.untracked).toEqual(['notes/草稿.txt'])
    },
    30_000
  )

  it(
    'reports unstaged modifications and an unborn head',
    async () => {
      const fresh = await initRepo()
      const unborn = await readStatus({ repoPath: fresh })
      expect(unborn.head.unborn).toBe(true)
      expect(unborn.head.sha).toBeNull()

      await write(fresh, 'app.txt', 'one\n')
      await git(fresh, ['add', '.'])
      await commit(fresh, 'first')
      await write(fresh, 'app.txt', 'two\n')

      const status = await readStatus({ repoPath: fresh })
      expect(status.unstaged).toEqual([{ path: 'app.txt', kind: 'modified' }])
      expect(status.staged).toEqual([])
    },
    30_000
  )
})

describe('refs against a real repository', () => {
  it(
    'lists branches, tags and ahead/behind against a remote',
    async () => {
      const repo = await initRepo()
      await write(repo, 'a.txt', 'a\n')
      await git(repo, ['add', '.'])
      await commit(repo, 'first')

      const remote = await tempDir()
      await git(remote, ['init', '-q', '--bare'])
      await git(repo, ['remote', 'add', 'origin', remote.replace(/\\/g, '/')])
      await git(repo, ['push', '-q', '-u', 'origin', 'main'])
      await git(repo, ['branch', 'feat'])
      await git(repo, ['tag', 'v0.1.0'])
      await git(repo, ['tag', '-a', 'v0.2.0', '-m', 'release 0.2.0'])
      await write(repo, 'b.txt', 'b\n')
      await git(repo, ['add', '.'])
      await commit(repo, 'second')
      await git(repo, ['remote', 'set-head', 'origin', 'main'])

      const refs = await listRefs({ repoPath: repo })
      const main = refs.find((ref) => ref.fullName === 'refs/heads/main')
      expect(main?.isHead).toBe(true)
      expect(main?.upstream).toBe('origin/main')
      expect(main?.ahead).toBe(1)
      expect(main?.behind).toBe(0)
      expect(main?.subject).toBe('second')

      expect(refs.some((ref) => ref.fullName === 'refs/heads/feat')).toBe(true)
      expect(refs.some((ref) => ref.fullName === 'refs/remotes/origin/HEAD')).toBe(false)

      const light = refs.find((ref) => ref.fullName === 'refs/tags/v0.1.0')
      const annotated = refs.find((ref) => ref.fullName === 'refs/tags/v0.2.0')
      expect(light?.kind).toBe('tag')
      expect(light?.sha).toBe(annotated?.sha)
      expect(light?.sha).not.toBe(main?.sha)
    },
    60_000
  )
})

describe('log against a real repository', () => {
  it(
    'pages commits and reports hasMore',
    async () => {
      const repo = await initRepo()
      await commit(repo, 'first')
      await commit(repo, 'second')
      await write(repo, 'x.txt', 'x\n')
      await git(repo, ['add', '.'])
      await commit(repo, 'third')

      const page1 = await logCommits({ repoPath: repo, maxCount: 2 })
      expect(page1.commits.map((entry) => entry.subject)).toEqual(['third', 'second'])
      expect(page1.hasMore).toBe(true)
      expect(page1.commits[0]?.refs).toContain('main')
      expect(page1.commits[0]?.sha).toMatch(sha40)

      const page2 = await logCommits({ repoPath: repo, maxCount: 2, skip: 2 })
      expect(page2.commits.map((entry) => entry.subject)).toEqual(['first'])
      expect(page2.hasMore).toBe(false)
      expect(page2.commits[0]?.parents).toEqual([])
    },
    30_000
  )

  it(
    'returns an empty page for an unborn repository',
    async () => {
      const repo = await initRepo()
      await expect(logCommits({ repoPath: repo })).resolves.toEqual({ commits: [], hasMore: false })
    },
    30_000
  )
})

describe('worktrees against a real repository', () => {
  it(
    'lists linked worktrees with lock state',
    async () => {
      const repo = await initRepo()
      await commit(repo, 'first')
      const linked = `${repo}-wt`
      dirs.push(linked)
      await git(repo, ['worktree', 'add', '-q', linked, '-b', 'feat'])
      await git(repo, ['worktree', 'lock', '--reason', 'in use', linked])

      const worktrees = await listWorktrees({ repoPath: repo })
      expect(worktrees).toHaveLength(2)
      expect(worktrees[0]?.branch).toBe('refs/heads/main')
      expect(worktrees[0]?.detached).toBe(false)
      expect(worktrees[1]?.branch).toBe('refs/heads/feat')
      expect(worktrees[1]?.locked).toBe('in use')
      expect(worktrees[1]?.sha).toMatch(sha40)
    },
    30_000
  )
})

describe('stashes against a real repository', () => {
  it(
    'lists stash entries newest first',
    async () => {
      const repo = await initRepo()
      await write(repo, 'a.txt', 'one\n')
      await git(repo, ['add', '.'])
      await commit(repo, 'first')

      const empty = await listStashes({ repoPath: repo })
      expect(empty).toEqual([])

      await write(repo, 'a.txt', 'two\n')
      await git(repo, ['stash', 'push', '-q', '-m', 'first stash'])
      await write(repo, 'a.txt', 'three\n')
      await git(repo, ['stash', 'push', '-q', '-m', 'second stash'])

      const stashes = await listStashes({ repoPath: repo })
      expect(stashes).toHaveLength(2)
      expect(stashes[0]?.index).toBe(0)
      expect(stashes[0]?.subject).toContain('second stash')
      expect(stashes[1]?.index).toBe(1)
      expect(stashes[0]?.sha).toMatch(sha40)

      const status = await readStatus({ repoPath: repo })
      expect(status.stashCount).toBe(2)
    },
    30_000
  )
})

describe('backup refs against a real repository', () => {
  it(
    'creates, resolves and lists backups that stay out of normal ref lists',
    async () => {
      const repo = await initRepo()
      await commit(repo, 'first')
      const firstSha = (await git(repo, ['rev-parse', 'HEAD'])).trim()

      const backup1 = await createBackupRef({ repoPath: repo, op: 'reset-hard', target: 'HEAD' })
      expect(backup1.sha).toBe(firstSha)
      expect(backup1.ref.startsWith(`${BACKUP_REF_PREFIX}reset-hard/`)).toBe(true)

      await commit(repo, 'second')
      const secondSha = (await git(repo, ['rev-parse', 'HEAD'])).trim()
      const backup2 = await createBackupRef({ repoPath: repo, op: 'reset-hard', target: 'HEAD' })
      expect(backup2.sha).toBe(secondSha)
      expect(backup2.ref).not.toBe(backup1.ref)

      const backups = await listBackupRefs({ repoPath: repo })
      expect(backups.map((entry) => entry.ref).sort()).toEqual([backup1.ref, backup2.ref].sort())
      const [newest, older] = backups
      if (newest === undefined || older === undefined) throw new Error('expected two backups')
      expect(newest.createdAt >= older.createdAt).toBe(true)

      expect((await git(repo, ['rev-parse', backup1.ref])).trim()).toBe(firstSha)

      const refs = await listRefs({ repoPath: repo })
      expect(refs.some((ref) => ref.fullName.includes('/backup/'))).toBe(false)

      await expect(createBackupRef({ repoPath: repo, op: 'Reset Hard', target: 'HEAD' })).rejects.toThrow()
      await expect(createBackupRef({ repoPath: repo, op: 'reset-hard', target: '--foo' })).rejects.toThrow()
    },
    30_000
  )
})

describe('submodules against a real repository', () => {
  it(
    'detects in-sync and deinitialized submodules',
    async () => {
      const sub = await initRepo()
      await write(sub, 'lib.txt', 'lib\n')
      await git(sub, ['add', '.'])
      await commit(sub, 'sub initial')

      const superRepo = await initRepo()
      await write(superRepo, 'readme.md', 'top\n')
      await git(superRepo, ['add', '.'])
      await commit(superRepo, 'super initial')
      await git(superRepo, ['-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', sub.replace(/\\/g, '/'), 'libs/core'])
      await commit(superRepo, 'add submodule')

      const submodules = await listSubmodules({ repoPath: superRepo })
      expect(submodules).toHaveLength(1)
      expect(submodules[0]?.path).toBe('libs/core')
      expect(submodules[0]?.sha).toMatch(sha40)
      expect(submodules[0]?.checkout).toBe('in-sync')

      await git(superRepo, ['submodule', 'deinit', '-f', 'libs/core'])
      const deinitialized = await listSubmodules({ repoPath: superRepo })
      expect(deinitialized[0]?.checkout).toBe('uninitialized')
    },
    60_000
  )
})

describe('repository layout', () => {
  it(
    'resolves dirs for normal and bare repositories',
    async () => {
      const repo = await initRepo()
      await commit(repo, 'first')
      const dirsInfo = await resolveRepoDirs(repo)
      expect(dirsInfo.bare).toBe(false)
      expect(dirsInfo.worktreePath?.replace(/\\/g, '/').toLowerCase()).toBe(repo.replace(/\\/g, '/').toLowerCase())
      expect(dirsInfo.gitDir.replace(/\\/g, '/').toLowerCase().endsWith('/.git')).toBe(true)

      const bare = await tempDir()
      await git(bare, ['init', '-q', '--bare'])
      const bareDirs = await resolveRepoDirs(bare)
      expect(bareDirs.bare).toBe(true)
      expect(bareDirs.worktreePath).toBeNull()
    },
    30_000
  )

  it(
    'probes the installed git version',
    async () => {
      const info = await probeGitVersion()
      expect(info.raw).toContain('git version')
      expect(info.supported).toBe(true)
      expect(info.major).toBeGreaterThanOrEqual(2)
    },
    15_000
  )
})

describe('staging operations against a real repository', () => {
  it(
    'stages additions, edits and deletions of the named paths',
    async () => {
      const repo = await initRepo()
      await write(repo, 'a.txt', 'one\n')
      await write(repo, 'b.txt', 'keep\n')
      await write(repo, 'gone.txt', 'bye\n')
      await git(repo, ['add', '.'])
      await commit(repo, 'initial')

      await write(repo, 'a.txt', 'two\n')
      await write(repo, 'new.txt', 'fresh\n')
      await rm(join(repo, 'gone.txt'))
      await stagePaths(repo, ['a.txt', 'new.txt', 'gone.txt'])

      const status = await readStatus({ repoPath: repo })
      expect(status.staged).toEqual([
        { path: 'a.txt', kind: 'modified' },
        { path: 'gone.txt', kind: 'deleted' },
        { path: 'new.txt', kind: 'added' }
      ])
      expect(status.unstaged).toEqual([])
      expect(status.untracked).toEqual([])

      await unstagePaths(repo, ['new.txt'])
      const after = await readStatus({ repoPath: repo })
      expect(after.staged.map((change) => change.path)).toEqual(['a.txt', 'gone.txt'])
      expect(after.untracked).toEqual(['new.txt'])
    },
    30_000
  )

  it(
    'treats paths as literals, never as globs',
    async () => {
      const repo = await initRepo()
      await write(repo, 'a1.txt', 'plain\n')
      await write(repo, 'a[1].txt', 'brackets\n')

      await stagePaths(repo, ['a[1].txt'])
      const status = await readStatus({ repoPath: repo })
      expect(status.staged.map((change) => change.path)).toEqual(['a[1].txt'])
      expect(status.untracked).toEqual(['a1.txt'])
    },
    30_000
  )

  it(
    'stages whole untracked directories by their status path',
    async () => {
      const repo = await initRepo()
      await commit(repo, 'initial')
      await write(repo, 'notes/deep/one.txt', 'one\n')
      await write(repo, 'notes/two.txt', 'two\n')

      const before = await readStatus({ repoPath: repo })
      expect(before.untracked).toEqual(['notes/'])

      await stagePaths(repo, ['notes/'])
      const after = await readStatus({ repoPath: repo })
      expect(after.untracked).toEqual([])
      expect(after.staged.map((change) => change.path)).toEqual(['notes/deep/one.txt', 'notes/two.txt'])
    },
    30_000
  )

  it(
    'unstages on an unborn branch instead of failing',
    async () => {
      const repo = await initRepo()
      await write(repo, 'first.txt', 'first\n')
      await stagePaths(repo, ['first.txt'])

      const staged = await readStatus({ repoPath: repo })
      expect(staged.head.unborn).toBe(true)
      expect(staged.staged.map((change) => change.path)).toEqual(['first.txt'])

      await unstagePaths(repo, ['first.txt'])
      const after = await readStatus({ repoPath: repo })
      expect(after.staged).toEqual([])
      expect(after.untracked).toEqual(['first.txt'])
      expect(await git(repo, ['status', '--porcelain'])).toBe('?? first.txt\n')
    },
    30_000
  )

  it(
    'unstages everything on an unborn branch',
    async () => {
      const repo = await initRepo()
      await write(repo, 'one.txt', 'one\n')
      await write(repo, 'nested/two.txt', 'two\n')
      await stageAll(repo)
      expect((await readStatus({ repoPath: repo })).staged).toHaveLength(2)

      await unstageAll(repo)
      const after = await readStatus({ repoPath: repo })
      expect(after.staged).toEqual([])
      expect(after.untracked).toHaveLength(2)
    },
    30_000
  )

  it(
    'stageAll and unstageAll cover the whole checkout',
    async () => {
      const repo = await initRepo()
      await write(repo, 'tracked.txt', 'one\n')
      await git(repo, ['add', '.'])
      await commit(repo, 'initial')
      await write(repo, 'tracked.txt', 'two\n')
      await write(repo, 'untracked.txt', 'new\n')

      await stageAll(repo)
      const staged = await readStatus({ repoPath: repo })
      expect(staged.staged.map((change) => change.path)).toEqual(['tracked.txt', 'untracked.txt'])
      expect(staged.untracked).toEqual([])

      await unstageAll(repo)
      const after = await readStatus({ repoPath: repo })
      expect(after.staged).toEqual([])
      expect(after.untracked).toEqual(['untracked.txt'])
      expect(after.unstaged).toEqual([{ path: 'tracked.txt', kind: 'modified' }])
    },
    30_000
  )

  it(
    'discards working tree changes from the index and leaves the staging area alone',
    async () => {
      const repo = await initRepo()
      await write(repo, 'a.txt', 'one\n')
      await write(repo, 'b.txt', 'keep\n')
      await write(repo, 'deleted.txt', 'restore me\n')
      await git(repo, ['add', '.'])
      await commit(repo, 'initial')

      await write(repo, 'a.txt', 'staged\n')
      await git(repo, ['add', 'a.txt'])
      await write(repo, 'a.txt', 'staged\nplus worktree\n')
      await write(repo, 'b.txt', 'changed\n')
      await rm(join(repo, 'deleted.txt'))

      await discardWorktreePaths(repo, ['a.txt', 'b.txt', 'deleted.txt'])
      const status = await readStatus({ repoPath: repo })
      expect(status.unstaged).toEqual([])
      expect(status.staged).toEqual([{ path: 'a.txt', kind: 'modified' }])
      expect(await git(repo, ['show', ':a.txt'])).toBe('staged\n')
      expect(await git(repo, ['show', ':b.txt'])).toBe('keep\n')
      expect(await git(repo, ['show', 'HEAD:deleted.txt'])).toBe('restore me\n')
    },
    30_000
  )

  it(
    'unstages both sides of a staged rename',
    async () => {
      const repo = await initRepo()
      await write(repo, 'old.txt', 'payload\n')
      await git(repo, ['add', '.'])
      await commit(repo, 'initial')
      await git(repo, ['mv', 'old.txt', 'new.txt'])

      const before = await readStatus({ repoPath: repo })
      expect(before.staged).toEqual([{ path: 'new.txt', origPath: 'old.txt', kind: 'renamed' }])

      await unstagePaths(repo, ['new.txt', 'old.txt'])
      const after = await readStatus({ repoPath: repo })
      expect(after.staged).toEqual([])
      expect(after.unstaged).toEqual([{ path: 'old.txt', kind: 'deleted' }])
      expect(after.untracked).toEqual(['new.txt'])
    },
    30_000
  )
})

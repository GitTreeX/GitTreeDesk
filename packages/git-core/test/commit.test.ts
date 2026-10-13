import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { commit, isHeadPushed, readHeadCommit } from '../src/commit'
import { GitCommandError } from '../src/errors'
import { runGitOrThrow } from '../src/run'

let dirs: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'gtd-commit-'))
  dirs.push(dir)
  return dir
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const result = await runGitOrThrow(args, { cwd })
  return result.stdout
}

async function initRepo(): Promise<string> {
  const dir = await tempDir()
  await git(dir, ['init', '-q', '-b', 'main'])
  await git(dir, ['config', 'user.name', 'GitTreeDesk Test'])
  await git(dir, ['config', 'user.email', 'test@gitreedesk.invalid'])
  return dir
}

async function write(cwd: string, relative: string, content: string): Promise<void> {
  const full = join(cwd, relative)
  await mkdir(dirname(full), { recursive: true })
  await writeFile(full, content, 'utf8')
}

async function writeHook(repo: string, body: string): Promise<void> {
  const hook = join(repo, '.git', 'hooks', 'pre-commit')
  await writeFile(hook, `#!/bin/sh\n${body}\n`, 'utf8')
  await chmod(hook, 0o755)
}

async function stageAll(repo: string): Promise<void> {
  await git(repo, ['add', '.'])
}

const sha40 = /^[0-9a-f]{40}$/

afterEach(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true })
  dirs = []
})

describe('commit against a real repository', () => {
  it(
    'commits staged changes and returns the new head sha',
    async () => {
      const repo = await initRepo()
      await write(repo, 'a.txt', 'one\n')
      await stageAll(repo)

      const result = await commit({ repoPath: repo, message: 'first' })
      expect(result.sha).toMatch(sha40)
      expect((await git(repo, ['rev-parse', 'HEAD'])).trim()).toBe(result.sha)
      expect((await git(repo, ['log', '-1', '--format=%s'])).trim()).toBe('first')
    },
    30_000
  )

  it(
    'appends a Signed-off-by trailer when signOff is set',
    async () => {
      const repo = await initRepo()
      await write(repo, 'a.txt', 'one\n')
      await stageAll(repo)

      await commit({ repoPath: repo, message: 'with trailer', signOff: true })
      const body = await git(repo, ['log', '-1', '--format=%B'])
      expect(body).toContain('Signed-off-by: GitTreeDesk Test <test@gitreedesk.invalid>')
    },
    30_000
  )

  it(
    'amends the head commit, keeping its message when none is given',
    async () => {
      const repo = await initRepo()
      await write(repo, 'a.txt', 'one\n')
      await stageAll(repo)
      await commit({ repoPath: repo, message: 'subject line\n\nBody line one' })

      await write(repo, 'b.txt', 'two\n')
      await stageAll(repo)
      await commit({ repoPath: repo, message: '', amend: true })

      expect((await git(repo, ['rev-list', '--count', 'HEAD'])).trim()).toBe('1')
      expect(await git(repo, ['show', 'HEAD:b.txt'])).toBe('two\n')
      const head = await readHeadCommit({ repoPath: repo })
      expect(head?.message).toBe('subject line\n\nBody line one')
    },
    30_000
  )

  it(
    'amends with a replacement message',
    async () => {
      const repo = await initRepo()
      await write(repo, 'a.txt', 'one\n')
      await stageAll(repo)
      const original = await commit({ repoPath: repo, message: 'draft' })

      const amended = await commit({ repoPath: repo, message: 'final', amend: true })
      expect(amended.sha).not.toBe(original.sha)
      expect((await git(repo, ['rev-list', '--count', 'HEAD'])).trim()).toBe('1')
      expect((await git(repo, ['log', '-1', '--format=%s'])).trim()).toBe('final')
    },
    30_000
  )

  it(
    'rejects an empty message unless amending, and fails when nothing is staged',
    async () => {
      const repo = await initRepo()
      await expect(commit({ repoPath: repo, message: '   ' })).rejects.toThrow(
        'A commit message is required'
      )
      await expect(commit({ repoPath: repo, message: 'first' })).rejects.toThrow()
    },
    30_000
  )

  it(
    'runs a pre-commit hook by default and suppresses it on request',
    async () => {
      const repo = await initRepo()
      await writeHook(repo, 'echo ran >> hook-log.txt')

      await write(repo, 'a.txt', 'one\n')
      await stageAll(repo)
      await commit({ repoPath: repo, message: 'hooked' })
      expect(await git(repo, ['-c', 'core.quotepath=false', 'status', '--porcelain'])).toContain(
        '?? hook-log.txt'
      )

      await rm(join(repo, 'hook-log.txt'))
      await write(repo, 'a.txt', 'two\n')
      await stageAll(repo)
      await commit({ repoPath: repo, message: 'suppressed', suppressHooks: true })
      const status = await git(repo, ['status', '--porcelain'])
      expect(status).not.toContain('hook-log.txt')
    },
    30_000
  )

  it(
    'surfaces a failing hook and lets a suppressed commit through',
    async () => {
      const repo = await initRepo()
      await writeHook(repo, 'echo "hook says no" >&2\nexit 1')

      await write(repo, 'a.txt', 'one\n')
      await stageAll(repo)
      const failure: unknown = await commit({ repoPath: repo, message: 'blocked' }).catch(
        (error: unknown) => error
      )
      expect(failure).toBeInstanceOf(GitCommandError)
      expect((failure as GitCommandError).stderr).toContain('hook says no')
      await expect(git(repo, ['rev-parse', 'HEAD'])).rejects.toThrow()

      await commit({ repoPath: repo, message: 'forced', suppressHooks: true })
      expect((await git(repo, ['log', '-1', '--format=%s'])).trim()).toBe('forced')
    },
    30_000
  )

  it(
    'reads the full head message and reports an unborn, unpushed branch',
    async () => {
      const repo = await initRepo()
      await expect(readHeadCommit({ repoPath: repo })).resolves.toBeNull()
      await expect(isHeadPushed({ repoPath: repo })).resolves.toBe(false)

      await write(repo, 'a.txt', 'one\n')
      await stageAll(repo)
      const result = await commit({ repoPath: repo, message: 'subject\n\nBody paragraph' })

      const head = await readHeadCommit({ repoPath: repo })
      expect(head).not.toBeNull()
      expect(head?.sha).toBe(result.sha)
      expect(head?.message).toBe('subject\n\nBody paragraph')
      await expect(isHeadPushed({ repoPath: repo })).resolves.toBe(false)

      await git(repo, ['update-ref', 'refs/remotes/origin/main', 'HEAD'])
      await expect(isHeadPushed({ repoPath: repo })).resolves.toBe(true)
    },
    30_000
  )
})

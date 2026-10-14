import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { editCommits } from '../src/edit'
import { parseNumstatZ, readCommitDetails, readUpstreamMarks } from '../src/graph'
import { countCommits } from '../src/log'
import { runGitOrThrow } from '../src/run'
import { readStatus } from '../src/status'

let dirs: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'gtd-graph-'))
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

async function subjects(cwd: string): Promise<string[]> {
  return (await git(cwd, ['log', '--format=%s'])).trim().split('\n')
}

afterEach(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true })
  dirs = []
})

describe('readUpstreamMarks', () => {
  it(
    'returns a null upstream when the branch has none',
    async () => {
      const repo = await initRepo()
      await expect(readUpstreamMarks({ repoPath: repo })).resolves.toEqual({
        upstream: null,
        outgoing: [],
        incoming: []
      })
    },
    30_000
  )

  it(
    'splits outgoing and incoming commits against the upstream',
    async () => {
      const repo = await initRepo()
      await git(repo, ['config', 'remote.origin.url', 'https://example.invalid/acme/repo.git'])
      await git(repo, ['config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*'])
      await git(repo, ['update-ref', 'refs/remotes/origin/main', 'HEAD'])
      await git(repo, ['config', 'branch.main.remote', 'origin'])
      await git(repo, ['config', 'branch.main.merge', 'refs/heads/main'])

      await git(repo, ['checkout', '-q', '-b', 'side'])
      await write(repo, 'side.txt', 'side\n')
      const incoming = await commitAll(repo, 'side work')
      await git(repo, ['update-ref', 'refs/remotes/origin/main', 'HEAD'])

      await git(repo, ['checkout', '-q', 'main'])
      await write(repo, 'b.txt', 'two\n')
      const outgoing = await commitAll(repo, 'main work')

      const marks = await readUpstreamMarks({ repoPath: repo })
      expect(marks.upstream).toBe('origin/main')
      expect(marks.outgoing).toEqual([outgoing])
      expect(marks.incoming).toEqual([incoming])
    },
    30_000
  )
})

describe('readCommitDetails', () => {
  it(
    'reports identities, the full message and per-file stats',
    async () => {
      const repo = await initRepo()
      await write(repo, 'a.txt', 'one\ntwo\nthree\n')
      await write(repo, 'b.txt', 'b\n')
      await write(repo, '文档/说明.txt', '内容\n')
      const sha = await commitAll(repo, 'subject line\n\nBody paragraph')

      const details = await readCommitDetails({ repoPath: repo, sha })
      expect(details.sha).toBe(sha)
      expect(details.message).toBe('subject line\n\nBody paragraph')
      expect(details.author.name).toBe('GitTreeDesk Test')
      expect(details.author.email).toBe('test@gitreedesk.invalid')
      expect(details.committer.name).toBe('GitTreeDesk Test')
      expect(details.parents).toHaveLength(1)
      expect(details.pushed).toBe(false)
      expect(details.files).toHaveLength(3)

      const modified = details.files.find((file) => file.path === 'a.txt')
      expect(modified?.kind).toBe('modified')
      expect(modified?.additions).toBe(2)
      expect(modified?.deletions).toBe(0)
      const added = details.files.find((file) => file.path === 'b.txt')
      expect(added?.kind).toBe('added')
      expect(added?.additions).toBe(1)
      expect(added?.deletions).toBe(0)
      const cjk = details.files.find((file) => file.path === '文档/说明.txt')
      expect(cjk?.kind).toBe('added')
      expect(cjk?.additions).toBe(1)
    },
    30_000
  )

  it(
    'detects renames and reports binary stats as null',
    async () => {
      const repo = await initRepo()
      await git(repo, ['mv', 'a.txt', 'renamed.txt'])
      await writeFile(join(repo, 'blob.bin'), Buffer.from([0, 1, 2, 3, 255, 0, 100]))
      const sha = await commitAll(repo, 'move and add binary')

      const details = await readCommitDetails({ repoPath: repo, sha })
      const renamed = details.files.find((file) => file.path === 'renamed.txt')
      expect(renamed?.kind).toBe('renamed')
      expect(renamed?.origPath).toBe('a.txt')
      expect(renamed?.additions).toBe(0)
      expect(renamed?.deletions).toBe(0)
      const binary = details.files.find((file) => file.path === 'blob.bin')
      expect(binary?.kind).toBe('added')
      expect(binary?.additions).toBeNull()
      expect(binary?.deletions).toBeNull()
    },
    30_000
  )

  it(
    'flags a commit as pushed once a remote-tracking branch contains it',
    async () => {
      const repo = await initRepo()
      const sha = await headSha(repo)
      await expect(readCommitDetails({ repoPath: repo, sha })).resolves.toMatchObject({
        pushed: false
      })
      await git(repo, ['update-ref', 'refs/remotes/origin/main', sha])
      await expect(readCommitDetails({ repoPath: repo, sha })).resolves.toMatchObject({
        pushed: true
      })
    },
    30_000
  )
})

describe('parseNumstatZ', () => {
  it('parses plain, renamed and binary entries', () => {
    const plain = parseNumstatZ('3\t1\tsrc/a.ts\0')
    expect(plain.get('src/a.ts')).toEqual({ additions: 3, deletions: 1 })
    const renamed = parseNumstatZ('2\t0\t\0old/name.ts\0new/name.ts\0')
    expect(renamed.get('new/name.ts')).toEqual({
      additions: 2,
      deletions: 0,
      origPath: 'old/name.ts'
    })
    const binary = parseNumstatZ('-\t-\timg.png\0')
    expect(binary.get('img.png')).toEqual({ additions: null, deletions: null })
  })
})

describe('countCommits', () => {
  it(
    'counts commits and honours filters',
    async () => {
      const repo = await initRepo()
      await write(repo, 'b.txt', 'two\n')
      await commitAll(repo, 'second')
      await write(repo, 'c.txt', 'three\n')
      await commitAll(repo, 'third')

      expect(await countCommits({ repoPath: repo })).toBe(3)
      expect(await countCommits({ repoPath: repo, author: 'GitTreeDesk Test' })).toBe(3)
      expect(await countCommits({ repoPath: repo, author: 'Nobody' })).toBe(0)

      const empty = await tempDir()
      await git(empty, ['init', '-q', '-b', 'main'])
      expect(await countCommits({ repoPath: empty })).toBe(0)
    },
    30_000
  )
})

describe('editCommits', () => {
  it(
    'rewrites HEAD in place without swallowing staged changes',
    async () => {
      const repo = await initRepo()
      await write(repo, 'b.txt', 'two\n')
      const second = await commitAll(repo, 'second')

      await write(repo, 'a.txt', 'staged change\n')
      await git(repo, ['add', 'a.txt'])
      const treeBefore = (await git(repo, ['rev-parse', 'HEAD^{tree}'])).trim()

      const result = await editCommits(repo, {
        edits: [
          {
            sha: second,
            message: 'second (reworded)',
            authorName: 'Renamed Author',
            authorEmail: 'author@example.com'
          }
        ]
      })

      expect(result.stopped).toBe(false)
      expect(result.sha).not.toBe(second)
      expect((await git(repo, ['rev-list', '--count', 'HEAD'])).trim()).toBe('2')
      expect((await git(repo, ['log', '-1', '--format=%s'])).trim()).toBe('second (reworded)')
      expect((await git(repo, ['log', '-1', '--format=%an|%ae'])).trim()).toBe(
        'Renamed Author|author@example.com'
      )
      expect((await git(repo, ['rev-parse', 'HEAD^{tree}'])).trim()).toBe(treeBefore)
      expect(await porcelain(repo)).toBe('M  a.txt')
    },
    30_000
  )

  it(
    'replaces author and committer dates on HEAD',
    async () => {
      const repo = await initRepo()
      const sha = await headSha(repo)

      const result = await editCommits(repo, {
        edits: [
          {
            sha,
            authorDate: '2020-01-02T03:04:05+00:00',
            committerDate: '2021-02-03T04:05:06+00:00'
          }
        ]
      })

      expect(result.stopped).toBe(false)
      const authorIso = (await git(repo, ['log', '-1', '--format=%aI'])).trim()
      const committerIso = (await git(repo, ['log', '-1', '--format=%cI'])).trim()
      expect(new Date(authorIso).toISOString()).toBe('2020-01-02T03:04:05.000Z')
      expect(new Date(committerIso).toISOString()).toBe('2021-02-03T04:05:06.000Z')
    },
    30_000
  )

  it(
    'rewrites an older commit and replays its descendants',
    async () => {
      const repo = await initRepo()
      const first = await headSha(repo)
      await write(repo, 'b.txt', 'two\n')
      await commitAll(repo, 'second')
      await write(repo, 'c.txt', 'three\n')
      const third = await commitAll(repo, 'third')
      const treeBefore = (await git(repo, ['rev-parse', 'HEAD^{tree}'])).trim()

      const result = await editCommits(repo, {
        edits: [{ sha: first, message: 'first (reworded)' }]
      })

      expect(result.stopped).toBe(false)
      expect(result.sha).not.toBe(third)
      expect((await git(repo, ['rev-list', '--count', 'HEAD'])).trim()).toBe('3')
      expect(await subjects(repo)).toEqual(['third', 'second', 'first (reworded)'])
      expect((await git(repo, ['rev-parse', 'HEAD^{tree}'])).trim()).toBe(treeBefore)
      expect(await porcelain(repo)).toBe('')
      await expect(readStatus({ repoPath: repo, untracked: 'no' })).resolves.toMatchObject({
        operation: 'none'
      })
    },
    30_000
  )

  it(
    'rewrites a batch including the root commit in one pass',
    async () => {
      const repo = await initRepo()
      const root = await headSha(repo)
      await write(repo, 'b.txt', 'two\n')
      await commitAll(repo, 'second')
      await write(repo, 'c.txt', 'three\n')
      const third = await commitAll(repo, 'third')

      const result = await editCommits(repo, {
        edits: [
          { sha: root, message: 'root (reworded)' },
          { sha: third, message: 'tip (reworded)' }
        ]
      })

      expect(result.stopped).toBe(false)
      expect((await git(repo, ['rev-list', '--count', 'HEAD'])).trim()).toBe('3')
      expect(await subjects(repo)).toEqual(['tip (reworded)', 'second', 'root (reworded)'])
      expect((await git(repo, ['rev-list', '--max-parents=0', 'HEAD'])).trim()).toBe(
        (await git(repo, ['rev-parse', 'HEAD~2'])).trim()
      )
      expect(await porcelain(repo)).toBe('')
    },
    30_000
  )

  it(
    'rewrites two commits of the middle in one pass',
    async () => {
      const repo = await initRepo()
      await write(repo, 'b.txt', 'two\n')
      const second = await commitAll(repo, 'second')
      await write(repo, 'c.txt', 'three\n')
      const third = await commitAll(repo, 'third')
      await write(repo, 'd.txt', 'four\n')
      await commitAll(repo, 'fourth')

      const result = await editCommits(repo, {
        edits: [
          { sha: second, message: 'second (reworded)' },
          { sha: third, message: 'third (reworded)' }
        ]
      })

      expect(result.stopped).toBe(false)
      expect((await git(repo, ['rev-list', '--count', 'HEAD'])).trim()).toBe('4')
      expect(await subjects(repo)).toEqual([
        'fourth',
        'third (reworded)',
        'second (reworded)',
        'first'
      ])
      expect(await porcelain(repo)).toBe('')
    },
    30_000
  )

  it(
    'rejects a commit that is not on the current branch',
    async () => {
      const repo = await initRepo()
      await git(repo, ['checkout', '-q', '-b', 'side'])
      await write(repo, 'side.txt', 'side\n')
      const sideSha = await commitAll(repo, 'side work')
      await git(repo, ['checkout', '-q', 'main'])

      await expect(
        editCommits(repo, { edits: [{ sha: sideSha, message: 'nope' }] })
      ).rejects.toThrow('Not a commit on the current branch')
    },
    30_000
  )

  it(
    'rejects an edit that changes nothing or pairs the author fields wrongly',
    async () => {
      const repo = await initRepo()
      const sha = await headSha(repo)

      await expect(editCommits(repo, { edits: [] })).rejects.toThrow('No commits to edit')
      await expect(
        editCommits(repo, { edits: [{ sha, message: '  ' }] })
      ).rejects.toThrow('cannot be empty')
      await expect(
        editCommits(repo, { edits: [{ sha, authorName: 'Name Only' }] })
      ).rejects.toThrow('provided together')
      await expect(editCommits(repo, { edits: [{ sha }] })).rejects.toThrow('changes nothing')
    },
    30_000
  )

  it(
    'runs hooks unless suppressed',
    async () => {
      const repo = await initRepo()
      const sha = await headSha(repo)
      const hook = join(repo, '.git', 'hooks', 'pre-commit')
      await writeFile(hook, '#!/bin/sh\necho "no amend" >&2\nexit 1\n', 'utf8')
      await chmod(hook, 0o755)

      await expect(
        editCommits(repo, { edits: [{ sha, message: 'hooked' }] })
      ).rejects.toThrow()

      const result = await editCommits(repo, {
        edits: [{ sha, message: 'hooked' }],
        suppressHooks: true
      })
      expect(result.stopped).toBe(false)
      expect((await git(repo, ['log', '-1', '--format=%s'])).trim()).toBe('hooked')
    },
    30_000
  )
})

import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { fileHistory } from '../src/log'
import { runGitOrThrow } from '../src/run'

let dirs: string[] = []

/**
 * The temp directory is canonicalized first: macOS hands out `/var/...` while git
 * reports `/private/var/...`.
 */
async function tempDir(): Promise<string> {
  const base = await realpath(tmpdir()).catch(() => tmpdir())
  const dir = await mkdtemp(join(base, 'gtd-history-'))
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
  return dir
}

/** `a.txt` → `b.txt` → `c.txt`, with an edit before each rename. */
async function lineageRepo(): Promise<string> {
  const dir = await initRepo()
  await write(dir, 'a.txt', 'one\ntwo\nthree\n')
  await git(dir, ['add', '.'])
  await git(dir, ['commit', '-q', '-m', 'add a'])
  await write(dir, 'a.txt', 'one\ntwo changed\nthree\n')
  await git(dir, ['add', '.'])
  await git(dir, ['commit', '-q', '-m', 'edit a'])
  await git(dir, ['mv', 'a.txt', 'b.txt'])
  await git(dir, ['commit', '-q', '-m', 'rename to b'])
  await write(dir, 'b.txt', 'one\ntwo changed\nthree\nfour\n')
  await git(dir, ['add', '.'])
  await git(dir, ['commit', '-q', '-m', 'edit b'])
  await git(dir, ['mv', 'b.txt', 'c.txt'])
  await git(dir, ['commit', '-q', '-m', 'rename to c'])
  await write(dir, 'c.txt', 'one\ntwo changed\nthree\nfour\nfive\n')
  await git(dir, ['add', '.'])
  await git(dir, ['commit', '-q', '-m', 'edit c'])
  return dir
}

afterEach(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true })
  dirs = []
})

describe('fileHistory', () => {
  it('reports the name a file had in each commit of its lineage', async () => {
    const repo = await lineageRepo()
    const { entries, hasMore } = await fileHistory({ repoPath: repo, path: 'c.txt', follow: true })

    expect(hasMore).toBe(false)
    expect(entries.map((entry) => entry.subject)).toEqual([
      'edit c',
      'rename to c',
      'edit b',
      'rename to b',
      'edit a',
      'add a'
    ])
    expect(entries.map((entry) => entry.path)).toEqual([
      'c.txt',
      'c.txt',
      'b.txt',
      'b.txt',
      'a.txt',
      'a.txt'
    ])
    expect(entries.map((entry) => entry.origPath)).toEqual([null, 'b.txt', null, 'a.txt', null, null])
    expect(entries[5]?.parents).toEqual([])
  })

  it('stops at the rename when following is off', async () => {
    const repo = await lineageRepo()
    const { entries } = await fileHistory({ repoPath: repo, path: 'c.txt' })

    expect(entries.map((entry) => entry.subject)).toEqual(['edit c', 'rename to c'])
    expect(entries.map((entry) => entry.path)).toEqual(['c.txt', 'c.txt'])

    const skipped = await fileHistory({ repoPath: repo, path: 'c.txt', skip: 1 })
    expect(skipped.entries.map((entry) => entry.subject)).toEqual(['rename to c'])
  })

  it('keeps the lineage names across a later page', async () => {
    const repo = await lineageRepo()
    const first = await fileHistory({ repoPath: repo, path: 'c.txt', follow: true, maxCount: 3 })
    const second = await fileHistory({
      repoPath: repo,
      path: 'c.txt',
      follow: true,
      maxCount: 3,
      skip: first.entries.length
    })

    expect(first.hasMore).toBe(true)
    expect(first.entries.map((entry) => entry.path)).toEqual(['c.txt', 'c.txt', 'b.txt'])
    expect(second.hasMore).toBe(false)
    expect(second.entries.map((entry) => entry.subject)).toEqual(['rename to b', 'edit a', 'add a'])
    expect(second.entries.map((entry) => entry.path)).toEqual(['b.txt', 'a.txt', 'a.txt'])
    expect(second.entries.map((entry) => entry.origPath)).toEqual(['a.txt', null, null])
  })

  it('lists nothing before the first commit', async () => {
    const repo = await initRepo()
    const { entries, hasMore } = await fileHistory({ repoPath: repo, path: 'a.txt', follow: true })
    expect(entries).toEqual([])
    expect(hasMore).toBe(false)
  })

  it('follows a path that has spaces and non-ascii names', async () => {
    const repo = await initRepo()
    await write(repo, 'docs 文档/a b.txt', 'one\ntwo\n')
    await git(repo, ['add', '.'])
    await git(repo, ['commit', '-q', '-m', 'add'])
    await git(repo, ['mv', 'docs 文档/a b.txt', 'docs 文档/c d.txt'])
    await git(repo, ['commit', '-q', '-m', 'rename'])
    await write(repo, 'docs 文档/c d.txt', 'one\ntwo\nthree\n')
    await git(repo, ['add', '.'])
    await git(repo, ['commit', '-q', '-m', 'edit'])

    const { entries } = await fileHistory({ repoPath: repo, path: 'docs 文档/c d.txt', follow: true })
    expect(entries.map((entry) => entry.subject)).toEqual(['edit', 'rename', 'add'])
    expect(entries.map((entry) => entry.path)).toEqual([
      'docs 文档/c d.txt',
      'docs 文档/c d.txt',
      'docs 文档/a b.txt'
    ])
    expect(entries.map((entry) => entry.origPath)).toEqual([null, 'docs 文档/a b.txt', null])
  })

  it('sees a file that was deleted in the newest commit', async () => {
    const repo = await lineageRepo()
    await git(repo, ['rm', '-q', 'c.txt'])
    await git(repo, ['commit', '-q', '-m', 'drop c'])

    const { entries } = await fileHistory({ repoPath: repo, path: 'c.txt', follow: true, maxCount: 2 })
    expect(entries.map((entry) => entry.subject)).toEqual(['drop c', 'edit c'])
    expect(entries.map((entry) => entry.path)).toEqual(['c.txt', 'c.txt'])
  })
})

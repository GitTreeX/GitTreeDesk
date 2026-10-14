import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertRefName,
  checkoutBranch,
  checkoutDetach,
  createBranch,
  deleteBranch,
  isBranchMerged,
  readBranchTip,
  renameBranch,
  setUpstream
} from '../src/branches'
import { runGitOrThrow } from '../src/run'

let dirs: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'gtd-branch-'))
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
  await write(dir, 'a.txt', 'one\n')
  await git(dir, ['add', '.'])
  await git(dir, ['commit', '-q', '-m', 'first'])
  return dir
}

afterEach(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true })
  dirs = []
})

describe('assertRefName', () => {
  it('accepts normal branch names', () => {
    expect(() => assertRefName('main')).not.toThrow()
    expect(() => assertRefName('feat/dark-mode')).not.toThrow()
    expect(() => assertRefName('release-1.2.x')).not.toThrow()
  })

  it('rejects names git would refuse', () => {
    for (const bad of ['', '-x', 'a b', 'a..b', 'a@{b', 'a//b', '/a', 'a/', 'a.', 'a.lock', 'a:b', 'a\\b']) {
      expect(() => assertRefName(bad), bad).toThrow('Invalid branch name')
    }
  })
})

describe('branches against a real repository', () => {
  it(
    'creates, checks out, renames and deletes branches',
    async () => {
      const repo = await initRepo()

      await createBranch(repo, { name: 'feat/one' })
      expect((await git(repo, ['branch', '--format=%(refname:short)'])).trim().split('\n')).toContain('feat/one')
      expect((await git(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()).toBe('main')

      await createBranch(repo, { name: 'feat/two', startPoint: 'feat/one', checkout: true })
      expect((await git(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()).toBe('feat/two')

      await checkoutBranch(repo, 'main')
      expect((await git(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()).toBe('main')

      await renameBranch(repo, 'feat/two', 'feat/renamed')
      const names = (await git(repo, ['branch', '--format=%(refname:short)'])).trim().split('\n')
      expect(names).toContain('feat/renamed')
      expect(names).not.toContain('feat/two')

      expect(await readBranchTip(repo, { name: 'feat/renamed' })).toBe(await readBranchTip(repo, { name: 'main' }))
      expect(await readBranchTip(repo, { name: 'missing' })).toBeNull()

      await deleteBranch(repo, 'feat/renamed')
      const after = (await git(repo, ['branch', '--format=%(refname:short)'])).trim().split('\n')
      expect(after).not.toContain('feat/renamed')
    },
    30_000
  )

  it(
    'refuses to delete an unmerged branch unless forced',
    async () => {
      const repo = await initRepo()
      await checkoutBranch(repo, 'main')
      await createBranch(repo, { name: 'wip', checkout: true })
      await write(repo, 'b.txt', 'side\n')
      await git(repo, ['add', '.'])
      await git(repo, ['commit', '-q', '-m', 'side work'])
      await checkoutBranch(repo, 'main')

      await expect(isBranchMerged(repo, 'wip')).resolves.toBe(false)
      await expect(isBranchMerged(repo, 'main')).resolves.toBe(true)

      await expect(deleteBranch(repo, 'wip')).rejects.toThrow()
      expect((await git(repo, ['branch', '--format=%(refname:short)'])).trim().split('\n')).toContain('wip')

      await deleteBranch(repo, 'wip', { force: true })
      expect((await git(repo, ['branch', '--format=%(refname:short)'])).trim().split('\n')).not.toContain('wip')
    },
    30_000
  )

  it(
    'detaches HEAD onto a commit',
    async () => {
      const repo = await initRepo()
      const sha = (await git(repo, ['rev-parse', 'HEAD'])).trim()

      await checkoutDetach(repo, sha)
      expect((await git(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()).toBe('HEAD')
      expect((await git(repo, ['rev-parse', 'HEAD'])).trim()).toBe(sha)
    },
    30_000
  )

  it(
    'sets the upstream of a branch',
    async () => {
      const repo = await initRepo()
      const head = (await git(repo, ['rev-parse', 'HEAD'])).trim()
      // set-upstream resolves tracking refs through the remote's config, so origin must exist.
      await git(repo, ['remote', 'add', 'origin', 'https://example.com/acme/api-server.git'])
      await git(repo, ['update-ref', 'refs/remotes/origin/main', head])
      await createBranch(repo, { name: 'tracked' })

      await setUpstream(repo, 'tracked', 'origin/main')
      const upstream = await git(repo, ['for-each-ref', '--format=%(upstream:short)', 'refs/heads/tracked'])
      expect(upstream.trim()).toBe('origin/main')
    },
    30_000
  )
})

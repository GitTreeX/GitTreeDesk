import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runGitOrThrow } from '../src/run'
import { fetchRemote, pullRepo, pushBranch } from '../src/sync'

let dirs: string[] = []

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
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

async function commitAll(cwd: string, message: string): Promise<void> {
  await git(cwd, ['add', '.'])
  await git(cwd, ['commit', '-q', '-m', message])
}

/** A bare origin plus a clone with one commit on `main`. */
async function fixture(): Promise<{ origin: string; work: string }> {
  const origin = await tempDir('gtd-origin-')
  await git(origin, ['init', '-q', '--bare'])
  const work = await tempDir('gtd-work-')
  await git(work, ['init', '-q', '-b', 'main'])
  await git(work, ['config', 'user.name', 'GitTreeDesk Test'])
  await git(work, ['config', 'user.email', 'test@gitreedesk.invalid'])
  await write(work, 'a.txt', 'one\n')
  await commitAll(work, 'first')
  await git(work, ['remote', 'add', 'origin', origin])
  await git(work, ['push', '-q', '-u', 'origin', 'main'])
  // Bare init may default to `master`; point the remote HEAD at the real branch
  // so clones get a checkout.
  await git(origin, ['symbolic-ref', 'HEAD', 'refs/heads/main'])
  return { origin, work }
}

async function cloneOf(origin: string): Promise<string> {
  const clone = await tempDir('gtd-clone-')
  await git(dirname(clone), ['clone', '-q', origin, clone])
  await git(clone, ['config', 'user.name', 'GitTreeDesk Test'])
  await git(clone, ['config', 'user.email', 'test@gitreedesk.invalid'])
  return clone
}

afterEach(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true })
  dirs = []
})

describe('fetchRemote', () => {
  it(
    'reports updated only when refs moved, and prunes deleted branches',
    async () => {
      const { origin, work } = await fixture()
      const clone = await cloneOf(origin)

      const first = await fetchRemote(clone, { remote: 'origin' })
      expect(first.updated).toBe(false)

      await write(work, 'b.txt', 'two\n')
      await commitAll(work, 'second')
      await git(work, ['push', '-q', 'origin', 'main'])

      const second = await fetchRemote(clone, { remote: 'origin' })
      expect(second.updated).toBe(true)
      expect(second.output).toBeTypeOf('string')

      await git(work, ['push', '-q', 'origin', 'main:refs/heads/feature'])
      expect((await fetchRemote(clone, { remote: 'origin' })).updated).toBe(true)
      expect(await git(clone, ['rev-parse', '--verify', 'refs/remotes/origin/feature'])).toBeTruthy()

      // A plain fetch keeps stale remote-tracking refs; --prune removes them.
      await git(work, ['push', '-q', 'origin', ':refs/heads/feature'])
      expect((await fetchRemote(clone, { remote: 'origin' })).updated).toBe(false)
      expect((await fetchRemote(clone, { remote: 'origin', prune: true })).updated).toBe(true)
      await expect(git(clone, ['rev-parse', '--verify', 'refs/remotes/origin/feature'])).rejects.toThrow()
    },
    60_000
  )

  it(
    'follows annotated tags by default and skips them with --no-tags',
    async () => {
      const { origin, work } = await fixture()
      const withTags = await cloneOf(origin)
      const withoutTags = await cloneOf(origin)

      await write(work, 'b.txt', 'two\n')
      await commitAll(work, 'second')
      await git(work, ['tag', '-a', 'v2.0.0', '-m', 'release two'])
      await git(work, ['push', '-q', 'origin', 'main'])
      await git(work, ['push', '-q', 'origin', 'v2.0.0'])

      await fetchRemote(withoutTags, { remote: 'origin', followTags: false })
      expect((await git(withoutTags, ['tag', '--list'])).trim()).toBe('')

      const result = await fetchRemote(withTags, { remote: 'origin' })
      expect(result.updated).toBe(true)
      expect((await git(withTags, ['tag', '--list'])).trim()).toBe('v2.0.0')
    },
    60_000
  )
})

describe('pullRepo', () => {
  it(
    'fast-forwards with the ff-only strategy',
    async () => {
      const { origin, work } = await fixture()
      const clone = await cloneOf(origin)

      await write(work, 'b.txt', 'two\n')
      await commitAll(work, 'second')
      await git(work, ['push', '-q', 'origin', 'main'])

      const result = await pullRepo(clone, { strategy: 'ff-only' })
      expect(result).toEqual({ stashed: false, stashRestored: false, stashConflict: false })
      expect((await git(clone, ['log', '-1', '--format=%s'])).trim()).toBe('second')
    },
    60_000
  )

  it(
    'fails loudly when ff-only histories diverged',
    async () => {
      const { origin, work } = await fixture()
      const clone = await cloneOf(origin)

      await write(work, 'b.txt', 'remote\n')
      await commitAll(work, 'remote work')
      await git(work, ['push', '-q', 'origin', 'main'])
      await write(clone, 'c.txt', 'local\n')
      await commitAll(clone, 'local work')

      await expect(pullRepo(clone, { strategy: 'ff-only' })).rejects.toThrow()
      expect((await git(clone, ['log', '-1', '--format=%s'])).trim()).toBe('local work')
    },
    60_000
  )

  it(
    'merges diverged histories with the merge strategy',
    async () => {
      const { origin, work } = await fixture()
      const clone = await cloneOf(origin)

      await write(work, 'b.txt', 'remote\n')
      await commitAll(work, 'remote work')
      await git(work, ['push', '-q', 'origin', 'main'])
      await write(clone, 'c.txt', 'local\n')
      await commitAll(clone, 'local work')

      await pullRepo(clone, { strategy: 'merge' })
      expect((await git(clone, ['log', '-1', '--format=%P'])).trim().split(' ')).toHaveLength(2)
    },
    60_000
  )

  it(
    'rebases diverged histories with the rebase strategy',
    async () => {
      const { origin, work } = await fixture()
      const clone = await cloneOf(origin)

      await write(work, 'b.txt', 'remote\n')
      await commitAll(work, 'remote work')
      await git(work, ['push', '-q', 'origin', 'main'])
      await write(clone, 'c.txt', 'local\n')
      await commitAll(clone, 'local work')

      await pullRepo(clone, { strategy: 'rebase' })
      expect((await git(clone, ['log', '--format=%s'])).trim().split('\n')).toEqual([
        'local work',
        'remote work',
        'first'
      ])
    },
    60_000
  )

  it(
    'auto-stashes a dirty tree and restores it cleanly around the pull',
    async () => {
      const { origin, work } = await fixture()
      const clone = await cloneOf(origin)

      const base = ['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7', 'l8']
      await write(work, 'shared.txt', base.join('\n') + '\n')
      await commitAll(work, 'seed shared')
      await git(work, ['push', '-q', 'origin', 'main'])
      await pullRepo(clone, { strategy: 'ff-only' })

      const remoteLines = [...base]
      remoteLines[0] = 'remote top'
      await write(work, 'shared.txt', remoteLines.join('\n') + '\n')
      await commitAll(work, 'remote top edit')
      await git(work, ['push', '-q', 'origin', 'main'])

      const localLines = [...base]
      localLines[7] = 'local bottom'
      await write(clone, 'shared.txt', localLines.join('\n') + '\n')

      const result = await pullRepo(clone, { strategy: 'ff-only' })
      expect(result.stashed).toBe(true)
      expect(result.stashRestored).toBe(true)
      expect(result.stashConflict).toBe(false)

      expect(await git(clone, ['show', 'HEAD:shared.txt'])).toContain('remote top')
      const workingCopy = await readFile(join(clone, 'shared.txt'), 'utf8')
      expect(workingCopy).toContain('local bottom')
      expect(workingCopy).toContain('remote top')
      expect((await git(clone, ['stash', 'list'])).trim()).toBe('')
    },
    60_000
  )

  it(
    'keeps the stash entry when restoring it conflicts',
    async () => {
      const { origin, work } = await fixture()
      const clone = await cloneOf(origin)

      await write(work, 'a.txt', 'from remote\n')
      await commitAll(work, 'remote edit')
      await git(work, ['push', '-q', 'origin', 'main'])

      await write(clone, 'a.txt', 'from local\n')

      const result = await pullRepo(clone, { strategy: 'ff-only' })
      expect(result.stashed).toBe(true)
      expect(result.stashConflict).toBe(true)
      expect((await git(clone, ['stash', 'list'])).trim()).toContain('GitTreeDesk: auto-stash before pull')
      expect((await git(clone, ['status', '--porcelain'])).trim()).toContain('UU a.txt')
    },
    60_000
  )
})

describe('pushBranch', () => {
  it(
    'publishes a branch and sets its upstream',
    async () => {
      const { origin, work } = await fixture()
      await git(work, ['checkout', '-q', '-b', 'feat/one'])
      await write(work, 'b.txt', 'two\n')
      await commitAll(work, 'feat work')

      await pushBranch(work, { remote: 'origin', branch: 'feat/one', setUpstream: true })

      expect((await git(work, ['rev-parse', '--verify', 'refs/remotes/origin/feat/one'])).trim()).toBe(
        (await git(work, ['rev-parse', 'HEAD'])).trim()
      )
      const upstream = await git(work, ['for-each-ref', '--format=%(upstream:short)', 'refs/heads/feat/one'])
      expect(upstream.trim()).toBe('origin/feat/one')
    },
    60_000
  )

  it(
    'pushes ahead commits of the current branch',
    async () => {
      const { origin, work } = await fixture()
      const clone = await cloneOf(origin)

      await write(work, 'b.txt', 'two\n')
      await commitAll(work, 'second')
      await pushBranch(work, { remote: 'origin', branch: 'main' })

      expect((await git(clone, ['rev-parse', 'HEAD'])).trim()).not.toBe(
        (await git(work, ['rev-parse', 'HEAD'])).trim()
      )
      await pullRepo(clone, { strategy: 'ff-only' })
      expect((await git(clone, ['rev-parse', 'HEAD'])).trim()).toBe(
        (await git(work, ['rev-parse', 'HEAD'])).trim()
      )
    },
    60_000
  )
})

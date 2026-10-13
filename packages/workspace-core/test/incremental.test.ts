import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { RepoKind, RepoRecord } from '@gitreedesk/shared'
import { GitPool, runGitOrThrow } from '@gitreedesk/git-core'
import { defaultWorkspaceConfig } from '../src/config'
import { discoverRepositories } from '../src/discovery'
import { mergeScopedRecords } from '../src/incremental'

const IDENTITY = ['-c', 'user.name=GitTreeDesk Test', '-c', 'user.email=test@gitreedesk.invalid']

let dirs: string[] = []
let pools: GitPool[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'gtd-inc-'))
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

const toPosix = (value: string): string => value.replace(/\\/g, '/')

function repo(id: string, path: string, kind: RepoKind = 'repository', parentId: string | null = null): RepoRecord {
  const name = path.split('/').pop() ?? path
  return {
    id,
    root: '/ws',
    relPath: path.replace('/ws/', ''),
    path,
    gitDir: kind === 'worktree' ? `${id}/worktrees/${name}` : id,
    commonDir: id,
    kind,
    parentId,
    name,
    external: false,
    hasSubmodules: false
  }
}

afterEach(async () => {
  for (const instance of pools) instance.dispose()
  pools = []
  for (const dir of dirs) await rm(dir, { recursive: true, force: true })
  dirs = []
})

describe('mergeScopedRecords', () => {
  it('replaces records inside the scope, keeps the rest, and relinks parents across the boundary', () => {
    const main = repo('/ws/app/.git', '/ws/app')
    const worktree = repo('/ws/app/.git', '/ws/app-wt', 'worktree', '/ws/app/.git')
    const other = repo('/ws/other/.git', '/ws/other')
    const current = [main, worktree, other]

    // The scoped scan cannot know the main checkout, so it reports no parent.
    const worktreeScan = repo('/ws/app/.git', '/ws/app-wt', 'worktree')
    const merged = mergeScopedRecords(current, [worktreeScan], '/ws/app-wt')

    expect(merged.map((record) => record.path)).toEqual(['/ws/app', '/ws/app-wt', '/ws/other'])
    expect(merged.find((record) => record.path === '/ws/app-wt')?.parentId).toBe('/ws/app/.git')
    expect(merged.find((record) => record.path === '/ws/app-wt')).not.toBe(worktreeScan)
    expect(merged.find((record) => record.path === '/ws/app')).toEqual(main)

    // Inputs are untouched.
    expect(worktree.parentId).toBe('/ws/app/.git')
    expect(main.parentId).toBeNull()
  })

  it('drops the records of a deleted subtree', () => {
    const current = [repo('/ws/app/.git', '/ws/app'), repo('/ws/gone/.git', '/ws/gone')]
    const merged = mergeScopedRecords(current, [], '/ws/gone')
    expect(merged.map((record) => record.path)).toEqual(['/ws/app'])
  })

  it('attaches submodule checkouts to their superproject when only one side was scanned', () => {
    const superMain = repo('/ws/super/.git', '/ws/super')
    const submodule = repo('/ws/super/.git/modules/libs/core', '/ws/super/libs/core')
    const merged = mergeScopedRecords([superMain, submodule], [], '/ws/nowhere')
    expect(merged.find((record) => record.path === '/ws/super/libs/core')?.parentId).toBe('/ws/super/.git')
  })

  it(
    'scopes a real scan to a subtree while keeping root-relative paths',
    async () => {
      const root = await tempDir()
      await initRepo(join(root, 'group', 'team', 'app'))
      await initRepo(join(root, 'solo'))
      const config = defaultWorkspaceConfig('acme')

      const full = await discoverRepositories({ root, config, pool: pool() })
      expect(full.repos.map((record) => record.relPath)).toEqual(['group/team/app', 'solo'])

      const scope = toPosix(await realpath(join(root, 'group')))
      const scoped = await discoverRepositories({ root, config, pool: pool(), scope })
      expect(scoped.repos.map((record) => record.relPath)).toEqual(['group/team/app'])
      expect(scoped.repos[0]?.root).toBe(full.repos[0]?.root)

      // Merging a subtree that is already up to date changes nothing.
      const merged = mergeScopedRecords(full.repos, scoped.repos, scope)
      expect(merged.map((record) => record.relPath)).toEqual(full.repos.map((record) => record.relPath))
    },
    60_000
  )

  it(
    'removes records via a scoped scan of a deleted directory',
    async () => {
      const root = await tempDir()
      await initRepo(join(root, 'app'))
      await initRepo(join(root, 'other'))
      const config = defaultWorkspaceConfig('acme')

      const full = await discoverRepositories({ root, config, pool: pool() })
      const scope = toPosix(await realpath(join(root, 'app')))
      await rm(join(root, 'app'), { recursive: true, force: true })

      const scoped = await discoverRepositories({ root, config, pool: pool(), scope })
      expect(scoped.repos).toEqual([])

      const merged = mergeScopedRecords(full.repos, scoped.repos, scope)
      expect(merged.map((record) => record.relPath)).toEqual(['other'])
    },
    60_000
  )
})

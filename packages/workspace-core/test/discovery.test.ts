import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { WorkspaceConfig } from '@gitreedesk/shared'
import { GitPool, runGitOrThrow } from '@gitreedesk/git-core'
import { defaultWorkspaceConfig } from '../src/config'
import { discoverRepositories } from '../src/discovery'

const IDENTITY = ['-c', 'user.name=GitTreeDesk Test', '-c', 'user.email=test@gitreedesk.invalid']

let dirs: string[] = []
let pools: GitPool[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'gtd-disc-'))
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

async function buildWorkspace(): Promise<{ parent: string; ws: string }> {
  const parent = await tempDir()
  const ws = join(parent, 'ws')
  await mkdir(ws, { recursive: true })

  await initRepo(join(ws, 'api-server'))
  await initRepo(join(ws, 'mobile-app'))
  await initRepo(join(ws, 'mobile-app', 'vendor', 'legacy-tool'))
  await initRepo(join(ws, 'node_modules', 'fake-repo'))
  await initRepo(join(ws, 'content', '中文文档', 'notes-repo'))

  await mkdir(join(ws, '__worktree__'), { recursive: true })
  await git(join(ws, 'mobile-app'), [
    'worktree',
    'add',
    '-q',
    join(ws, '__worktree__', 'mobile-app_wt-feat'),
    '-b',
    'feat'
  ])

  await mkdir(join(parent, 'external-wt'), { recursive: true })
  await git(join(ws, 'api-server'), [
    'worktree',
    'add',
    '-q',
    join(parent, 'external-wt', 'api-server_wt'),
    '-b',
    'wt-ext'
  ])

  const superRepo = join(ws, 'super')
  await initRepo(superRepo)
  const subSource = join(parent, 'sub-source')
  await initRepo(subSource)
  await git(superRepo, [
    '-c',
    'protocol.file.allow=always',
    'submodule',
    'add',
    '-q',
    subSource.replace(/\\/g, '/'),
    'libs/core'
  ])
  await git(superRepo, ['commit', '-q', '-m', 'add submodule'])

  // A directory that carries an (empty) `.git` without being a repository.
  await mkdir(join(ws, 'fake', '.git'), { recursive: true })
  return { parent, ws }
}

function testConfig(overrides: Partial<WorkspaceConfig> = {}): WorkspaceConfig {
  return { ...defaultWorkspaceConfig('acme'), exclude: ['content/中文文档'], ...overrides }
}

afterEach(async () => {
  for (const instance of pools) instance.dispose()
  pools = []
  for (const dir of dirs) await rm(dir, { recursive: true, force: true })
  dirs = []
})

describe('discoverRepositories', () => {
  it(
    'finds repositories, worktrees and submodules while skipping noisy or excluded folders',
    async () => {
      const { ws } = await buildWorkspace()
      const result = await discoverRepositories({ root: ws, config: testConfig(), pool: pool() })

      const byRel = new Map(result.repos.map((record) => [record.relPath, record]))
      const expected = [
        'api-server',
        'mobile-app',
        'mobile-app/vendor/legacy-tool',
        '__worktree__/mobile-app_wt-feat',
        'super',
        'super/libs/core',
        '../external-wt/api-server_wt'
      ]
      expect([...byRel.keys()].sort()).toEqual([...expected].sort())

      const mobile = byRel.get('mobile-app')
      const nested = byRel.get('mobile-app/vendor/legacy-tool')
      expect(nested?.kind).toBe('repository')
      expect(nested?.parentId).toBe(mobile?.id)

      const linked = byRel.get('__worktree__/mobile-app_wt-feat')
      expect(linked?.kind).toBe('worktree')
      expect(linked?.id).toBe(mobile?.id)
      expect(linked?.parentId).toBe(mobile?.id)
      expect(linked?.external).toBe(false)

      const api = byRel.get('api-server')
      const external = byRel.get('../external-wt/api-server_wt')
      expect(external?.kind).toBe('worktree')
      expect(external?.parentId).toBe(api?.id)
      expect(external?.external).toBe(true)

      const superRecord = byRel.get('super')
      const core = byRel.get('super/libs/core')
      expect(core?.kind).toBe('repository')
      expect(core?.parentId).toBe(superRecord?.id)
      expect(core?.id).not.toBe(superRecord?.id)
      expect(superRecord?.hasSubmodules).toBe(true)
      expect(api?.hasSubmodules).toBe(false)

      expect(result.issues.some((issue) => issue.includes('fake'))).toBe(true)
      expect(result.stats.repos).toBe(result.repos.length)
      expect(result.stats.budgetExceeded).toBe(false)
      expect(result.stats.dirsScanned).toBeGreaterThan(0)
    },
    120_000
  )

  it(
    'respects scan.maxDepth',
    async () => {
      const { ws } = await buildWorkspace()
      const config = testConfig()
      config.scan.maxDepth = 1

      const result = await discoverRepositories({ root: ws, config, pool: pool() })
      const rels = result.repos.map((record) => record.relPath)
      expect(rels).toContain('api-server')
      expect(rels).toContain('mobile-app')
      expect(rels).not.toContain('mobile-app/vendor/legacy-tool')
      expect(rels).not.toContain('super/libs/core')
      expect(result.stats.maxDepthReached).toBe(true)

      // Worktrees are attributed through `git worktree list` even when the scan never reaches them.
      expect(rels).toContain('__worktree__/mobile-app_wt-feat')
    },
    120_000
  )

  it(
    'stops at the directory budget',
    async () => {
      const { ws } = await buildWorkspace()
      const config = testConfig()
      config.scan.maxEntries = 3

      const result = await discoverRepositories({ root: ws, config, pool: pool() })
      expect(result.stats.budgetExceeded).toBe(true)
      expect(result.repos.length).toBeLessThan(7)
    },
    120_000
  )

  it(
    'follows symlinked folders only when configured',
    async () => {
      const parent = await tempDir()
      const ws = join(parent, 'ws')
      await mkdir(ws, { recursive: true })

      const target = join(parent, 'linked-target')
      await initRepo(target)

      const linkType = process.platform === 'win32' ? 'junction' : 'dir'
      try {
        await symlink(target, join(ws, 'linked'), linkType)
        await symlink(ws, join(ws, 'loop'), linkType)
      } catch {
        return
      }

      const off = await discoverRepositories({ root: ws, config: defaultWorkspaceConfig('acme'), pool: pool() })
      expect(off.repos).toHaveLength(0)

      const followConfig = defaultWorkspaceConfig('acme')
      followConfig.scan.followSymlinks = true
      const on = await discoverRepositories({ root: ws, config: followConfig, pool: pool() })
      expect(on.repos).toHaveLength(1)
      expect(on.repos[0]?.relPath).toBe('../linked-target')
      expect(on.repos[0]?.external).toBe(true)
    },
    60_000
  )

  it(
    'treats the workspace root itself as a repository when it has one',
    async () => {
      const root = await tempDir()
      await initRepo(root)
      await writeFile(join(root, 'readme.md'), 'hi\n')

      const result = await discoverRepositories({ root, config: defaultWorkspaceConfig('acme'), pool: pool() })
      expect(result.repos).toHaveLength(1)
      expect(result.repos[0]?.relPath).toBe('')
      expect(result.repos[0]?.kind).toBe('repository')
    },
    30_000
  )

  it(
    'discovers bare repositories by their shape without descending into them',
    async () => {
      const parent = await tempDir()
      const ws = join(parent, 'ws')
      await mkdir(ws, { recursive: true })
      await initRepo(join(ws, 'api-server'))

      const bare = join(ws, 'mirror.git')
      await mkdir(bare, { recursive: true })
      await git(bare, ['init', '-q', '--bare'])

      const result = await discoverRepositories({ root: ws, config: defaultWorkspaceConfig('acme'), pool: pool() })
      const byRel = new Map(result.repos.map((record) => [record.relPath, record]))
      expect([...byRel.keys()].sort()).toEqual(['api-server', 'mirror.git'])

      const record = byRel.get('mirror.git')
      expect(record?.kind).toBe('bare')
      expect(record?.gitDir).toBe(record?.path)
      expect(record?.id).toBe(record?.path)
      expect(record?.parentId).toBeNull()
      expect(record?.hasSubmodules).toBe(false)
    },
    60_000
  )
})

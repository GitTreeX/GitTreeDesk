import { describe, expect, it } from 'vitest'
import type { RepoRecord, WorkspaceConfig } from '@gitreedesk/shared'
import { WorkspaceRegistry, diffRepos, recordKey } from '../src/registry'

function record(overrides: Partial<RepoRecord> & { id: string; path: string }): RepoRecord {
  return {
    root: 'C:/ws',
    relPath: 'repo',
    gitDir: 'C:/ws/repo/.git',
    commonDir: 'C:/ws/repo/.git',
    kind: 'repository',
    parentId: null,
    name: 'repo',
    external: false,
    hasSubmodules: false,
    ...overrides
  }
}

const config = (overrides: Partial<WorkspaceConfig> = {}): WorkspaceConfig => ({
  name: 'acme',
  exclude: [],
  scan: { maxDepth: 8, maxEntries: 200_000, followSymlinks: false },
  groups: null,
  ...overrides
})

describe('diffRepos', () => {
  it('detects additions, removals and updates keyed by identity and path', () => {
    const main = record({ id: 'A', path: 'C:/ws/api', relPath: 'api', name: 'api' })
    const worktree = record({
      id: 'A',
      path: 'C:/ws/wt/api-feat',
      relPath: 'wt/api-feat',
      name: 'api-feat',
      kind: 'worktree',
      parentId: 'A'
    })
    const gone = record({ id: 'B', path: 'C:/ws/old', relPath: 'old', name: 'old' })

    expect(recordKey(main)).not.toBe(recordKey(worktree))

    const diff = diffRepos([main, worktree, gone], [main, { ...worktree, kind: 'repository', parentId: null }])
    expect(diff.added).toEqual([])
    expect(diff.removed.map((entry) => entry.relPath)).toEqual(['old'])
    expect(diff.updated.map((entry) => entry.path)).toEqual(['C:/ws/wt/api-feat'])

    const added = diffRepos([main], [main, worktree])
    expect(added.added.map((entry) => entry.path)).toEqual(['C:/ws/wt/api-feat'])
    expect(added.removed).toEqual([])
    expect(added.updated).toEqual([])
  })
})

describe('WorkspaceRegistry', () => {
  it('tracks roots, children and lookups', () => {
    const registry = new WorkspaceRegistry({ root: 'C:/ws', config: config() })
    const api = record({ id: 'A', path: 'C:/ws/api', relPath: 'api', name: 'api' })
    const apiWorktree = record({
      id: 'A',
      path: 'C:/ws/__worktree__/api_wt',
      relPath: '__worktree__/api_wt',
      name: 'api_wt',
      kind: 'worktree',
      parentId: 'A'
    })
    const nested = record({ id: 'B', path: 'C:/ws/api/vendor/tool', relPath: 'api/vendor/tool', name: 'tool', parentId: 'A' })

    registry.replace([api, apiWorktree, nested])

    expect(registry.size).toBe(3)
    expect(registry.findById('A')).toHaveLength(2)
    expect(registry.findByPath('C:/ws/api')).toEqual(api)
    expect(registry.children('A').map((entry) => entry.path).sort()).toEqual([
      'C:/ws/__worktree__/api_wt',
      'C:/ws/api/vendor/tool'
    ])
    expect(registry.roots().map((entry) => entry.path)).toEqual(['C:/ws/api'])
  })

  it('derives groups from configured matches, then the first path segment', () => {
    const registry = new WorkspaceRegistry({
      root: 'C:/ws',
      config: config({ groups: [{ name: 'Backend', match: ['backend/*'] }] })
    })
    const api = record({ id: 'A', path: 'C:/ws/backend/api-server', relPath: 'backend/api-server', name: 'api-server' })
    const worker = record({ id: 'B', path: 'C:/ws/backend/team/worker', relPath: 'backend/team/worker', name: 'worker' })
    const mobile = record({ id: 'C', path: 'C:/ws/mobile-app', relPath: 'mobile-app', name: 'mobile-app' })
    const atRoot = record({ id: 'D', path: 'C:/ws', relPath: '', name: 'ws' })

    registry.replace([api, worker, mobile, atRoot])

    const groups = new Map(registry.groups().map((group) => [group.name, group.repos.map((entry) => entry.name)]))
    expect(groups.get('Backend')).toEqual(['api-server', 'worker'])
    expect(groups.get('mobile-app')).toEqual(['mobile-app'])
    expect(groups.get('acme')).toEqual(['ws'])
  })
})

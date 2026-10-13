import { describe, expect, it } from 'vitest'
import type { RepoRecord, RepoStatus } from '@gitreedesk/shared'
import {
  buildReposTree,
  checkoutKey,
  isAheadBehind,
  isDirty,
  isSubmoduleRecord,
  type RepoFilters,
  type ReposRow
} from '../src/renderer/src/tree/repos-model'
import { nextSelectable, seekSelectable } from '../src/renderer/src/tree/nav'

const NO_FILTERS: RepoFilters = { dirty: false, aheadBehind: false, worktrees: false }

function record(partial: Partial<RepoRecord> & { path: string }): RepoRecord {
  const id = partial.id ?? `${partial.path}/.git`
  const kind = partial.kind ?? 'repository'
  const name = partial.name ?? (partial.path.split('/').pop() ?? partial.path)
  return {
    id,
    root: '/ws',
    relPath: partial.relPath ?? partial.path.replace('/ws/', ''),
    path: partial.path,
    // A linked worktree shares the main checkout's id but has its own git dir.
    gitDir: partial.gitDir ?? (kind === 'worktree' ? `${id}/worktrees/${name}` : id),
    commonDir: partial.commonDir ?? id,
    kind,
    parentId: partial.parentId ?? null,
    name,
    external: partial.external ?? false,
    hasSubmodules: partial.hasSubmodules ?? false
  }
}

function status(partial: Partial<RepoStatus> = {}): RepoStatus {
  return {
    head: { ref: 'main', sha: 'a'.repeat(40), detached: false, unborn: false },
    upstream: null,
    staged: [],
    unstaged: [],
    untracked: [],
    conflicted: [],
    operation: 'none',
    stashCount: 0,
    submodulesPresent: false,
    ...partial
  }
}

const noStatus = (): RepoStatus | null => null

function summarize(rows: ReposRow[]): string[] {
  return rows.map((row) =>
    row.type === 'group' ? `#${row.label}` : `${'  '.repeat(row.node.depth)}${row.node.record.name}`
  )
}

const baseOptions = {
  showExternal: false,
  filters: NO_FILTERS,
  groups: null,
  statusFor: noStatus,
  expanded: null
} as const

describe('buildReposTree', () => {
  it('derives groups from the first path segment and leaves root repositories ungrouped', () => {
    const records = [
      record({ path: '/ws/api-server' }),
      record({ path: '/ws/backend/api' }),
      record({ path: '/ws/backend/worker' }),
      record({ path: '/ws/frontend/site' })
    ]
    expect(summarize(buildReposTree(records, baseOptions))).toEqual([
      'api-server',
      '#backend',
      'api',
      'worker',
      '#frontend',
      'site'
    ])
  })

  it('uses configured groups in configuration order', () => {
    const records = [
      record({ path: '/ws/backend/api' }),
      record({ path: '/ws/client/web' }),
      record({ path: '/ws/tools/cli' })
    ]
    const rows = buildReposTree(records, {
      ...baseOptions,
      groups: [
        { name: 'Apps', match: ['client/*'] },
        { name: 'Services', match: ['backend/*'] }
      ]
    })
    // Ungrouped checkouts render first, before any group header.
    expect(summarize(rows)).toEqual(['cli', '#Apps', 'web', '#Services', 'api'])
  })

  it('nests linked worktrees under the main checkout', () => {
    const main = record({ path: '/ws/app' })
    const worktree = record({
      path: '/ws/__worktree__/app_feat',
      id: main.id,
      parentId: main.id,
      kind: 'worktree'
    })
    const rows = buildReposTree([main, worktree], baseOptions)
    expect(summarize(rows)).toEqual(['app', '  app_feat'])
    const repos = rows.filter((row) => row.type === 'repo')
    expect(repos[0]?.node.hasWorktreeChildren).toBe(true)
    expect(repos[1]?.node.depth).toBe(1)
    expect(repos[1]?.node.isMain).toBe(false)
  })

  it('nests submodule checkouts and marks them', () => {
    const superproject = record({ path: '/ws/super', hasSubmodules: true })
    const submodule = record({
      path: '/ws/super/lib/dep',
      id: `${superproject.id}/modules/lib/dep`,
      parentId: superproject.id,
      commonDir: `${superproject.id}/modules/lib/dep`
    })
    const rows = buildReposTree([superproject, submodule], baseOptions)
    const repos = rows.filter((row) => row.type === 'repo')
    expect(repos).toHaveLength(2)
    expect(repos[1]?.node.isSubmodule).toBe(true)
    expect(repos[1]?.node.depth).toBe(1)
    expect(isSubmoduleRecord(submodule)).toBe(true)
  })

  it('hides external worktrees unless enabled', () => {
    const main = record({ path: '/ws/app' })
    const external = record({
      path: '/elsewhere/app_hotfix',
      id: main.id,
      parentId: main.id,
      kind: 'worktree',
      external: true,
      relPath: '../app_hotfix'
    })
    const hidden = buildReposTree([main, external], baseOptions)
    expect(hidden.filter((row) => row.type === 'repo')).toHaveLength(1)
    const shown = buildReposTree([main, external], { ...baseOptions, showExternal: true })
    expect(shown.filter((row) => row.type === 'repo')).toHaveLength(2)
  })

  it('keeps hasChildren when collapsed but hides the children', () => {
    const main = record({ path: '/ws/app' })
    const worktree = record({
      path: '/ws/__worktree__/app_feat',
      id: main.id,
      parentId: main.id,
      kind: 'worktree'
    })
    const rows = buildReposTree([main, worktree], { ...baseOptions, expanded: new Set<string>() })
    const repos = rows.filter((row) => row.type === 'repo')
    expect(repos).toHaveLength(1)
    expect(repos[0]?.node.hasChildren).toBe(true)
    expect(repos[0]?.node.expanded).toBe(false)
  })

  it('filters on dirty, ahead/behind and worktrees with AND semantics', () => {
    const clean = record({ path: '/ws/clean' })
    const dirtyMain = record({ path: '/ws/dirty' })
    const dirtyWorktree = record({
      path: '/ws/__worktree__/dirty_feat',
      id: dirtyMain.id,
      parentId: dirtyMain.id,
      kind: 'worktree'
    })
    const synced = record({ path: '/ws/synced' })
    const statuses = new Map<string, RepoStatus>([
      [dirtyMain.gitDir, status({ unstaged: [{ path: 'a.ts', kind: 'modified' }] })],
      [dirtyWorktree.gitDir, status()],
      [synced.gitDir, status({ upstream: { ref: 'origin/main', ahead: 2, behind: 1 } })]
    ])
    const options = {
      ...baseOptions,
      statusFor: (candidate: RepoRecord) => statuses.get(candidate.gitDir) ?? null
    }

    expect(summarize(buildReposTree([clean, dirtyMain, dirtyWorktree, synced], {
      ...options,
      filters: { ...NO_FILTERS, dirty: true }
    }))).toEqual(['dirty', '  dirty_feat'])

    expect(summarize(buildReposTree([clean, dirtyMain, dirtyWorktree, synced], {
      ...options,
      filters: { ...NO_FILTERS, aheadBehind: true }
    }))).toEqual(['synced'])

    expect(summarize(buildReposTree([clean, dirtyMain, dirtyWorktree, synced], {
      ...options,
      filters: { ...NO_FILTERS, worktrees: true }
    }))).toEqual(['dirty', '  dirty_feat'])

    expect(summarize(buildReposTree([clean, dirtyMain, dirtyWorktree, synced], {
      ...options,
      filters: { dirty: true, aheadBehind: false, worktrees: true }
    }))).toEqual(['dirty', '  dirty_feat'])
  })
})

describe('status helpers', () => {
  it('detects dirty and ahead/behind states', () => {
    expect(isDirty(status())).toBe(false)
    expect(isDirty(status({ untracked: ['a.ts'] }))).toBe(true)
    expect(isDirty(status({ conflicted: [{ path: 'a.ts', code: 'UU' }] }))).toBe(true)
    expect(isAheadBehind(status())).toBe(false)
    expect(isAheadBehind(status({ upstream: { ref: 'origin/main', ahead: 0, behind: 3 } }))).toBe(true)
  })

  it('derives the SCM checkout key', () => {
    const withGitDir = record({ path: '/ws/app' })
    expect(checkoutKey(withGitDir)).toBe(withGitDir.gitDir)
    const unresolved = record({ path: '/ws/app', gitDir: '' })
    expect(checkoutKey(unresolved)).toBe('/ws/app')
  })
})

describe('tree navigation', () => {
  const rows = [{ selectable: false }, { selectable: true }, { selectable: false }, { selectable: true }]
  const isSelectable = (row: (typeof rows)[number]): boolean => row.selectable

  it('steps over non-selectable rows', () => {
    expect(nextSelectable(rows, 1, 1, isSelectable)).toBe(3)
    expect(nextSelectable(rows, 3, -1, isSelectable)).toBe(1)
  })

  it('stays put at the edges', () => {
    expect(nextSelectable(rows, 3, 1, isSelectable)).toBe(3)
    expect(nextSelectable(rows, 1, -1, isSelectable)).toBe(1)
  })

  it('seeks the first selectable row from a position', () => {
    expect(seekSelectable(rows, 0, 1, isSelectable)).toBe(1)
    expect(seekSelectable(rows, 3, -1, isSelectable)).toBe(3)
    expect(seekSelectable([{ selectable: false }], 0, 1, isSelectable)).toBe(-1)
  })
})

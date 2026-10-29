import { describe, expect, it } from 'vitest'
import type { RepoRecord, RepoStatus } from '@gitreedesk/shared'
import {
  buildScmModel,
  DEFAULT_SCM_GROUPS,
  groupCollapseKey,
  repoCollapseKey,
  stagePathspecs,
  unstagePathspecs,
  UNTRACKED_PAGE,
  type ScmModelOptions,
  type ScmRow
} from '../src/renderer/src/tree/scm-model'

function record(partial: Partial<RepoRecord> & { path: string }): RepoRecord {
  const id = partial.id ?? `${partial.path}/.git`
  const kind = partial.kind ?? 'repository'
  const name = partial.name ?? (partial.path.split('/').pop() ?? partial.path)
  return {
    id,
    root: '/ws',
    relPath: partial.relPath ?? partial.path.replace('/ws/', ''),
    path: partial.path,
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

function options(overrides: Partial<ScmModelOptions> = {}): ScmModelOptions {
  return {
    records: [],
    statusFor: () => null,
    isSelected: () => true,
    onlySelected: true,
    groups: DEFAULT_SCM_GROUPS,
    ...overrides
  }
}

function pathsOf(row: ScmRow[] | undefined): string[] {
  return (row ?? []).map((entry) => entry.path)
}

describe('buildScmModel', () => {
  it('lists dirty repositories with group order conflicts, staged, unstaged, untracked', () => {
    const repo = record({ path: '/ws/app' })
    const model = buildScmModel(
      options({
        records: [repo],
        statusFor: () =>
          status({
            conflicted: [{ path: 'c.txt', code: 'UU' }],
            staged: [{ path: 'b.txt', kind: 'added' }],
            unstaged: [{ path: 'a.txt', kind: 'modified' }],
            untracked: ['notes/']
          })
      })
    )

    expect(model).toHaveLength(1)
    const section = model[0]
    expect(section?.record.path).toBe('/ws/app')
    expect(section?.groups.map((group) => group.group)).toEqual([
      'conflicts',
      'staged',
      'unstaged',
      'untracked'
    ])
    expect(section?.groups.map((group) => group.rows[0]?.letter)).toEqual(['!', 'A', 'M', 'U'])
    expect(section?.groups[3]?.rows[0]?.name).toBe('notes')
    expect(section?.groups[3]?.rows[0]?.path).toBe('notes/')
    expect(section?.groups[3]?.rows[0]?.dir).toBe('')
    expect(section?.groups[1]?.rows[0]?.kind).toBe('added')
  })

  it('hides clean repositories and keeps reproducibility of the checkout key', () => {
    const clean = record({ path: '/ws/lib' })
    const dirty = record({ path: '/ws/app' })
    const model = buildScmModel(
      options({
        records: [clean, dirty],
        statusFor: (target) => (target.path === '/ws/app' ? status({ untracked: ['x.txt'] }) : status())
      })
    )
    expect(model.map((section) => section.record.path)).toEqual(['/ws/app'])
    expect(model[0]?.key).toBe(dirty.gitDir)
  })

  it('filters by the Repos view selection unless an operation is unfinished', () => {
    const deselected = record({ path: '/ws/app' })
    const operating = record({ path: '/ws/backend' })
    const model = buildScmModel(
      options({
        records: [deselected, operating],
        isSelected: (key) => key !== deselected.gitDir,
        statusFor: (target) =>
          target.path === '/ws/app'
            ? status({ unstaged: [{ path: 'a.txt', kind: 'modified' }] })
            : status({ operation: 'merge', conflicted: [{ path: 'b.txt', code: 'UU' }] })
      })
    )
    expect(model.map((section) => section.record.path)).toEqual(['/ws/backend'])
    expect(model[0]?.operation).toBe('merge')
  })

  it('shows unfinished operations even without any pending change', () => {
    const repo = record({ path: '/ws/app' })
    const model = buildScmModel(
      options({
        records: [repo],
        statusFor: () => status({ operation: 'rebase' })
      })
    )
    expect(model).toHaveLength(1)
    expect(model[0]?.groups).toEqual([])
    expect(model[0]?.operation).toBe('rebase')
  })

  it('keeps a clean detached checkout listed regardless of the Repos selection filter', () => {
    const repo = record({ path: '/ws/app' })
    const model = buildScmModel(
      options({
        records: [repo],
        isSelected: () => false,
        statusFor: () =>
          status({ head: { ref: null, sha: 'c'.repeat(40), detached: true, unborn: false } })
      })
    )
    expect(model).toHaveLength(1)
    expect(model[0]?.groups).toEqual([])
    expect(model[0]?.operation).toBe('none')
  })

  it('drops hidden groups but counts every change', () => {
    const repo = record({ path: '/ws/app' })
    const model = buildScmModel(
      options({
        records: [repo],
        groups: { ...DEFAULT_SCM_GROUPS, untracked: false },
        statusFor: () =>
          status({
            staged: [{ path: 'b.txt', kind: 'modified' }],
            untracked: ['x.txt', 'y.txt']
          })
      })
    )
    expect(model[0]?.groups.map((group) => group.group)).toEqual(['staged'])
    expect(model[0]?.counts.untracked).toBe(2)
  })

  it('caps untracked rows and reports the remainder', () => {
    const repo = record({ path: '/ws/app' })
    const untracked = Array.from({ length: UNTRACKED_PAGE + 7 }, (_, index) => `f${index}.txt`)
    const model = buildScmModel(
      options({
        records: [repo],
        statusFor: () => status({ untracked })
      })
    )
    expect(model[0]?.groups[0]?.rows).toHaveLength(UNTRACKED_PAGE)
    expect(model[0]?.groups[0]?.hidden).toBe(7)
  })

  it('sorts repositories by relative path', () => {
    const records = [
      record({ path: '/ws/backend/worker', relPath: 'backend/worker' }),
      record({ path: '/ws/app', relPath: 'app' })
    ]
    const model = buildScmModel(
      options({
        records,
        statusFor: () => status({ untracked: ['x.txt'] })
      })
    )
    expect(model.map((section) => section.record.relPath)).toEqual(['app', 'backend/worker'])
  })
})

describe('collapse keys', () => {
  it('namespaces repository and group headers by checkout key', () => {
    expect(repoCollapseKey('/ws/app/.git')).toBe('repo:/ws/app/.git')
    expect(groupCollapseKey('/ws/app/.git', 'unstaged')).toBe('group:/ws/app/.git:unstaged')
  })
})

describe('pathspec helpers', () => {
  it('stagePathspecs skips staged rows and de-duplicates', () => {
    const rows: ScmRow[] = [
      { id: 'u\0a.txt', group: 'untracked', kind: 'untracked', path: 'a.txt', name: 'a.txt', dir: '', letter: 'U' },
      { id: 'w\0a.txt', group: 'unstaged', kind: 'modified', path: 'a.txt', name: 'a.txt', dir: '', letter: 'M' },
      { id: 's\0b.txt', group: 'staged', kind: 'modified', path: 'b.txt', name: 'b.txt', dir: '', letter: 'M' }
    ]
    expect(stagePathspecs(rows)).toEqual(['a.txt'])
  })

  it('unstagePathspecs includes both sides of a staged rename', () => {
    const rows: ScmRow[] = [
      {
        id: 's\0new.txt',
        group: 'staged',
        kind: 'renamed',
        path: 'new.txt',
        name: 'new.txt',
        dir: '',
        letter: 'R',
        origPath: 'old.txt'
      },
      { id: 'w\0a.txt', group: 'unstaged', kind: 'modified', path: 'a.txt', name: 'a.txt', dir: '', letter: 'M' }
    ]
    expect(unstagePathspecs(rows)).toEqual(['new.txt', 'old.txt'])
  })
})

describe('row reshape helpers via model', () => {
  it('splits nested paths into name and directory', () => {
    const repo = record({ path: '/ws/app' })
    const model = buildScmModel(
      options({
        records: [repo],
        statusFor: () => status({ unstaged: [{ path: 'content/中文 文档/笔记.md', kind: 'modified' }] })
      })
    )
    const row = model[0]?.groups[0]?.rows[0]
    expect(row?.name).toBe('笔记.md')
    expect(row?.dir).toBe('content/中文 文档')
  })
})

import type { ChangeKind, RepoOperationKind, RepoRecord, RepoStatus } from '@gitreedesk/shared'
import { checkoutKey } from './repos-model'

export type ScmGroup = 'conflicts' | 'staged' | 'unstaged' | 'untracked'

/** Display order of the groups inside one repository section. */
export const SCM_GROUPS: readonly ScmGroup[] = ['conflicts', 'staged', 'unstaged', 'untracked']

export type ScmGroupVisibility = Record<ScmGroup, boolean>

export const DEFAULT_SCM_GROUPS: ScmGroupVisibility = {
  conflicts: true,
  staged: true,
  unstaged: true,
  untracked: true
}

export type ScmRowKind = ChangeKind | 'untracked' | 'conflict'

export interface ScmRow {
  /** Unique inside a repository section: `<group>\0<path>`. */
  id: string
  group: ScmGroup
  kind: ScmRowKind
  /** Repo-relative path; untracked directories keep their trailing slash. */
  path: string
  name: string
  dir: string
  /** Single-letter status marker. */
  letter: string
  origPath?: string
}

export interface ScmGroupBlock {
  group: ScmGroup
  rows: ScmRow[]
  /** Rows withheld by the untracked cap; zero for every other group. */
  hidden: number
}

export interface ScmRepoSection {
  /** Checkout key, the same key the Repos view uses for its checkbox. */
  key: string
  record: RepoRecord
  operation: RepoOperationKind
  groups: ScmGroupBlock[]
  counts: Record<ScmGroup, number>
}

export const UNTRACKED_PAGE = 200

const LETTER_BY_KIND: Record<ScmRowKind, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  typeChanged: 'T',
  untracked: 'U',
  conflict: '!'
}

export interface ScmModelOptions {
  records: readonly RepoRecord[]
  statusFor: (record: RepoRecord) => RepoStatus | null
  /** Checkout key selected in the Repos view (not filtered out). */
  isSelected: (key: string) => boolean
  /** When true, repositories that are not checked in the Repos view are omitted. */
  onlySelected: boolean
  groups: ScmGroupVisibility
  /** Per-repository untracked cap; defaults to {@link UNTRACKED_PAGE}. */
  untrackedLimitFor?: (key: string) => number
}

function nameOf(path: string): string {
  const trimmed = path.endsWith('/') ? path.slice(0, -1) : path
  const slash = trimmed.lastIndexOf('/')
  return slash === -1 ? trimmed : trimmed.slice(slash + 1)
}

function dirOf(path: string): string {
  const trimmed = path.endsWith('/') ? path.slice(0, -1) : path
  const slash = trimmed.lastIndexOf('/')
  return slash === -1 ? '' : trimmed.slice(0, slash)
}

function makeRow(group: ScmGroup, path: string, kind: ScmRowKind, origPath?: string): ScmRow {
  return {
    id: `${group}\u0000${path}`,
    group,
    kind,
    path,
    name: nameOf(path),
    dir: dirOf(path),
    letter: LETTER_BY_KIND[kind],
    ...(origPath === undefined ? {} : { origPath })
  }
}

function byPath(rows: ScmRow[]): ScmRow[] {
  return rows.sort((a, b) => a.path.localeCompare(b.path))
}

/**
 * Builds the Source Control rows: one section per checkout with changes. Repositories
 * with an unfinished operation are always listed; the rest can be narrowed to the
 * checkboxes of the Repos view and are hidden when clean.
 */
export function buildScmModel(options: ScmModelOptions): ScmRepoSection[] {
  const records = [...options.records].sort((a, b) => a.relPath.localeCompare(b.relPath))
  const sections: ScmRepoSection[] = []

  for (const record of records) {
    const status = options.statusFor(record)
    if (status === null) continue

    const key = checkoutKey(record)
    const counts: Record<ScmGroup, number> = {
      conflicts: status.conflicted.length,
      staged: status.staged.length,
      unstaged: status.unstaged.length,
      untracked: status.untracked.length
    }
    const total = counts.conflicts + counts.staged + counts.unstaged + counts.untracked
    const hasOperation = status.operation !== 'none'

    if (!hasOperation) {
      if (total === 0) continue
      if (options.onlySelected && !options.isSelected(key)) continue
    }

    const groups: ScmGroupBlock[] = []
    if (options.groups.conflicts && counts.conflicts > 0) {
      groups.push({
        group: 'conflicts',
        rows: byPath(status.conflicted.map((entry) => makeRow('conflicts', entry.path, 'conflict'))),
        hidden: 0
      })
    }
    if (options.groups.staged && counts.staged > 0) {
      groups.push({
        group: 'staged',
        rows: byPath(
          status.staged.map((change) => makeRow('staged', change.path, change.kind, change.origPath))
        ),
        hidden: 0
      })
    }
    if (options.groups.unstaged && counts.unstaged > 0) {
      groups.push({
        group: 'unstaged',
        rows: byPath(
          status.unstaged.map((change) => makeRow('unstaged', change.path, change.kind, change.origPath))
        ),
        hidden: 0
      })
    }
    if (options.groups.untracked && counts.untracked > 0) {
      const limit = options.untrackedLimitFor?.(key) ?? UNTRACKED_PAGE
      const all = byPath(status.untracked.map((path) => makeRow('untracked', path, 'untracked')))
      const rows = all.slice(0, Math.max(0, limit))
      groups.push({ group: 'untracked', rows, hidden: all.length - rows.length })
    }

    if (groups.length === 0 && !hasOperation) continue
    sections.push({ key, record, operation: status.operation, groups, counts })
  }

  return sections
}

/** Pathspecs that stage the current content of the rows (skips already-staged rows). */
export function stagePathspecs(rows: readonly ScmRow[]): string[] {
  const paths = new Set<string>()
  for (const row of rows) {
    if (row.group === 'staged') continue
    paths.add(row.path)
  }
  return [...paths]
}

/** Pathspecs that undo staging; a staged rename needs both of its sides. */
export function unstagePathspecs(rows: readonly ScmRow[]): string[] {
  const paths = new Set<string>()
  for (const row of rows) {
    if (row.group !== 'staged') continue
    paths.add(row.path)
    if (row.origPath !== undefined) paths.add(row.origPath)
  }
  return [...paths]
}

import type { RepoRecord, RepoStatus, WorkspaceGroup } from '@gitreedesk/shared'
import { matchesAnyGlob } from './glob'

export interface RepoFilters {
  dirty: boolean
  aheadBehind: boolean
  worktrees: boolean
}

export interface RepoNode {
  /** Unique per checkout: its absolute path. */
  key: string
  record: RepoRecord
  depth: number
  isMain: boolean
  isSubmodule: boolean
  hasChildren: boolean
  hasWorktreeChildren: boolean
  expanded: boolean
  childCount: number
}

export type ReposRow =
  | { type: 'group'; key: string; label: string }
  | { type: 'repo'; key: string; node: RepoNode }
  | {
      type: 'pendingSubmodule'
      key: string
      /** Repo-relative path of the submodule inside its parent. */
      path: string
      name: string
      depth: number
      parent: RepoRecord
    }

/** An uninitialized submodule shown as a greyed placeholder row. */
export interface PendingSubmodule {
  /** Repo-relative path of the submodule inside its parent. */
  path: string
  name: string
}

export interface ReposTreeOptions {
  showExternal: boolean
  filters: RepoFilters
  groups: WorkspaceGroup[] | null
  statusFor: (record: RepoRecord) => RepoStatus | null
  /** `null` expands everything that has children. */
  expanded: ReadonlySet<string> | null
  /** Uninitialized submodule placeholders, keyed by the parent checkout path. */
  pendingSubmodules?: ReadonlyMap<string, readonly PendingSubmodule[]>
}

export function isDirty(status: RepoStatus): boolean {
  return (
    status.staged.length + status.unstaged.length + status.untracked.length + status.conflicted.length > 0
  )
}

export function isAheadBehind(status: RepoStatus): boolean {
  return status.upstream !== null && status.upstream.ahead + status.upstream.behind > 0
}

/** Submodule checkouts live under `<superproject git dir>/modules/`. */
export function isSubmoduleRecord(record: RepoRecord): boolean {
  return record.parentId !== null && record.id.startsWith(`${record.parentId}/modules/`)
}

/** The superproject checkout a submodule record is nested in; from the record set. */
export function submoduleParentOf(
  record: RepoRecord,
  records: readonly RepoRecord[]
): RepoRecord | null {
  if (record.parentId === null) return null
  let best: RepoRecord | null = null
  for (const candidate of records) {
    if (candidate.id !== record.parentId) continue
    if (!record.path.startsWith(`${candidate.path}/`)) continue
    if (best === null || candidate.path.length > best.path.length) best = candidate
  }
  return best
}

export function hasActiveFilters(filters: RepoFilters): boolean {
  return filters.dirty || filters.aheadBehind || filters.worktrees
}

/**
 * Builds the logical tree: groups of top-level checkouts with linked worktrees
 * and submodule checkouts nested under the checkout that contains them.
 */
export function buildReposTree(
  records: readonly RepoRecord[],
  options: ReposTreeOptions
): ReposRow[] {
  const childrenOf = new Map<string, RepoRecord[]>()
  const tops: RepoRecord[] = []

  for (const record of records) {
    const parent = record.parentId === null ? null : findParentRecord(record, records)
    if (parent === null) {
      tops.push(record)
      continue
    }
    const siblings = childrenOf.get(parent.path)
    if (siblings === undefined) childrenOf.set(parent.path, [record])
    else siblings.push(record)
  }

  const visibleTops = tops.filter((record) => matchesTree(record, childrenOf, options))
  const ungrouped: RepoRecord[] = []
  const grouped = new Map<string, { label: string; records: RepoRecord[] }>()

  for (const record of visibleTops) {
    const group = groupFor(record, options.groups)
    if (group === null) {
      ungrouped.push(record)
      continue
    }
    const bucket = grouped.get(group.id)
    if (bucket === undefined) grouped.set(group.id, { label: group.label, records: [record] })
    else bucket.records.push(record)
  }

  const rows: ReposRow[] = []
  for (const record of ungrouped) pushRepoRow(rows, record, 0, childrenOf, options)
  for (const id of groupOrder(grouped, options.groups)) {
    const bucket = grouped.get(id)
    if (bucket === undefined) continue
    rows.push({ type: 'group', key: `group:${id}`, label: bucket.label })
    for (const record of bucket.records) pushRepoRow(rows, record, 0, childrenOf, options)
  }
  return rows
}

function findParentRecord(record: RepoRecord, records: readonly RepoRecord[]): RepoRecord | null {
  const candidates = records.filter((other) => other !== record && other.id === record.parentId)
  if (candidates.length === 0) return null

  let best: RepoRecord | null = null
  for (const candidate of candidates) {
    if (!record.path.startsWith(`${candidate.path}/`)) continue
    if (best === null || candidate.path.length > best.path.length) best = candidate
  }
  if (best !== null) return best

  // A linked worktree sits beside (not inside) its main checkout.
  return candidates.find((candidate) => candidate.kind !== 'worktree') ?? candidates[0] ?? null
}

function isVisibleRecord(record: RepoRecord, options: ReposTreeOptions): boolean {
  return options.showExternal || !record.external
}

function matchesTree(
  record: RepoRecord,
  childrenOf: ReadonlyMap<string, RepoRecord[]>,
  options: ReposTreeOptions
): boolean {
  if (!isVisibleRecord(record, options)) return false
  const { filters } = options
  if (!hasActiveFilters(filters)) return true
  if (
    filters.dirty &&
    !subtreeHas(record, childrenOf, options, (candidate) => {
      const status = options.statusFor(candidate)
      return status !== null && isDirty(status)
    })
  ) {
    return false
  }
  if (
    filters.aheadBehind &&
    !subtreeHas(record, childrenOf, options, (candidate) => {
      const status = options.statusFor(candidate)
      return status !== null && isAheadBehind(status)
    })
  ) {
    return false
  }
  if (
    filters.worktrees &&
    !subtreeHas(record, childrenOf, options, (candidate) => candidate.kind === 'worktree')
  ) {
    return false
  }
  return true
}

function subtreeHas(
  record: RepoRecord,
  childrenOf: ReadonlyMap<string, RepoRecord[]>,
  options: ReposTreeOptions,
  predicate: (record: RepoRecord) => boolean
): boolean {
  if (predicate(record)) return true
  const children = childrenOf.get(record.path) ?? []
  return children.some(
    (child) => isVisibleRecord(child, options) && subtreeHas(child, childrenOf, options, predicate)
  )
}

function groupFor(record: RepoRecord, groups: WorkspaceGroup[] | null): { id: string; label: string } | null {
  const rel = record.relPath
  if (rel === '') return null
  if (groups !== null) {
    for (const group of groups) {
      if (matchesAnyGlob(group.match, rel)) return { id: group.name, label: group.name }
    }
    return null
  }
  const segment = rel.split('/')[0]
  if (segment === undefined || !rel.includes('/')) return null
  return { id: segment, label: segment }
}

function groupOrder(
  grouped: ReadonlyMap<string, { label: string }>,
  groups: WorkspaceGroup[] | null
): string[] {
  const ids = [...grouped.keys()]
  if (groups !== null) {
    const order: string[] = []
    for (const group of groups) {
      if (grouped.has(group.name)) order.push(group.name)
    }
    for (const id of ids) {
      if (!order.includes(id)) order.push(id)
    }
    return order
  }
  return ids.sort((a, b) => a.localeCompare(b))
}

function pushRepoRow(
  rows: ReposRow[],
  record: RepoRecord,
  depth: number,
  childrenOf: ReadonlyMap<string, RepoRecord[]>,
  options: ReposTreeOptions
): void {
  if (!isVisibleRecord(record, options)) return
  const children = (childrenOf.get(record.path) ?? []).filter((child) =>
    isVisibleRecord(child, options)
  )
  const pending = options.pendingSubmodules?.get(record.path) ?? []
  const expanded = options.expanded === null ? true : options.expanded.has(record.path)

  rows.push({
    type: 'repo',
    key: record.path,
    node: {
      key: record.path,
      record,
      depth,
      isMain: record.kind !== 'worktree',
      isSubmodule: isSubmoduleRecord(record),
      hasChildren: children.length > 0 || pending.length > 0,
      hasWorktreeChildren: children.some((child) => child.kind === 'worktree'),
      expanded,
      childCount: children.length + pending.length
    }
  })

  if (!expanded) return
  for (const child of children) pushRepoRow(rows, child, depth + 1, childrenOf, options)
  for (const item of pending) {
    rows.push({
      type: 'pendingSubmodule',
      key: `${record.path}\u0000${item.path}`,
      path: item.path,
      name: item.name,
      depth: depth + 1,
      parent: record
    })
  }
}

/** Checkout key used by the SCM selection: the git dir, or the path when unresolved. */
export function checkoutKey(record: RepoRecord): string {
  return record.gitDir.length > 0 ? record.gitDir : record.path
}

import type { FsEntry } from '@gitreedesk/shared'

export interface ExplorerRow {
  path: string
  name: string
  kind: FsEntry['kind']
  depth: number
  /** Kind folders expand; symlinks never do (discovery ignores them). */
  expandable: boolean
  expanded: boolean
}

/** Folders first, then a locale-aware compare (numbers sort naturally). */
export function sortEntries(entries: readonly FsEntry[], collator: Intl.Collator): FsEntry[] {
  return [...entries].sort((a, b) => {
    const groupA = a.kind === 'dir' ? 0 : 1
    const groupB = b.kind === 'dir' ? 0 : 1
    if (groupA !== groupB) return groupA - groupB
    return collator.compare(a.name, b.name)
  })
}

/**
 * Flattens the visible tree: children of the root plus the children of every
 * expanded loaded folder, depth-first in display order.
 */
export function visibleRows(
  root: string,
  childrenByPath: ReadonlyMap<string, readonly FsEntry[]>,
  expanded: ReadonlySet<string>,
  collator: Intl.Collator
): ExplorerRow[] {
  const rows: ExplorerRow[] = []

  const walk = (dir: string, depth: number): void => {
    const entries = childrenByPath.get(dir)
    if (entries === undefined) return
    for (const entry of sortEntries(entries, collator)) {
      const expandable = entry.kind === 'dir'
      const isExpanded = expandable && expanded.has(entry.path)
      rows.push({
        path: entry.path,
        name: entry.name,
        kind: entry.kind,
        depth,
        expandable,
        expanded: isExpanded
      })
      if (isExpanded) walk(entry.path, depth + 1)
    }
  }

  walk(root, 0)
  return rows
}

/** Ancestors of a path up to (excluding) the root, outermost first. */
export function ancestorsWithin(root: string, path: string): string[] {
  if (!path.startsWith(`${root}/`)) return []
  const segments = path.slice(root.length + 1).split('/')
  segments.pop()
  const ancestors: string[] = []
  let current = root
  for (const segment of segments) {
    current = `${current}/${segment}`
    ancestors.push(current)
  }
  return ancestors
}

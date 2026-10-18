import type { DiffSource, GitRef } from '@gitreedesk/shared'
import type { ContextMenuItem } from '../components/ContextMenu'

/** Caps the base list so a repository with hundreds of refs still fits the menu. */
export const MAX_COMPARE_REFS = 40

export function sameSource(a: DiffSource, b: DiffSource): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind !== 'rev') return true
  return (a.rev ?? 'HEAD') === (b.rev ?? 'HEAD')
}

export const INDEX_SOURCE: DiffSource = { kind: 'index' }
export const HEAD_SOURCE: DiffSource = { kind: 'rev', rev: 'HEAD' }
export const WORKTREE_SOURCE: DiffSource = { kind: 'worktree' }

/** How a side reads in a title: `INDEX`, `HEAD`, or the revision it names. */
export function sourceLabel(source: DiffSource): string {
  if (source.kind === 'index') return 'INDEX'
  if (source.kind === 'worktree') return 'WORKTREE'
  return source.rev ?? 'HEAD'
}

/**
 * The shared "Compare with…" list: the index, `HEAD`, then branches and tags.
 * `isCurrent` greys out the side a view is already showing.
 */
export function compareSourceItems(options: {
  refs: readonly GitRef[] | null
  isCurrent: (source: DiffSource) => boolean
  onPick: (source: DiffSource) => void
}): ContextMenuItem[] {
  const items: ContextMenuItem[] = [
    { label: 'INDEX', disabled: options.isCurrent(INDEX_SOURCE), onSelect: () => options.onPick(INDEX_SOURCE) },
    { label: 'HEAD', disabled: options.isCurrent(HEAD_SOURCE), onSelect: () => options.onPick(HEAD_SOURCE) }
  ]
  for (const ref of options.refs ?? []) {
    if (items.length >= MAX_COMPARE_REFS) break
    const source: DiffSource = { kind: 'rev', rev: ref.name }
    items.push({
      label: ref.name,
      disabled: options.isCurrent(source),
      onSelect: () => options.onPick(source)
    })
  }
  return items
}

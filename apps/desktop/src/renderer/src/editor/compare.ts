import type { FsReadFileResponse } from '@gitreedesk/shared'

/** Absolute paths in the order a compare tab shows them: the earlier path on the left. */
export function compareOrder(first: string, second: string): [string, string] {
  return first <= second ? [first, second] : [second, first]
}

/**
 * Keyed by the sorted pair, so "compare A with B" and "compare B with A" share one tab
 * and reopening the same pair from either side does not stack duplicates.
 */
export function compareTabId(first: string, second: string): string {
  const [left, right] = compareOrder(first, second)
  return `compare:${left}\u0000${right}`
}

export type CompareView =
  | { kind: 'text' }
  | { kind: 'images' }
  | { kind: 'tooLarge' }
  | { kind: 'missing'; paths: readonly string[] }
  | { kind: 'other' }

/** What a loaded pair can honestly be shown as. */
export function compareViewFor(
  paths: readonly [string, string],
  sides: readonly [FsReadFileResponse, FsReadFileResponse]
): CompareView {
  const missing = paths.filter((_, index) => sides[index]?.exists !== true)
  if (missing.length > 0) return { kind: 'missing', paths: missing }
  if (sides.some((side) => side.kind === 'tooLarge')) return { kind: 'tooLarge' }
  const kinds = new Set(sides.map((side) => side.kind))
  if (kinds.size === 1 && kinds.has('text')) return { kind: 'text' }
  if (kinds.size === 1 && kinds.has('image')) return { kind: 'images' }
  return { kind: 'other' }
}

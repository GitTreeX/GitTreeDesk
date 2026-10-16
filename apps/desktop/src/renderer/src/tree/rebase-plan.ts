import type { RebaseAction } from '@gitreedesk/shared'

/** One step of a scripted interactive rebase, in replay order (oldest first). */
export interface PlanRow {
  sha: string
  subject: string
  action: RebaseAction
  /** Replacement message of a `reword`; prefilled with the subject. */
  message: string
}

/**
 * Reorder for a drag that starts at `from` and lands on the row currently at `to`, so the moved
 * row ends up at index `to` and the rows it crossed shift by one.
 */
export function moveRow(rows: readonly PlanRow[], from: number, to: number): PlanRow[] {
  if (from === to) return [...rows]
  const next = [...rows]
  const moved = next.splice(from, 1)[0]
  if (moved === undefined) return [...rows]
  const target = Math.max(0, Math.min(next.length, to))
  next.splice(target, 0, moved)
  return next
}

export interface PlanIssues {
  empty: boolean
  /** A squash/fixup needs the step before it, so it cannot open the plan. */
  firstStepUnreplayable: boolean
  rewordMissing: boolean
}

export function planIssues(rows: readonly PlanRow[]): PlanIssues {
  const firstActive = rows.findIndex((row) => row.action !== 'drop')
  const first = firstActive === -1 ? undefined : rows[firstActive]
  return {
    empty: rows.length === 0,
    firstStepUnreplayable: first !== undefined && (first.action === 'squash' || first.action === 'fixup'),
    rewordMissing: rows.some((row) => row.action === 'reword' && row.message.trim() === '')
  }
}

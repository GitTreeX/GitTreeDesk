import { describe, expect, it } from 'vitest'
import type { RebaseAction } from '@gitreedesk/shared'
import { moveRow, planIssues, type PlanRow } from '../src/renderer/src/tree/rebase-plan'

function row(index: number, action: RebaseAction = 'pick', message = 'subject'): PlanRow {
  return { sha: String(index).padStart(40, '0'), subject: `c${String(index)}`, action, message }
}

describe('moveRow', () => {
  const rows = [row(0), row(1), row(2), row(3)]

  it('lands the dragged row on the drop target', () => {
    expect(moveRow(rows, 0, 2).map((r) => r.subject)).toEqual(['c1', 'c2', 'c0', 'c3'])
    expect(moveRow(rows, 3, 1).map((r) => r.subject)).toEqual(['c0', 'c3', 'c1', 'c2'])
  })

  it('keeps the order when dropped on itself', () => {
    expect(moveRow(rows, 1, 1).map((r) => r.subject)).toEqual(['c0', 'c1', 'c2', 'c3'])
  })

  it('clamps an out-of-range target', () => {
    expect(moveRow(rows, 0, 99).map((r) => r.subject)).toEqual(['c1', 'c2', 'c3', 'c0'])
    expect(moveRow(rows, 2, -5).map((r) => r.subject)).toEqual(['c2', 'c0', 'c1', 'c3'])
  })

  it('does not mutate the input', () => {
    const next = moveRow(rows, 0, 3)
    expect(next).not.toBe(rows)
    expect(rows.map((r) => r.subject)).toEqual(['c0', 'c1', 'c2', 'c3'])
  })
})

describe('planIssues', () => {
  it('flags an empty plan', () => {
    expect(planIssues([])).toEqual({ empty: true, firstStepUnreplayable: false, rewordMissing: false })
  })

  it('ignores dropped rows when looking for the first step', () => {
    expect(planIssues([row(0, 'drop'), row(1, 'squash'), row(2, 'pick')]).firstStepUnreplayable).toBe(true)
    expect(planIssues([row(0, 'drop'), row(1, 'pick'), row(2, 'fixup')]).firstStepUnreplayable).toBe(false)
  })

  it('requires a message on every reword', () => {
    expect(planIssues([row(0, 'pick'), row(1, 'reword', '  ')]).rewordMissing).toBe(true)
    expect(planIssues([row(0, 'pick'), row(1, 'reword', 'new message')]).rewordMissing).toBe(false)
  })

  it('reports the issue a reorder creates', () => {
    const rows = [row(0, 'pick'), row(1, 'pick'), row(2, 'fixup')]
    expect(planIssues(rows).firstStepUnreplayable).toBe(false)
    expect(planIssues(moveRow(rows, 2, 0)).firstStepUnreplayable).toBe(true)
  })
})

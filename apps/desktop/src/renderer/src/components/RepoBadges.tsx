import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { RepoRecord, RepoStatus } from '@gitreedesk/shared'
import type { ViewOptions } from '../contexts/tree'
import { isDirty, isSubmoduleRecord } from '../tree/repos-model'

/** Short branch (or sha) label for a checkout; `…` while the status is pending. */
export function branchLabel(record: RepoRecord, status: RepoStatus | null): string {
  if (status === null) return record.gitDir === '' ? '' : '…'
  const head = status.head
  if (head.ref !== null) return head.ref
  if (head.detached && head.sha !== null) return `detached @ ${head.sha.slice(0, 7)}`
  return head.sha === null ? '' : head.sha.slice(0, 7)
}

export function RepoBadges({
  record,
  status,
  options,
  main = false
}: {
  record: RepoRecord
  status: RepoStatus | null
  options: ViewOptions
  /** Marks the primary checkout when the repository has linked worktrees. */
  main?: boolean
}): JSX.Element {
  const { t } = useTranslation()
  const chips: JSX.Element[] = []

  if (options.kindBadges) {
    if (record.kind === 'worktree') chips.push(chip('badges.worktree', '⧉'))
    else if (record.kind === 'bare') chips.push(chip('badges.bare', 'bare'))
    else if (isSubmoduleRecord(record)) chips.push(chip('badges.submodule', '◇'))
    if (main) chips.push(chip('badges.main', 'main'))
  }

  if (status !== null) {
    if (options.dirty && isDirty(status)) chips.push(chip('badges.dirty', '●'))
    if (options.operation && status.operation !== 'none') chips.push(chip('badges.operation', '⟳'))
    if (options.sync && status.upstream !== null && status.upstream.behind > 0) {
      chips.push(chip('badges.behind', `↓${status.upstream.behind}`))
    }
    if (options.sync && status.upstream !== null && status.upstream.ahead > 0) {
      chips.push(chip('badges.ahead', `↑${status.upstream.ahead}`))
    }
    if (options.stash && status.stashCount > 0) chips.push(chip('badges.stash', `⚑${status.stashCount}`))
    if (options.detached && status.head.detached) chips.push(chip('badges.detached', 'detached'))
  }

  if (chips.length === 0) return <></>
  return <span className="flex shrink-0 items-center gap-1">{chips}</span>

  function chip(key: string, text: string): JSX.Element {
    return (
      <span key={key} title={t(key)} className="text-xs text-muted">
        {text}
      </span>
    )
  }
}

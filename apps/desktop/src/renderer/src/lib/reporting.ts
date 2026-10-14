import type { AutoStashReport } from '@gitreedesk/shared'
import { GtdIpcError } from '@gitreedesk/shared'
import { notifyError } from '../notify'

/** Minimal translate signature; avoids depending on the full i18next types. */
export type Translate = (key: string, options?: Record<string, unknown>) => string

function quotedName(message: string): string {
  const match = /"([^"]+)"/.exec(message)
  return match?.[1] ?? ''
}

/** Localized copy for a failed call; unknown codes keep the service message. */
export function errorText(error: unknown, t: Translate): string {
  if (error instanceof GtdIpcError) {
    const name = quotedName(error.message)
    switch (error.code) {
      case 'auth-required':
        return name === ''
          ? t('errors.authRequiredGeneric')
          : t('errors.authRequired', { remote: name })
      case 'auth-ssh':
        return name === '' ? t('errors.authSshGeneric') : t('errors.authSsh', { remote: name })
      case 'unknown-repo':
        return t('errors.unknownRepo')
      case 'outside-workspace':
        return t('errors.outsideWorkspace')
      case 'invalid-name':
        return t('errors.invalidName')
      case 'exists':
        return t('errors.exists')
      case 'not-open':
        return t('errors.notOpen')
      case 'disposed':
        return t('errors.disposed')
      case 'branch-unmerged':
        return t('errors.branchUnmerged')
      case 'git-failed':
        return error.message
      default:
        return error.message
    }
  }
  return error instanceof Error ? error.message : String(error)
}

/** Raw git output for the Details drawer, when the failure carried any. */
export function errorDetails(error: unknown): string | undefined {
  if (error instanceof GtdIpcError && error.details.length > 0) return error.details
  return undefined
}

/** Reports a failed service call as a localized toast, raw output attached for Details. */
export function notifyServiceError(error: unknown, t: Translate): void {
  notifyError(errorText(error, t), errorDetails(error))
}

/** A push rejected because the remote branch has commits the local one lacks. */
export function isRejectedPush(error: unknown): boolean {
  const text = `${error instanceof Error ? error.message : ''}\n${errorDetails(error) ?? ''}`
  return /non-fast-forward|\[rejected\]|fetch first|Updates were rejected/i.test(text)
}

/** One-line notice for an auto-stash guard; `null` when no stash was involved. */
export function stashNotice(stash: AutoStashReport, t: Translate): string | null {
  if (!stash.stashed) return null
  if (stash.stashConflict) return t('sync.stashConflict')
  return stash.stashRestored ? t('sync.autoStashed') : null
}

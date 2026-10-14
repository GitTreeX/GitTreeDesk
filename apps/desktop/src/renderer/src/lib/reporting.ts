import type { AutoStashReport, UndoHint } from '@gitreedesk/shared'
import { GtdIpcError } from '@gitreedesk/shared'
import { api } from '../api'
import { notify, notifyError } from '../notify'

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
      case 'branch-in-use':
        return t('errors.branchInUse')
      case 'worktree-dirty':
        return t('errors.worktreeDirty')
      case 'worktree-locked':
        return t('errors.worktreeLocked')
      case 'operation-in-progress':
        return t('errors.operationInProgress')
      case 'merge-tool-missing':
        return t('errors.mergeToolMissing')
      case 'nothing-staged':
        return t('errors.nothingStaged')
      case 'llm-not-configured':
        return t('errors.llmNotConfigured')
      case 'no-profiles':
        return t('errors.noProfiles')
      case 'unknown-profile':
        return t('errors.unknownProfile')
      case 'unknown-command':
        return t('errors.unknownCommand')
      case 'unknown-session':
        return t('errors.unknownSession')
      case 'terminal-unavailable':
        return t('errors.terminalUnavailable')
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

/** The service refused an operation because another one is already in progress. */
export function isOperationBlocked(error: unknown): boolean {
  return error instanceof GtdIpcError && error.code === 'operation-in-progress'
}

/** The service refused to remove a worktree because it has uncommitted changes. */
export function isWorktreeDirtyRefusal(error: unknown): boolean {
  return error instanceof GtdIpcError && error.code === 'worktree-dirty'
}

/** One-line notice for an auto-stash guard; `null` when no stash was involved. */
export function stashNotice(stash: AutoStashReport, t: Translate): string | null {
  if (!stash.stashed) return null
  if (stash.stashConflict) return t('sync.stashConflict')
  return stash.stashRestored ? t('sync.autoStashed') : null
}

/** Reports a finished operation, offering Undo when the result carried a hint. */
export function notifyUndoable(
  t: Translate,
  gitDir: string,
  message: string,
  undo: UndoHint | null
): void {
  if (undo === null) {
    notify({ message })
    return
  }
  notify({
    message,
    action: {
      label: t('undo.action'),
      run: () => {
        void (async () => {
          try {
            await api.invoke('git:oplogUndo', { gitDir, entryId: undo.entryId })
            notify({ message: t('undo.restored') })
          } catch (failure) {
            notifyServiceError(failure, t)
          }
        })()
      }
    }
  })
}

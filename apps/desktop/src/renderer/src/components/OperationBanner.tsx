import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { RepoOperationKind, RepoRecord } from '@gitreedesk/shared'
import { useOperations } from '../contexts/operations-context'

/** Operations that can advance with `--skip`; a merge has nothing to skip. */
const SKIPPABLE: readonly RepoOperationKind[] = ['rebase', 'rebase-interactive', 'cherry-pick', 'revert']

/**
 * Inline banner of a repository whose operation stopped (conflicts or an edit
 * point) or is still missing attention. Continue is validated against the
 * unresolved count before git is asked to move on.
 */
export function OperationBanner({
  record,
  operation,
  conflicts
}: {
  record: RepoRecord
  operation: RepoOperationKind
  conflicts: number
}): JSX.Element {
  const { t } = useTranslation()
  const operations = useOperations()
  const label = t(`operation.kinds.${operation}`)
  const canAct = operation !== 'bisect'

  return (
    <div className="flex items-center gap-2 border-b border-line/60 bg-warn/10 px-3 py-1 text-xs text-warn">
      <span className="min-w-0 flex-1 truncate">
        {t('operation.inProgress', { operation: label })}
        {conflicts > 0 && <span> · {t('operation.unresolved', { count: conflicts })}</span>}
      </span>
      {canAct && (
        <>
          <button
            type="button"
            className="shrink-0 rounded border border-warn/40 px-1.5 py-0.5 hover:bg-warn/15"
            onClick={() => operations.continueOperation(record)}
          >
            {t('operation.continue')}
          </button>
          {SKIPPABLE.includes(operation) && (
            <button
              type="button"
              className="shrink-0 rounded border border-warn/40 px-1.5 py-0.5 hover:bg-warn/15"
              onClick={() => operations.skipOperation(record)}
            >
              {t('operation.skip')}
            </button>
          )}
          <button
            type="button"
            className="shrink-0 rounded border border-warn/40 px-1.5 py-0.5 hover:bg-warn/15"
            onClick={() => operations.abortOperation(record)}
          >
            {t('operation.abort')}
          </button>
        </>
      )}
    </div>
  )
}

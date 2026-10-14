import { useState, type FormEvent, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { MergeMode, RepoRecord } from '@gitreedesk/shared'
import { api } from '../api'
import { useOperations } from '../contexts/operations-context'
import { useWorkspace } from '../contexts/workspace'
import { errorText, isOperationBlocked } from '../lib/reporting'
import { notify } from '../notify'
import { XIcon } from './icons'

const MODES: readonly MergeMode[] = ['default', 'no-ff', 'ff-only', 'squash']

/** Merges one branch into the current one; conflicts hand over to the operation banner. */
export function MergeDialog({
  record,
  branch,
  onClose
}: {
  record: RepoRecord
  /** Revision that gets merged into the current branch. */
  branch: string
  onClose: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const operations = useOperations()
  const { statuses } = useWorkspace()
  const [mode, setMode] = useState<MergeMode>('default')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const current = statuses.get(record.gitDir)?.status.head.ref ?? 'HEAD'

  const submit = (event?: FormEvent): void => {
    event?.preventDefault()
    if (busy) return
    void (async () => {
      setBusy(true)
      setError(null)
      try {
        const result = await api.invoke('git:merge', {
          gitDir: record.gitDir,
          rev: branch,
          ...(mode !== 'default' ? { mode } : {})
        })
        if (result.stopped) {
          notify({ message: t('merge.stopped'), tone: 'error' })
        } else if (result.upToDate) {
          notify({ message: t('merge.upToDate') })
        } else if (result.fastForward) {
          notify({ message: t('merge.fastForward', { branch: current, rev: branch }) })
        } else if (mode === 'squash') {
          notify({ message: t('merge.squashed', { rev: branch }) })
        } else {
          notify({ message: t('merge.merged', { rev: branch, branch: current }) })
        }
        onClose()
      } catch (failure) {
        if (isOperationBlocked(failure)) {
          onClose()
          operations.openBlockedOperation(record)
          return
        }
        setError(errorText(failure, t))
        setBusy(false)
      }
    })()
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-black/40 pt-24" onMouseDown={onClose}>
      <form
        onSubmit={submit}
        className="h-fit w-full max-w-sm overflow-hidden rounded-lg border border-line bg-panel shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onClose()
          }
        }}
      >
        <header className="flex items-center gap-2 border-b border-line px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
            {t('merge.title', { branch: current })}
          </span>
          <button
            type="button"
            aria-label={t('dialogs.close')}
            className="shrink-0 rounded p-0.5 text-muted hover:bg-ink/5 hover:text-ink"
            onClick={onClose}
          >
            <XIcon className="size-3.5" />
          </button>
        </header>

        <div className="px-3 py-2">
          <p className="truncate font-mono text-sm text-ink" title={branch}>
            {branch}
          </p>
          <div className="mt-2 space-y-1" role="radiogroup">
            {MODES.map((candidate) => (
              <label
                key={candidate}
                className="flex cursor-pointer items-start gap-2 rounded px-1.5 py-1 hover:bg-ink/5"
              >
                <input
                  type="radio"
                  name="merge-mode"
                  checked={mode === candidate}
                  className="mt-0.5 accent-accent"
                  onChange={() => setMode(candidate)}
                />
                <span className="min-w-0">
                  <span className="block text-sm text-ink">{t(`merge.modes.${candidate}`)}</span>
                  <span className="block text-xs text-muted">
                    {t(`merge.descriptions.${candidate}`)}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </div>

        {error !== null && (
          <p className="px-3 pb-1 text-xs break-words text-danger">{error}</p>
        )}

        <div className="flex justify-end gap-2 border-t border-line px-3 py-2">
          <button
            type="button"
            className="rounded px-3 py-1 text-sm text-muted hover:bg-ink/5 hover:text-ink"
            onClick={onClose}
          >
            {t('dialogs.cancel')}
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded bg-accent px-3 py-1 text-sm text-white hover:opacity-90 disabled:opacity-50"
          >
            {t('merge.action')}
          </button>
        </div>
      </form>
    </div>
  )
}

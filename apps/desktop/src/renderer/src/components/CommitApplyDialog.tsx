import { useState, type FormEvent, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { RepoRecord } from '@gitreedesk/shared'
import { api } from '../api'
import { useOperations, type CommitTarget } from '../contexts/operations-context'
import { errorText, isOperationBlocked } from '../lib/reporting'
import { notify } from '../notify'
import { XIcon } from './icons'

const PREVIEW_LIMIT = 5

/**
 * Applies one or more commits onto the current branch as new commits, or stages
 * their changes and stops before committing.
 */
export function CommitApplyDialog({
  record,
  mode,
  targets,
  onClose
}: {
  record: RepoRecord
  mode: 'cherry-pick' | 'revert'
  /** Selected commits, newest first as the graph lists them. */
  targets: readonly CommitTarget[]
  onClose: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const operations = useOperations()
  const [noCommit, setNoCommit] = useState(false)
  const [mainline, setMainline] = useState(1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const single = targets.length === 1 ? targets[0] : undefined
  // A pick replays from the oldest commit so the newest lands on top; undoing a
  // batch has to start from the newest, otherwise an earlier change reappears.
  const ordered =
    mode === 'cherry-pick' ? [...targets].reverse() : targets
  const merges = ordered.filter((target) => target.parents.length > 1)
  const parentCount = merges.reduce((max, target) => Math.max(max, target.parents.length), 0)

  const submit = (event?: FormEvent): void => {
    event?.preventDefault()
    if (busy) return
    void (async () => {
      setBusy(true)
      setError(null)
      try {
        const request = {
          gitDir: record.gitDir,
          revs: ordered.map((target) => target.sha),
          ...(noCommit ? { noCommit: true } : {}),
          ...(merges.length > 0 ? { mainline } : {})
        }
        const result =
          mode === 'cherry-pick'
            ? await api.invoke('git:cherryPick', request)
            : await api.invoke('git:revert', request)
        if (result.stopped) {
          notify({ message: t(`graph.${mode}.stopped`), tone: 'error' })
        } else if (single !== undefined) {
          const sha = single.sha.slice(0, 7)
          notify({
            message: noCommit ? t(`graph.${mode}.singleStaged`, { sha }) : t(`graph.${mode}.singleDone`, { sha })
          })
        } else {
          notify({
            message: noCommit
              ? t(`graph.${mode}.manyStaged`, { count: targets.length })
              : t(`graph.${mode}.manyDone`, { count: targets.length })
          })
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
            {single !== undefined
              ? t(`graph.${mode}.singleTitle`, { sha: single.sha.slice(0, 7) })
              : t(`graph.${mode}.manyTitle`, { count: targets.length })}
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
          {single !== undefined ? (
            <>
              <p className="truncate text-sm text-ink" title={single.subject}>
                {single.subject}
              </p>
              <p className="truncate font-mono text-xs text-muted" title={single.sha}>
                {single.sha}
              </p>
            </>
          ) : (
            <>
              <div className="max-h-28 overflow-y-auto rounded border border-line/60 bg-canvas py-0.5">
                {ordered.slice(0, PREVIEW_LIMIT).map((target) => (
                  <p key={target.sha} className="flex gap-2 px-2 py-0.5 text-xs">
                    <span className="shrink-0 font-mono text-muted">{target.sha.slice(0, 7)}</span>
                    <span className="min-w-0 flex-1 truncate text-ink" title={target.subject}>
                      {target.subject}
                    </span>
                  </p>
                ))}
              </div>
              {ordered.length > PREVIEW_LIMIT && (
                <p className="mt-1 text-xs text-muted">
                  {t('graph.apply.more', { count: ordered.length - PREVIEW_LIMIT })}
                </p>
              )}
              <p className="mt-1 text-xs text-muted">{t('graph.apply.manyHint')}</p>
            </>
          )}

          {merges.length > 0 && (
            <div className="mt-2">
              <p className="text-xs font-semibold text-ink">{t('graph.apply.mainline')}</p>
              <p className="mt-0.5 text-xs text-muted">{t('graph.apply.mainlineHint')}</p>
              <div className="mt-1 space-y-0.5" role="radiogroup">
                {single !== undefined
                  ? single.parents.map((parent, index) => (
                      <label
                        key={parent}
                        className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-ink/5"
                      >
                        <input
                          type="radio"
                          name="commit-mainline"
                          checked={mainline === index + 1}
                          className="accent-accent"
                          onChange={() => setMainline(index + 1)}
                        />
                        <span className="truncate font-mono text-xs text-ink">
                          {t('graph.apply.parent', { number: index + 1, sha: parent.slice(0, 7) })}
                        </span>
                      </label>
                    ))
                  : Array.from({ length: parentCount }, (_, index) => (
                      <label
                        key={index}
                        className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-ink/5"
                      >
                        <input
                          type="radio"
                          name="commit-mainline"
                          checked={mainline === index + 1}
                          className="accent-accent"
                          onChange={() => setMainline(index + 1)}
                        />
                        <span className="truncate text-xs text-ink">
                          {t('graph.apply.parentNumber', { number: index + 1 })}
                        </span>
                      </label>
                    ))}
              </div>
            </div>
          )}

          <label className="mt-2 flex items-start gap-2 rounded px-1.5 py-1 hover:bg-ink/5">
            <input
              type="checkbox"
              checked={noCommit}
              className="mt-0.5 accent-accent"
              onChange={() => setNoCommit((current) => !current)}
            />
            <span className="min-w-0">
              <span className="block text-sm text-ink">{t(`graph.${mode}.noCommit`)}</span>
              <span className="block text-xs text-muted">{t(`graph.${mode}.noCommitHint`)}</span>
            </span>
          </label>
        </div>

        {error !== null && <p className="px-3 pb-1 text-xs break-words text-danger">{error}</p>}

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
            {t(`graph.${mode}.action`)}
          </button>
        </div>
      </form>
    </div>
  )
}

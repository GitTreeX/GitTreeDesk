import { useEffect, useState, type FormEvent, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { RepoRecord, ResetMode } from '@gitreedesk/shared'
import { api } from '../api'
import { useOperations, type CommitTarget } from '../contexts/operations-context'
import { errorText, isOperationBlocked, notifyUndoable } from '../lib/reporting'
import { XIcon } from './icons'

const MODES: readonly ResetMode[] = ['soft', 'mixed', 'hard']

interface DroppedPreview {
  count: number
  subjects: readonly { sha: string; subject: string }[]
}

/** Moves the current branch to a commit; `hard` names what it drops and takes a backup. */
export function ResetDialog({
  record,
  target,
  onClose
}: {
  record: RepoRecord
  target: CommitTarget
  onClose: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const operations = useOperations()
  const [mode, setMode] = useState<ResetMode>('mixed')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [drop, setDrop] = useState<DroppedPreview | null>(null)
  const [dropFailed, setDropFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const short = target.sha.slice(0, 7)

  // A hard reset names the commits it is about to drop; soft and mixed keep them in reach.
  useEffect(() => {
    if (mode !== 'hard') return
    let live = true
    setDrop(null)
    setDropFailed(false)
    void (async () => {
      try {
        const page = await api.invoke('git:graph', {
          gitDir: record.gitDir,
          revs: [`${target.sha}..HEAD`],
          limit: 20,
          countTotal: true
        })
        if (!live) return
        setDrop({
          count: page.total ?? page.commits.length,
          subjects: page.commits.map((commit) => ({ sha: commit.sha, subject: commit.subject }))
        })
      } catch {
        if (live) setDropFailed(true)
      }
    })()
    return () => {
      live = false
    }
  }, [mode, attempt, record.gitDir, target.sha])

  const submit = (event?: FormEvent): void => {
    event?.preventDefault()
    if (busy) return
    void (async () => {
      setBusy(true)
      setError(null)
      try {
        const result = await api.invoke('git:reset', {
          gitDir: record.gitDir,
          target: target.sha,
          mode
        })
        notifyUndoable(
          t,
          record.gitDir,
          t('graph.reset.done', { sha: short, mode: t(`graph.reset.modes.${mode}`) }),
          result.undo
        )
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
        className="h-fit max-h-[80vh] w-full max-w-sm overflow-y-auto rounded-lg border border-line bg-panel shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onClose()
          }
        }}
      >
        <header className="sticky top-0 flex items-center gap-2 border-b border-line bg-panel px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
            {t('graph.reset.title', { sha: short })}
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
          <p className="truncate text-sm text-ink" title={target.subject}>
            {target.subject}
          </p>
          <p className="truncate font-mono text-xs text-muted" title={target.sha}>
            {target.sha}
          </p>

          <div className="mt-2 space-y-1" role="radiogroup">
            {MODES.map((candidate) => (
              <label
                key={candidate}
                className="flex cursor-pointer items-start gap-2 rounded px-1.5 py-1 hover:bg-ink/5"
              >
                <input
                  type="radio"
                  name="reset-mode"
                  checked={mode === candidate}
                  className="mt-0.5 accent-accent"
                  onChange={() => setMode(candidate)}
                />
                <span className="min-w-0">
                  <span className="block text-sm text-ink">{t(`graph.reset.modes.${candidate}`)}</span>
                  <span className="block text-xs text-muted">
                    {t(`graph.reset.descriptions.${candidate}`)}
                  </span>
                </span>
              </label>
            ))}
          </div>

          {mode === 'hard' && (
            <div className="mt-2 rounded border border-danger/40 bg-danger/5 px-2 py-1.5">
              <p className="text-xs break-words text-danger">{t('graph.reset.hardWarning')}</p>
            </div>
          )}

          {mode === 'hard' && dropFailed && (
            <div className="mt-2 flex items-center gap-2">
              <span className="min-w-0 flex-1 text-xs text-muted">{t('graph.reset.listFailed')}</span>
              <button
                type="button"
                className="shrink-0 rounded border border-line px-2 py-0.5 text-xs text-ink hover:bg-ink/5"
                onClick={() => setAttempt((current) => current + 1)}
              >
                {t('graph.retry')}
              </button>
            </div>
          )}

          {mode === 'hard' && dropFailed === false && (
            <div className="mt-2">
              {drop === null ? (
                <p className="text-xs text-muted">{t('graph.reset.listing')}</p>
              ) : drop.count === 0 ? (
                <p className="text-xs text-muted">{t('graph.reset.none')}</p>
              ) : (
                <>
                  <p className="text-xs font-semibold text-ink">
                    {t('graph.reset.dropped', { count: drop.count })}
                  </p>
                  <div className="mt-1 max-h-40 overflow-y-auto rounded border border-line/60 bg-canvas py-0.5">
                    {drop.subjects.map((commit) => (
                      <p key={commit.sha} className="flex gap-2 px-2 py-0.5 text-xs">
                        <span className="shrink-0 font-mono text-muted">{commit.sha.slice(0, 7)}</span>
                        <span className="min-w-0 flex-1 truncate text-ink" title={commit.subject}>
                          {commit.subject}
                        </span>
                      </p>
                    ))}
                  </div>
                  {drop.count > drop.subjects.length && (
                    <p className="mt-1 text-xs text-muted">
                      {t('graph.reset.droppedMore', { count: drop.count - drop.subjects.length })}
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {error !== null && <p className="px-3 pb-1 text-xs break-words text-danger">{error}</p>}

        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-line bg-panel px-3 py-2">
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
            className={`rounded px-3 py-1 text-sm text-white hover:opacity-90 disabled:opacity-50 ${
              mode === 'hard' ? 'bg-danger' : 'bg-accent'
            }`}
          >
            {t('graph.reset.action')}
          </button>
        </div>
      </form>
    </div>
  )
}

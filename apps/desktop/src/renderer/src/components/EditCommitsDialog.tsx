import { useEffect, useRef, useState, type FormEvent, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { RepoRecord } from '@gitreedesk/shared'
import { api } from '../api'
import { useOperations, type CommitTarget } from '../contexts/operations-context'
import { errorText, isOperationBlocked, notifyUndoable } from '../lib/reporting'
import { notify } from '../notify'
import { XIcon } from './icons'

const PREVIEW_LIMIT = 5

/** ISO date-time → the local `datetime-local` input value. */
function toInputValue(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`
}

/** `datetime-local` input value → ISO date-time; `null` when empty or invalid. */
function fromInputValue(value: string): string | null {
  if (value.length === 0) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/**
 * Rewrites the metadata of one commit (message, author, dates) or applies the
 * filled fields to a batch of commits. Untouched dates keep their exact values,
 * and the pushed-history warning gates the submit until it is acknowledged.
 */
export function EditCommitsDialog({
  record,
  targets,
  pushed,
  onClose
}: {
  record: RepoRecord
  targets: readonly CommitTarget[]
  /** At least one target is already on the tracked remote. */
  pushed: boolean
  onClose: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const operations = useOperations()
  const single = targets.length === 1 ? targets[0] : undefined
  const [message, setMessage] = useState('')
  const [authorName, setAuthorName] = useState('')
  const [authorEmail, setAuthorEmail] = useState('')
  const [authorDate, setAuthorDate] = useState('')
  const [committerDate, setCommitterDate] = useState('')
  const [authorDateOriginal, setAuthorDateOriginal] = useState<string | null>(null)
  const [committerDateOriginal, setCommitterDateOriginal] = useState<string | null>(null)
  const [authorDateTouched, setAuthorDateTouched] = useState(false)
  const [committerDateTouched, setCommitterDateTouched] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const touchedRef = useRef(false)

  // A single target starts from its current values; a batch starts empty and
  // only applies the fields that were filled in.
  useEffect(() => {
    if (single === undefined) return
    let live = true
    void (async () => {
      try {
        const { commit } = await api.invoke('git:commitDetails', {
          gitDir: record.gitDir,
          sha: single.sha
        })
        if (!live) return
        setAuthorDateOriginal(commit.author.date)
        setCommitterDateOriginal(commit.committer.date)
        if (touchedRef.current) return
        setMessage(commit.message)
        setAuthorName(commit.author.name)
        setAuthorEmail(commit.author.email)
        setAuthorDate(toInputValue(commit.author.date))
        setCommitterDate(toInputValue(commit.committer.date))
      } catch {
        if (live) setLoadFailed(true)
      }
    })()
    return () => {
      live = false
    }
  }, [record.gitDir, single])

  const nameFilled = authorName.trim().length > 0
  const emailFilled = authorEmail.trim().length > 0
  const authorPairInvalid = nameFilled !== emailFilled
  const batchFilled =
    nameFilled ||
    emailFilled ||
    (authorDateTouched && authorDate.length > 0) ||
    (committerDateTouched && committerDate.length > 0)
  const canSubmit =
    !busy &&
    !authorPairInvalid &&
    (single !== undefined || batchFilled) &&
    (!pushed || confirmed)

  const markTouched = (): void => {
    touchedRef.current = true
  }

  const submit = (event?: FormEvent): void => {
    event?.preventDefault()
    if (!canSubmit) return
    void (async () => {
      setBusy(true)
      setError(null)
      try {
        const isoAuthor = authorDateTouched ? fromInputValue(authorDate) : authorDateOriginal
        const isoCommitter = committerDateTouched
          ? fromInputValue(committerDate)
          : committerDateOriginal
        const result = await api.invoke('git:editCommit', {
          gitDir: record.gitDir,
          targets: targets.map((target) => target.sha),
          ...(single !== undefined && message.trim().length > 0 ? { message } : {}),
          ...(nameFilled ? { authorName: authorName.trim() } : {}),
          ...(emailFilled ? { authorEmail: authorEmail.trim() } : {}),
          ...(isoAuthor !== null ? { authorDate: isoAuthor } : {}),
          ...(isoCommitter !== null ? { committerDate: isoCommitter } : {})
        })
        if (result.stopped) {
          notify({ message: t('graph.edit.stopped'), tone: 'error' })
        } else {
          const sha = result.sha.slice(0, 7)
          notifyUndoable(
            t,
            record.gitDir,
            single !== undefined
              ? t('graph.edit.doneSingle', { sha })
              : t('graph.edit.done', { count: targets.length, sha }),
            result.undo
          )
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

  const inputClass =
    'mt-1 w-full rounded border border-line bg-canvas px-2 py-1 text-sm text-ink outline-none focus:border-accent'

  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-black/40 pt-16" onMouseDown={onClose}>
      <form
        onSubmit={submit}
        className="h-fit max-h-[80vh] w-full max-w-md overflow-y-auto rounded-lg border border-line bg-panel shadow-2xl"
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
            {single !== undefined
              ? t('graph.edit.singleTitle', { sha: single.sha.slice(0, 7) })
              : t('graph.edit.manyTitle', { count: targets.length })}
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
          {single === undefined && (
            <>
              <div className="max-h-28 overflow-y-auto rounded border border-line/60 bg-canvas py-0.5">
                {targets.slice(0, PREVIEW_LIMIT).map((target) => (
                  <p key={target.sha} className="flex gap-2 px-2 py-0.5 text-xs">
                    <span className="shrink-0 font-mono text-muted">{target.sha.slice(0, 7)}</span>
                    <span className="min-w-0 flex-1 truncate text-ink" title={target.subject}>
                      {target.subject}
                    </span>
                  </p>
                ))}
              </div>
              {targets.length > PREVIEW_LIMIT && (
                <p className="mt-1 text-xs text-muted">
                  {t('graph.edit.more', { count: targets.length - PREVIEW_LIMIT })}
                </p>
              )}
              <p className="mt-1 text-xs text-muted">{t('graph.edit.batchHint')}</p>
            </>
          )}

          {single !== undefined && (
            <>
              <label className="mt-1 block text-xs text-muted" htmlFor="gtd-edit-message">
                {t('graph.edit.message')}
              </label>
              <textarea
                id="gtd-edit-message"
                autoFocus
                value={message}
                rows={4}
                onChange={(event) => {
                  markTouched()
                  setMessage(event.target.value)
                }}
                className={`${inputClass} resize-y font-mono`}
              />
              {loadFailed && <p className="mt-1 text-xs text-muted">{t('graph.edit.loadFailed')}</p>}
            </>
          )}

          <div className="mt-2 grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-muted" htmlFor="gtd-edit-author-name">
                {t('graph.edit.authorName')}
              </label>
              <input
                id="gtd-edit-author-name"
                autoFocus={single === undefined}
                value={authorName}
                onChange={(event) => {
                  markTouched()
                  setAuthorName(event.target.value)
                }}
                className={`${inputClass} ${authorPairInvalid && nameFilled ? 'border-danger' : ''}`}
              />
            </div>
            <div>
              <label className="block text-xs text-muted" htmlFor="gtd-edit-author-email">
                {t('graph.edit.authorEmail')}
              </label>
              <input
                id="gtd-edit-author-email"
                value={authorEmail}
                onChange={(event) => {
                  markTouched()
                  setAuthorEmail(event.target.value)
                }}
                className={`${inputClass} ${authorPairInvalid && emailFilled ? 'border-danger' : ''}`}
              />
            </div>
            <div>
              <label className="block text-xs text-muted" htmlFor="gtd-edit-author-date">
                {t('graph.edit.authorDate')}
              </label>
              <input
                id="gtd-edit-author-date"
                type="datetime-local"
                value={authorDate}
                onChange={(event) => {
                  markTouched()
                  setAuthorDateTouched(true)
                  setAuthorDate(event.target.value)
                }}
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs text-muted" htmlFor="gtd-edit-committer-date">
                {t('graph.edit.committerDate')}
              </label>
              <input
                id="gtd-edit-committer-date"
                type="datetime-local"
                value={committerDate}
                onChange={(event) => {
                  markTouched()
                  setCommitterDateTouched(true)
                  setCommitterDate(event.target.value)
                }}
                className={inputClass}
              />
            </div>
          </div>

          {authorPairInvalid && (
            <p className="mt-1 text-xs text-danger">{t('graph.edit.authorPair')}</p>
          )}

          {pushed && (
            <div className="mt-2 rounded border border-warn/40 bg-warn/10 px-2 py-1.5">
              <p className="text-xs break-words text-warn">{t('graph.edit.pushedWarning')}</p>
              <label className="mt-1 flex items-start gap-2 text-xs text-ink">
                <input
                  type="checkbox"
                  checked={confirmed}
                  className="mt-0.5 accent-accent"
                  onChange={() => setConfirmed((current) => !current)}
                />
                {t('graph.edit.pushedConfirm')}
              </label>
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
            disabled={!canSubmit}
            className={`rounded px-3 py-1 text-sm text-white hover:opacity-90 disabled:opacity-50 ${
              pushed ? 'bg-warn' : 'bg-accent'
            }`}
          >
            {t('graph.edit.action')}
          </button>
        </div>
      </form>
    </div>
  )
}

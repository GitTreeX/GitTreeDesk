import { useRef, useEffect, useState, type FormEvent, type JSX, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { RepoRecord } from '@gitreedesk/shared'
import { api } from '../api'
import { useOperations } from '../contexts/operations-context'
import { errorText, isOperationBlocked } from '../lib/reporting'
import { notify } from '../notify'

/** Stashes the working-tree changes, all of them or the picked paths only. */
export function StashCreateDialog({
  record,
  paths,
  onClose,
  onCreated
}: {
  record: RepoRecord
  /** Repo-relative paths to stash; omitted stashes everything. */
  paths?: readonly string[]
  onClose: () => void
  onCreated?: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const operations = useOperations()
  const [message, setMessage] = useState('')
  const [includeUntracked, setIncludeUntracked] = useState(true)
  const [keepIndex, setKeepIndex] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const messageRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    messageRef.current?.focus()
  }, [])

  const selected = paths !== undefined && paths.length > 0 ? paths : null

  const submit = (event?: FormEvent): void => {
    event?.preventDefault()
    if (busy) return
    void (async () => {
      setBusy(true)
      setError(null)
      try {
        const result = await api.invoke('git:stashCreate', {
          gitDir: record.gitDir,
          ...(message.trim() !== '' ? { message: message.trim() } : {}),
          ...(includeUntracked ? { includeUntracked: true } : {}),
          ...(keepIndex ? { keepIndex: true } : {}),
          ...(selected !== null ? { paths: [...selected] } : {})
        })
        if (!result.created) {
          notify({ message: t('stash.nothing') })
        } else if (selected !== null) {
          notify({ message: t('stash.createdPaths', { count: selected.length }) })
        } else {
          notify({ message: t('stash.created') })
        }
        onCreated?.()
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

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-black/40 pt-24" onMouseDown={onClose}>
      <form
        onSubmit={submit}
        className="h-fit w-full max-w-sm overflow-hidden rounded-lg border border-line bg-panel p-4 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 className="text-sm font-semibold text-ink">{t('stash.title', { name: record.name })}</h2>

        {selected !== null && (
          <p className="mt-2 text-xs text-muted">{t('stash.pathsNote', { count: selected.length })}</p>
        )}

        <label className="mt-3 block text-xs text-muted" htmlFor="gtd-stash-message">
          {t('stash.messageLabel')}
        </label>
        <input
          id="gtd-stash-message"
          ref={messageRef}
          value={message}
          placeholder={t('stash.messagePlaceholder')}
          onChange={(event) => {
            setMessage(event.target.value)
            setError(null)
          }}
          onKeyDown={onKeyDown}
          className="mt-1 w-full rounded border border-line bg-canvas px-2 py-1 text-sm text-ink outline-none focus:border-accent"
        />

        <label className="mt-3 flex items-center gap-2 text-xs text-ink">
          <input
            type="checkbox"
            checked={includeUntracked}
            className="accent-accent"
            onChange={() => setIncludeUntracked((current) => !current)}
          />
          {t('stash.includeUntracked')}
        </label>
        {selected === null && (
          <label className="mt-1.5 flex items-center gap-2 text-xs text-ink">
            <input
              type="checkbox"
              checked={keepIndex}
              className="accent-accent"
              onChange={() => setKeepIndex((current) => !current)}
            />
            {t('stash.keepIndex')}
          </label>
        )}

        {error !== null && <p className="mt-2 text-xs break-words text-danger">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
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
            {t('stash.action')}
          </button>
        </div>
      </form>
    </div>
  )
}

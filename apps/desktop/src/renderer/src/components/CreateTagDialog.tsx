import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type JSX,
  type KeyboardEvent
} from 'react'
import { useTranslation } from 'react-i18next'
import type { GitRef, RepoRecord } from '@gitreedesk/shared'
import { api } from '../api'
import { errorText } from '../lib/reporting'
import { notify } from '../notify'

export function CreateTagDialog({
  record,
  onClose
}: {
  record: RepoRecord
  onClose: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const [refs, setRefs] = useState<readonly GitRef[]>([])
  const [defaultRemote, setDefaultRemote] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [target, setTarget] = useState('HEAD')
  const [message, setMessage] = useState('')
  const [push, setPush] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement | null>(null)
  const listId = useId()

  useEffect(() => {
    nameRef.current?.focus()
  }, [])

  useEffect(() => {
    let live = true
    void Promise.all([
      api.invoke('git:refs', { gitDir: record.gitDir }),
      api.invoke('git:remotes', { gitDir: record.gitDir })
    ]).then(
      ([refsResult, remotesResult]) => {
        if (!live) return
        setRefs(refsResult.refs)
        setDefaultRemote(remotesResult.defaultRemote)
      },
      () => undefined
    )
    return () => {
      live = false
    }
  }, [record.gitDir])

  const targetValue = target.trim()

  const submit = (event?: FormEvent): void => {
    event?.preventDefault()
    if (busy || name.trim().length === 0 || targetValue === '') return
    void (async () => {
      setBusy(true)
      setError(null)
      const tagName = name.trim()
      const note = message.trim()
      try {
        const result = await api.invoke('git:tagCreate', {
          gitDir: record.gitDir,
          name: tagName,
          target: targetValue,
          ...(note.length > 0 ? { message: note } : {}),
          ...(push && defaultRemote !== null ? { push: true } : {})
        })
        notify({
          message:
            result.remote === null
              ? t('tags.created', { name: tagName })
              : t('tags.createdAndPushed', { name: tagName, remote: result.remote })
        })
        onClose()
      } catch (failure) {
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
        <h2 className="text-sm font-semibold text-ink">
          {t('tags.createTitle', { name: record.name })}
        </h2>

        <label className="mt-3 block text-xs text-muted" htmlFor="gtd-tag-name">
          {t('tags.nameLabel')}
        </label>
        <input
          id="gtd-tag-name"
          ref={nameRef}
          value={name}
          onChange={(event) => {
            setName(event.target.value)
            setError(null)
          }}
          onKeyDown={onKeyDown}
          className="mt-1 w-full rounded border border-line bg-canvas px-2 py-1 font-mono text-sm text-ink outline-none focus:border-accent"
        />

        <label className="mt-3 block text-xs text-muted" htmlFor="gtd-tag-target">
          {t('tags.targetLabel')}
        </label>
        <input
          id="gtd-tag-target"
          list={listId}
          value={target}
          onChange={(event) => setTarget(event.target.value)}
          onKeyDown={onKeyDown}
          className="mt-1 w-full rounded border border-line bg-canvas px-2 py-1 font-mono text-sm text-ink outline-none focus:border-accent"
        />
        <datalist id={listId}>
          <option value="HEAD" />
          {refs.map((ref) => (
            <option key={ref.fullName} value={ref.name}>
              {t(`branches.kinds.${ref.kind}`)}
            </option>
          ))}
        </datalist>

        <label className="mt-3 block text-xs text-muted" htmlFor="gtd-tag-message">
          {t('tags.messageLabel')}
        </label>
        <textarea
          id="gtd-tag-message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          rows={2}
          className="mt-1 w-full resize-y rounded border border-line bg-canvas px-2 py-1 text-sm text-ink outline-none focus:border-accent"
        />
        <p className="mt-1 text-xs text-muted">{t('tags.messageHint')}</p>

        {defaultRemote !== null && (
          <label className="mt-2 flex items-center gap-2 text-xs text-ink">
            <input
              type="checkbox"
              checked={push}
              className="accent-accent"
              onChange={() => setPush((current) => !current)}
            />
            {t('tags.pushAfter', { remote: defaultRemote })}
          </label>
        )}

        {error !== null && <p className="mt-1 text-xs break-words text-danger">{error}</p>}
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
            disabled={busy || name.trim().length === 0 || targetValue === ''}
            className="rounded bg-accent px-3 py-1 text-sm text-white hover:opacity-90 disabled:opacity-50"
          >
            {t('dialogs.create')}
          </button>
        </div>
      </form>
    </div>
  )
}

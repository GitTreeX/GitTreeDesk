import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type JSX,
  type KeyboardEvent
} from 'react'
import { useTranslation } from 'react-i18next'
import type { GitRef, RepoRecord } from '@gitreedesk/shared'
import { api } from '../api'
import { errorText, notifyServiceError, stashNotice } from '../lib/reporting'
import { notify } from '../notify'

export function CreateBranchDialog({
  record,
  initialName,
  initialStartPoint,
  onClose,
  onCreated
}: {
  record: RepoRecord
  initialName?: string
  initialStartPoint?: string
  onClose: () => void
  onCreated?: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const [refs, setRefs] = useState<readonly GitRef[]>([])
  const [name, setName] = useState(initialName ?? '')
  const [start, setStart] = useState(initialStartPoint ?? 'HEAD')
  const [checkout, setCheckout] = useState(true)
  const [track, setTrack] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement | null>(null)
  const listId = useId()
  const bare = record.kind === 'bare'

  useEffect(() => {
    nameRef.current?.focus()
  }, [])

  useEffect(() => {
    let live = true
    void api.invoke('git:refs', { gitDir: record.gitDir }).then(
      ({ refs: loaded }) => {
        if (live) setRefs(loaded)
      },
      () => undefined
    )
    return () => {
      live = false
    }
  }, [record.gitDir])

  const startValue = start.trim()
  const remoteStart = useMemo(
    () => refs.find((ref) => ref.kind === 'remote' && ref.name === startValue) ?? null,
    [refs, startValue]
  )

  const submit = (event?: FormEvent): void => {
    event?.preventDefault()
    if (busy || name.trim().length === 0) return
    void (async () => {
      setBusy(true)
      setError(null)
      const branch = name.trim()
      try {
        const result = await api.invoke('git:branchCreate', {
          gitDir: record.gitDir,
          name: branch,
          ...(startValue !== '' && startValue !== 'HEAD' ? { startPoint: startValue } : {}),
          ...(checkout ? { checkout: true } : {}),
          ...(track && remoteStart !== null ? { upstream: startValue } : {})
        })
        notify({ message: t('branches.created', { name: branch }) })
        const notice = stashNotice(result.stash, t)
        if (notice !== null) {
          notify({ message: notice, tone: result.stash.stashConflict ? 'error' : 'info' })
        }
        onCreated?.()
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
        <h2 className="text-sm font-semibold text-ink">{t('branches.createTitle', { name: record.name })}</h2>
        {bare ? (
          <p className="mt-2 text-sm text-muted">{t('branches.bareCreate')}</p>
        ) : (
          <>
            <label className="mt-3 block text-xs text-muted" htmlFor="gtd-branch-name">
              {t('branches.nameLabel')}
            </label>
            <input
              id="gtd-branch-name"
              ref={nameRef}
              value={name}
              onChange={(event) => {
                setName(event.target.value)
                setError(null)
              }}
              onKeyDown={onKeyDown}
              className="mt-1 w-full rounded border border-line bg-canvas px-2 py-1 font-mono text-sm text-ink outline-none focus:border-accent"
            />

            <label className="mt-3 block text-xs text-muted" htmlFor="gtd-branch-start">
              {t('branches.startLabel')}
            </label>
            <input
              id="gtd-branch-start"
              list={listId}
              value={start}
              onChange={(event) => setStart(event.target.value)}
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

            <label className="mt-3 flex items-center gap-2 text-xs text-ink">
              <input
                type="checkbox"
                checked={checkout}
                className="accent-accent"
                onChange={() => setCheckout((current) => !current)}
              />
              {t('branches.checkoutAfter')}
            </label>
            {remoteStart !== null && (
              <label className="mt-1.5 flex items-center gap-2 text-xs text-ink">
                <input
                  type="checkbox"
                  checked={track}
                  className="accent-accent"
                  onChange={() => setTrack((current) => !current)}
                />
                {t('branches.trackUpstream', { upstream: remoteStart.name })}
              </label>
            )}
          </>
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
          {!bare && (
            <button
              type="submit"
              disabled={busy || name.trim().length === 0}
              className="rounded bg-accent px-3 py-1 text-sm text-white hover:opacity-90 disabled:opacity-50"
            >
              {t('dialogs.create')}
            </button>
          )}
        </div>
      </form>
    </div>
  )
}

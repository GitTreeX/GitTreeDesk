import { useEffect, useRef, useState, type FormEvent, type JSX, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { RepoRecord } from '@gitreedesk/shared'
import { api } from '../api'
import { useWorkspace } from '../contexts/workspace'
import { errorText } from '../lib/reporting'
import { notify } from '../notify'
import { resolveWorktreeRoot } from './CreateWorktreeDialog'

function toPosix(value: string): string {
  return value.replace(/\\/g, '/')
}

/** Absolute paths compared as the git command would see them: separators and a trailing slash are noise. */
function normalizePath(value: string): string {
  return toPosix(value.trim()).replace(/\/+$/, '')
}

export function MoveWorktreeDialog({
  record,
  onClose,
  onMoved
}: {
  record: RepoRecord
  onClose: () => void
  onMoved?: (path: string) => void
}): JSX.Element {
  const { t } = useTranslation()
  const { descriptor } = useWorkspace()
  const root = descriptor?.root ?? ''
  const [worktreeRoot, setWorktreeRoot] = useState<string | null>(null)
  const [target, setTarget] = useState('')
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const folder = record.path.split('/').pop() ?? record.name

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  useEffect(() => {
    let live = true
    void api.invoke('settings:getEffective', { keyPath: ['git', 'worktreeRoot'] }).then(
      ({ value }) => {
        if (live) setWorktreeRoot(resolveWorktreeRoot(root, value))
      },
      () => {
        if (live) setWorktreeRoot(resolveWorktreeRoot(root, null))
      }
    )
    return () => {
      live = false
    }
  }, [root])

  // Suggesting the canonical worktree folder keeps the rename case — a new name in
  // the same place — down to editing the last path segment.
  const suggested = worktreeRoot === null ? '' : `${worktreeRoot}/${folder}`
  useEffect(() => {
    if (!touched) setTarget(suggested)
  }, [suggested, touched])

  const destination = normalizePath(target)
  const sameTarget = destination.length > 0 && destination === normalizePath(record.path)
  const ready = destination.length > 0 && !sameTarget && !busy

  const submit = (event?: FormEvent): void => {
    event?.preventDefault()
    if (!ready) return
    setBusy(true)
    setError(null)
    void (async () => {
      try {
        const result = await api.invoke('git:worktreeMove', {
          gitDir: record.gitDir,
          path: record.path,
          target: target.trim()
        })
        notify({ message: t('worktree.moved', { path: result.path }) })
        onMoved?.(result.path)
        onClose()
      } catch (failure) {
        setError(errorText(failure, t))
        setBusy(false)
      }
    })()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-black/40 pt-24" onMouseDown={onClose}>
      <form
        onSubmit={submit}
        className="h-fit w-full max-w-md overflow-hidden rounded-lg border border-line bg-panel p-4 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <h2 className="text-sm font-semibold text-ink">
          {t('worktree.moveTitle', { name: folder })}
        </h2>

        <label className="mt-3 block text-xs text-muted" htmlFor="gtd-worktree-current">
          {t('worktree.currentPath')}
        </label>
        <input
          id="gtd-worktree-current"
          value={record.path}
          readOnly
          className="mt-1 w-full rounded border border-line bg-canvas px-2 py-1 font-mono text-sm text-muted outline-none"
        />

        <label className="mt-3 block text-xs text-muted" htmlFor="gtd-worktree-destination">
          {t('worktree.destinationLabel')}
        </label>
        <input
          id="gtd-worktree-destination"
          ref={inputRef}
          value={target}
          placeholder={`{worktreeRoot}/${folder}`}
          onChange={(event) => {
            setTarget(event.target.value)
            setTouched(true)
            setError(null)
          }}
          className="mt-1 w-full rounded border border-line bg-canvas px-2 py-1 font-mono text-sm text-ink outline-none focus:border-accent"
        />
        <p className="mt-1 text-xs text-muted">{t('worktree.moveHint')}</p>
        {sameTarget && <p className="mt-1 text-xs text-warn">{t('worktree.samePath')}</p>}

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
            disabled={!ready}
            className="rounded bg-accent px-3 py-1 text-sm text-white hover:opacity-90 disabled:opacity-50"
          >
            {t('dialogs.move')}
          </button>
        </div>
      </form>
    </div>
  )
}

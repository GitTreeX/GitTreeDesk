import { useEffect, useRef, useState, type FormEvent, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { RepoRecord } from '@gitreedesk/shared'
import { api } from '../api'
import { useSubmodules } from '../contexts/submodules'
import { errorText } from '../lib/reporting'
import { notify } from '../notify'

export function SubmoduleAddDialog({
  record,
  onClose
}: {
  record: RepoRecord
  onClose: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const { refresh } = useSubmodules()
  const [url, setUrl] = useState('')
  const [path, setPath] = useState('')
  const [branch, setBranch] = useState('')
  const [force, setForce] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const urlRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    urlRef.current?.focus()
  }, [])

  const ready = url.trim().length > 0 && !busy

  const submit = (event?: FormEvent): void => {
    event?.preventDefault()
    if (!ready) return
    void (async () => {
      setBusy(true)
      setError(null)
      const trimmedPath = path.trim()
      const trimmedBranch = branch.trim()
      try {
        const { submodule } = await api.invoke('git:submoduleAdd', {
          gitDir: record.gitDir,
          url: url.trim(),
          ...(trimmedPath.length > 0 ? { path: trimmedPath } : {}),
          ...(trimmedBranch.length > 0 ? { branch: trimmedBranch } : {}),
          ...(force ? { force: true } : {})
        })
        const name = submodule?.path ?? url.trim()
        const sha = submodule?.sha ?? null
        notify({
          message:
            sha === null
              ? t('submodule.added', { name })
              : t('submodule.addedAt', { name, sha: sha.slice(0, 7) })
        })
        await refresh(record.gitDir)
        onClose()
      } catch (failure) {
        setError(errorText(failure, t))
        setBusy(false)
      }
    })()
  }

  const field =
    'mt-1 w-full rounded border border-line bg-canvas px-2 py-1 font-mono text-sm text-ink outline-none focus:border-accent'

  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-black/40 pt-24" onMouseDown={onClose}>
      <form
        onSubmit={submit}
        aria-label={t('submodule.addTitle', { name: record.name })}
        className="h-fit w-full max-w-md overflow-hidden rounded-lg border border-line bg-panel p-4 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose()
        }}
      >
        <h2 className="text-sm font-semibold text-ink">
          {t('submodule.addTitle', { name: record.name })}
        </h2>

        <label className="mt-3 block text-xs text-muted" htmlFor="gtd-submodule-url">
          {t('submodule.urlLabel')}
        </label>
        <input
          id="gtd-submodule-url"
          ref={urlRef}
          value={url}
          placeholder="https://example.invalid/library.git"
          onChange={(event) => {
            setUrl(event.target.value)
            setError(null)
          }}
          className={field}
        />

        <label className="mt-3 block text-xs text-muted" htmlFor="gtd-submodule-path">
          {t('submodule.pathLabel')}
        </label>
        <input
          id="gtd-submodule-path"
          value={path}
          onChange={(event) => setPath(event.target.value)}
          className={field}
        />
        <p className="mt-1 text-xs text-muted">{t('submodule.pathHint')}</p>

        <label className="mt-3 block text-xs text-muted" htmlFor="gtd-submodule-branch">
          {t('submodule.branchLabel')}
        </label>
        <input
          id="gtd-submodule-branch"
          value={branch}
          onChange={(event) => setBranch(event.target.value)}
          className={field}
        />
        <p className="mt-1 text-xs text-muted">{t('submodule.branchHint')}</p>

        <label className="mt-3 flex items-center gap-1.5 text-xs text-ink">
          <input
            type="checkbox"
            className="accent-accent"
            checked={force}
            onChange={(event) => setForce(event.target.checked)}
          />
          {t('submodule.forceLabel')}
        </label>

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
            {t('submodule.addAction')}
          </button>
        </div>
      </form>
    </div>
  )
}

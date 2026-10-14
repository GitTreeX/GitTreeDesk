import { useCallback, useEffect, useState, type FormEvent, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { RemoteInfo, RepoRecord } from '@gitreedesk/shared'
import { api } from '../api'
import { useOperations } from '../contexts/operations-context'
import { errorText } from '../lib/reporting'
import { notify } from '../notify'
import { ConfirmDialog } from './ConfirmDialog'
import { XIcon } from './icons'

const DEFAULT_REMOTE_KEY = ['git', 'defaultRemote']

interface EditState {
  name: string
  fetchUrl: string
  pushUrl: string
}

interface FetchResult {
  remote: string
  updated: boolean
  output: string
}

export function RemotesDialog({
  record,
  onClose
}: {
  record: RepoRecord
  onClose: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const operations = useOperations()

  const [remotes, setRemotes] = useState<readonly RemoteInfo[] | null>(null)
  const [defaultRemote, setDefaultRemote] = useState<string | null>(null)
  const [override, setOverride] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [addName, setAddName] = useState('')
  const [addUrl, setAddUrl] = useState('')
  const [edit, setEdit] = useState<EditState | null>(null)
  const [editError, setEditError] = useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = useState<RemoteInfo | null>(null)
  const [fetchResult, setFetchResult] = useState<FetchResult | null>(null)
  const [fetchBusy, setFetchBusy] = useState(false)

  const { prune, followTags } = operations.fetchOptions

  const load = useCallback(async (): Promise<void> => {
    try {
      const [listed, stored] = await Promise.all([
        api.invoke('git:remotes', { gitDir: record.gitDir }),
        api.invoke('settings:get', { scope: 'workspace', keyPath: DEFAULT_REMOTE_KEY })
      ])
      setRemotes(listed.remotes)
      setDefaultRemote(listed.defaultRemote)
      setOverride(typeof stored.value === 'string' && stored.value.length > 0 ? stored.value : null)
    } catch (failure) {
      setError(errorText(failure, t))
    }
  }, [record.gitDir, t])

  useEffect(() => {
    void load()
  }, [load])

  const run = useCallback(
    async (task: () => Promise<void>): Promise<void> => {
      if (busy) return
      setBusy(true)
      setError(null)
      try {
        await task()
      } catch (failure) {
        setError(errorText(failure, t))
      } finally {
        setBusy(false)
      }
    },
    [busy, t]
  )

  const addRemote = (event?: FormEvent): void => {
    event?.preventDefault()
    const name = addName.trim()
    const url = addUrl.trim()
    if (name === '' || url === '') return
    void run(async () => {
      await api.invoke('git:remoteAdd', { gitDir: record.gitDir, name, url })
      notify({ message: t('remotes.added', { name }) })
      setAddName('')
      setAddUrl('')
      await load()
    })
  }

  const saveEdit = (): void => {
    const target = edit
    if (target === null) return
    const fetchUrl = target.fetchUrl.trim()
    const pushUrl = target.pushUrl.trim()
    if (fetchUrl === '') {
      setEditError(t('remotes.urlRequired'))
      return
    }
    setEditError(null)
    void run(async () => {
      const current = remotes?.find((remote) => remote.name === target.name) ?? null
      if (current === null || current.fetchUrl !== fetchUrl) {
        await api.invoke('git:remoteSetUrl', {
          gitDir: record.gitDir,
          name: target.name,
          url: fetchUrl
        })
      }
      const relativePushUrl = pushUrl === '' ? fetchUrl : pushUrl
      if (current === null || current.pushUrl !== relativePushUrl) {
        await api.invoke('git:remoteSetUrl', {
          gitDir: record.gitDir,
          name: target.name,
          url: relativePushUrl,
          push: true
        })
      }
      notify({ message: t('remotes.urlSaved', { name: target.name }) })
      setEdit(null)
      await load()
    })
  }

  const removeRemote = (remote: RemoteInfo): void => {
    setRemoveTarget(null)
    void run(async () => {
      await api.invoke('git:remoteRemove', { gitDir: record.gitDir, name: remote.name })
      notify({ message: t('remotes.removed', { name: remote.name }) })
      await load()
    })
  }

  const setDefault = (name: string): void => {
    void run(async () => {
      await api.invoke('settings:set', { scope: 'workspace', keyPath: DEFAULT_REMOTE_KEY, value: name })
      notify({ message: t('remotes.defaultSet', { name }) })
      await load()
    })
  }

  const resetDefault = (): void => {
    void run(async () => {
      await api.invoke('settings:remove', { scope: 'workspace', keyPath: DEFAULT_REMOTE_KEY })
      notify({ message: t('remotes.defaultCleared') })
      await load()
    })
  }

  const fetchNow = (): void => {
    if (fetchBusy) return
    setFetchBusy(true)
    setError(null)
    void (async () => {
      try {
        const result = await api.invoke('git:fetch', {
          gitDir: record.gitDir,
          ...(prune ? { prune: true } : {}),
          ...(followTags ? { followTags: true } : {})
        })
        setFetchResult(result)
        await load()
      } catch (failure) {
        setError(errorText(failure, t))
      } finally {
        setFetchBusy(false)
      }
    })()
  }

  const confirmOpen = removeTarget !== null

  return (
    <div
      className="fixed inset-0 z-40 flex justify-center bg-black/40 pt-20"
      onMouseDown={() => {
        if (!confirmOpen) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('remotes.title', { name: record.name })}
        className="h-fit w-full max-w-lg overflow-hidden rounded-lg border border-line bg-panel shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-center gap-2 border-b border-line px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
            {t('remotes.title', { name: record.name })}
          </span>
          {busy && <span className="shrink-0 animate-pulse text-xs text-muted">…</span>}
          <button
            type="button"
            aria-label={t('dialogs.close')}
            className="shrink-0 rounded p-0.5 text-muted hover:bg-ink/5 hover:text-ink"
            onClick={onClose}
          >
            <XIcon className="size-3.5" />
          </button>
        </header>

        <div className="max-h-[26rem] overflow-y-auto">
          {remotes !== null && remotes.length === 0 && (
            <p className="px-3 py-4 text-center text-sm text-muted">{t('remotes.empty')}</p>
          )}
          {remotes?.map((remote) => (
            <div key={remote.name} className="border-b border-line/60 px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="min-w-0 truncate font-mono text-sm text-ink">{remote.name}</span>
                {remote.name === defaultRemote && (
                  <span className="shrink-0 rounded bg-accent/15 px-1 text-[10px] text-accent">
                    {t('remotes.defaultBadge')}
                  </span>
                )}
                <span className="min-w-0 flex-1" />
                {remote.name === defaultRemote && override !== null && (
                  <button
                    type="button"
                    className="shrink-0 rounded px-1.5 py-0.5 text-xs text-muted hover:bg-ink/5 hover:text-ink"
                    title={t('remotes.resetHint')}
                    onClick={resetDefault}
                  >
                    {t('remotes.resetDefault')}
                  </button>
                )}
                {remote.name !== defaultRemote && (
                  <button
                    type="button"
                    className="shrink-0 rounded px-1.5 py-0.5 text-xs text-muted hover:bg-ink/5 hover:text-ink"
                    onClick={() => setDefault(remote.name)}
                  >
                    {t('remotes.setDefault')}
                  </button>
                )}
                <button
                  type="button"
                  className="shrink-0 rounded px-1.5 py-0.5 text-xs text-muted hover:bg-ink/5 hover:text-ink"
                  onClick={() =>
                    setEdit({ name: remote.name, fetchUrl: remote.fetchUrl, pushUrl: remote.pushUrl })
                  }
                >
                  {t('remotes.editUrl')}
                </button>
                <button
                  type="button"
                  className="shrink-0 rounded px-1.5 py-0.5 text-xs text-danger hover:bg-danger/10"
                  onClick={() => setRemoveTarget(remote)}
                >
                  {t('remotes.remove')}
                </button>
              </div>
              <p className="mt-0.5 truncate font-mono text-xs text-muted" title={remote.fetchUrl}>
                {remote.fetchUrl}
              </p>
              {remote.pushUrl !== remote.fetchUrl && (
                <p className="truncate font-mono text-xs text-muted" title={remote.pushUrl}>
                  ↑ {remote.pushUrl}
                </p>
              )}
              {edit !== null && edit.name === remote.name && (
                <div className="mt-2 rounded border border-line bg-canvas p-2">
                  <label className="block text-xs text-muted" htmlFor="gtd-remote-fetch">
                    {t('remotes.fetchUrlLabel')}
                  </label>
                  <input
                    id="gtd-remote-fetch"
                    value={edit.fetchUrl}
                    onChange={(event) => {
                      setEdit({ ...edit, fetchUrl: event.target.value })
                      setEditError(null)
                    }}
                    className="mt-1 w-full rounded border border-line bg-panel px-2 py-1 font-mono text-xs text-ink outline-none focus:border-accent"
                  />
                  <label className="mt-2 block text-xs text-muted" htmlFor="gtd-remote-push">
                    {t('remotes.pushUrlLabel')}
                  </label>
                  <input
                    id="gtd-remote-push"
                    value={edit.pushUrl}
                    onChange={(event) => {
                      setEdit({ ...edit, pushUrl: event.target.value })
                      setEditError(null)
                    }}
                    className="mt-1 w-full rounded border border-line bg-panel px-2 py-1 font-mono text-xs text-ink outline-none focus:border-accent"
                  />
                  {editError !== null && <p className="mt-1 text-xs text-danger">{editError}</p>}
                  <div className="mt-2 flex justify-end gap-2">
                    <button
                      type="button"
                      className="rounded px-2 py-0.5 text-xs text-muted hover:bg-ink/5 hover:text-ink"
                      onClick={() => {
                        setEdit(null)
                        setEditError(null)
                      }}
                    >
                      {t('dialogs.cancel')}
                    </button>
                    <button
                      type="button"
                      className="rounded bg-accent px-2 py-0.5 text-xs text-white hover:opacity-90"
                      onClick={saveEdit}
                    >
                      {t('dialogs.save')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}

          <form className="px-3 py-2" onSubmit={addRemote}>
            <p className="text-xs font-semibold tracking-wide text-muted uppercase">
              {t('remotes.addTitle')}
            </p>
            <div className="mt-1.5 flex items-center gap-2">
              <input
                value={addName}
                onChange={(event) => setAddName(event.target.value)}
                placeholder={t('remotes.nameLabel')}
                aria-label={t('remotes.nameLabel')}
                className="w-28 shrink-0 rounded border border-line bg-canvas px-2 py-1 font-mono text-xs text-ink outline-none focus:border-accent"
              />
              <input
                value={addUrl}
                onChange={(event) => setAddUrl(event.target.value)}
                placeholder={t('remotes.urlLabel')}
                aria-label={t('remotes.urlLabel')}
                className="min-w-0 flex-1 rounded border border-line bg-canvas px-2 py-1 font-mono text-xs text-ink outline-none focus:border-accent"
              />
              <button
                type="submit"
                disabled={busy || addName.trim() === '' || addUrl.trim() === ''}
                className="shrink-0 rounded border border-line px-2 py-1 text-xs text-ink hover:bg-ink/5 disabled:opacity-40"
              >
                {t('remotes.addAction')}
              </button>
            </div>
          </form>

          <div className="border-t border-line px-3 py-2">
            <p className="text-xs font-semibold tracking-wide text-muted uppercase">
              {t('remotes.fetchSection')}
            </p>
            <label className="mt-1.5 flex items-center gap-2 text-xs text-ink">
              <input
                type="checkbox"
                checked={prune}
                className="accent-accent"
                onChange={() =>
                  operations.setFetchOptions({ prune: !prune, followTags })
                }
              />
              {t('remotes.pruneLabel')}
            </label>
            <label className="mt-1 flex items-center gap-2 text-xs text-ink">
              <input
                type="checkbox"
                checked={followTags}
                className="accent-accent"
                onChange={() =>
                  operations.setFetchOptions({ prune, followTags: !followTags })
                }
              />
              {t('remotes.followTagsLabel')}
            </label>
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                disabled={fetchBusy || remotes === null || remotes.length === 0}
                className="rounded border border-line px-2 py-1 text-xs text-ink hover:bg-ink/5 disabled:opacity-40"
                onClick={fetchNow}
              >
                {t('remotes.fetchNow')}
              </button>
              {fetchResult !== null && (
                <span className="min-w-0 flex-1 truncate text-xs text-muted">
                  {t('remotes.fetchedFrom', { remote: fetchResult.remote })} ·{' '}
                  {fetchResult.updated ? t('sync.updated') : t('sync.upToDate')}
                </span>
              )}
            </div>
            {fetchResult !== null && fetchResult.output.length > 0 && (
              <details className="mt-1.5">
                <summary className="cursor-pointer text-xs text-muted hover:text-ink">
                  {t('output.showOutput')}
                </summary>
                <pre className="mt-1 max-h-40 overflow-auto rounded border border-line bg-canvas p-2 font-mono text-xs whitespace-pre-wrap text-muted">
                  {fetchResult.output}
                </pre>
              </details>
            )}
          </div>
        </div>

        {error !== null && (
          <p className="border-t border-line px-3 py-1.5 text-xs break-words text-danger">{error}</p>
        )}
      </div>

      {removeTarget !== null && (
        <ConfirmDialog
          title={t('remotes.removeTitle', { name: removeTarget.name })}
          body={t('remotes.removeBody')}
          confirmLabel={t('remotes.removeAction')}
          danger
          onConfirm={() => removeRemote(removeTarget)}
          onClose={() => setRemoveTarget(null)}
        />
      )}
    </div>
  )
}

import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { GitRef, RemoteTag, RepoRecord } from '@gitreedesk/shared'
import { api } from '../api'
import { useOperations } from '../contexts/operations-context'
import { useSettings } from '../contexts/settings'
import { errorText, stashNotice } from '../lib/reporting'
import { relativeTime } from '../lib/relative-time'
import { notify } from '../notify'
import { ConfirmDialog } from './ConfirmDialog'
import { CreateTagDialog } from './CreateTagDialog'
import { TagIcon, TrashIcon, UploadIcon, XIcon } from './icons'

export function TagsDialog({
  record,
  onClose
}: {
  record: RepoRecord
  onClose: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const settings = useSettings()
  const operations = useOperations()

  const [tags, setTags] = useState<readonly GitRef[] | null>(null)
  const [remoteName, setRemoteName] = useState<string | null>(null)
  const [remoteTags, setRemoteTags] = useState<readonly RemoteTag[]>([])
  const [remoteLoading, setRemoteLoading] = useState(true)
  const [remoteError, setRemoteError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [create, setCreate] = useState(false)
  const [deleteAsk, setDeleteAsk] = useState<{ tag: GitRef; onRemote: boolean } | null>(null)
  const [remoteDeleteAsk, setRemoteDeleteAsk] = useState<RemoteTag | null>(null)
  const busyRef = useRef(false)

  const bare = record.kind === 'bare'

  const loadLocal = useCallback(async (): Promise<void> => {
    try {
      const { refs } = await api.invoke('git:refs', { gitDir: record.gitDir })
      setTags(refs.filter((ref) => ref.kind === 'tag'))
    } catch (failure) {
      setError(errorText(failure, t))
    }
  }, [record.gitDir, t])

  const loadRemote = useCallback(async (): Promise<void> => {
    setRemoteLoading(true)
    try {
      const result = await api.invoke('git:remoteTags', { gitDir: record.gitDir })
      setRemoteName(result.remote)
      setRemoteTags(result.tags)
      setRemoteError(null)
    } catch (failure) {
      setRemoteError(errorText(failure, t))
    } finally {
      setRemoteLoading(false)
    }
  }, [record.gitDir, t])

  useEffect(() => {
    void loadLocal()
    void loadRemote()
  }, [loadLocal, loadRemote])

  const run = useCallback(
    async (label: string, task: () => Promise<void>): Promise<void> => {
      if (busyRef.current) return
      busyRef.current = true
      setBusy(label)
      setError(null)
      try {
        await task()
      } catch (failure) {
        setError(errorText(failure, t))
      } finally {
        busyRef.current = false
        setBusy(null)
      }
    },
    [t]
  )

  const checkout = useCallback(
    (tag: GitRef): void => {
      if (bare) {
        notify({ message: t('branches.bareCheckout'), tone: 'error' })
        return
      }
      void run('checkout', async () => {
        const { stash } = await api.invoke('git:checkoutDetach', {
          gitDir: record.gitDir,
          rev: tag.name
        })
        notify({ message: t('tags.checkedOut', { name: tag.name }) })
        const notice = stashNotice(stash, t)
        if (notice !== null) {
          notify({ message: notice, tone: stash.stashConflict ? 'error' : 'info' })
        }
        onClose()
      })
    },
    [bare, onClose, record.gitDir, run, t]
  )

  const pushTag = useCallback(
    (name: string): void => {
      void run('push', async () => {
        const result = await api.invoke('git:tagPush', { gitDir: record.gitDir, name })
        notify({ message: t('tags.pushed', { name, remote: result.remote }) })
        await loadRemote()
      })
    },
    [loadRemote, record.gitDir, run, t]
  )

  const pushAll = useCallback((): void => {
    void run('pushAll', async () => {
      const result = await api.invoke('git:tagPushAll', { gitDir: record.gitDir })
      notify({ message: t('tags.pushedAll', { remote: result.remote }) })
      await loadRemote()
    })
  }, [loadRemote, record.gitDir, run, t])

  const fetchTags = useCallback((): void => {
    void run('fetch', async () => {
      const result = await api.invoke('git:fetch', {
        gitDir: record.gitDir,
        ...(operations.fetchOptions.prune ? { prune: true } : {}),
        followTags: true
      })
      notify({
        message: `${t('tags.fetchedFrom', { remote: result.remote })} · ${
          result.updated ? t('sync.updated') : t('sync.upToDate')
        }`
      })
      await loadLocal()
      await loadRemote()
    })
  }, [loadLocal, loadRemote, operations.fetchOptions.prune, record.gitDir, run, t])

  const deleteLocal = useCallback(
    (tag: GitRef, onRemote: boolean): void => {
      void run('delete', async () => {
        await api.invoke('git:tagDelete', { gitDir: record.gitDir, name: tag.name })
        if (onRemote && remoteName !== null) {
          notify({
            message: t('tags.deleted', { name: tag.name }),
            action: {
              label: t('tags.removeOnRemote', { remote: remoteName }),
              run: () => {
                void (async () => {
                  try {
                    await api.invoke('git:tagDeleteRemote', {
                      gitDir: record.gitDir,
                      name: tag.name
                    })
                    notify({ message: t('tags.removedOnRemote', { name: tag.name, remote: remoteName }) })
                    await loadRemote()
                  } catch (failure) {
                    notify({ message: errorText(failure, t), tone: 'error' })
                  }
                })()
              }
            }
          })
        } else {
          notify({ message: t('tags.deleted', { name: tag.name }) })
        }
        await loadLocal()
      })
    },
    [loadLocal, loadRemote, record.gitDir, remoteName, run, t]
  )

  const deleteOnRemote = useCallback(
    (tag: RemoteTag): void => {
      setRemoteDeleteAsk(null)
      void run('deleteRemote', async () => {
        const result = await api.invoke('git:tagDeleteRemote', {
          gitDir: record.gitDir,
          name: tag.name
        })
        notify({ message: t('tags.removedOnRemote', { name: tag.name, remote: result.remote }) })
        await loadRemote()
      })
    },
    [loadRemote, record.gitDir, run, t]
  )

  const remoteHasTag = (name: string): boolean => remoteTags.some((tag) => tag.name === name)
  const blocking = create || deleteAsk !== null || remoteDeleteAsk !== null

  return (
    <div
      className="fixed inset-0 z-40 flex justify-center bg-black/40 pt-16"
      onMouseDown={() => {
        if (!blocking) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('tags.title', { name: record.name })}
        className="h-fit w-full max-w-xl overflow-hidden rounded-lg border border-line bg-panel shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !blocking) onClose()
        }}
      >
        <header className="flex items-center gap-2 border-b border-line px-3 py-2">
          <TagIcon className="size-4 shrink-0 text-muted" />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
            {t('tags.title', { name: record.name })}
          </span>
          {busy !== null && <span className="shrink-0 animate-pulse text-xs text-muted">…</span>}
          <button
            type="button"
            aria-label={t('dialogs.close')}
            className="shrink-0 rounded p-0.5 text-muted hover:bg-ink/5 hover:text-ink"
            onClick={onClose}
          >
            <XIcon className="size-3.5" />
          </button>
        </header>

        <div className="max-h-96 overflow-y-auto py-1">
          <p className="px-3 py-1 text-xs font-semibold tracking-wide text-muted uppercase">
            {t('tags.localSection', { count: tags?.length ?? 0 })}
          </p>
          {tags !== null && tags.length === 0 && (
            <p className="px-3 py-3 text-center text-sm text-muted">{t('tags.empty')}</p>
          )}
          {tags?.map((tag) => (
            <div key={tag.fullName} className="group flex h-8 items-center gap-2 px-2 hover:bg-ink/5">
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                title={bare ? t('branches.bareCheckout') : t('tags.checkoutHint')}
                onClick={() => checkout(tag)}
              >
                <TagIcon className="size-3.5 shrink-0 text-muted" />
                <span className="min-w-0 max-w-[45%] shrink-0 truncate font-mono text-sm text-ink">
                  {tag.name}
                </span>
                <span
                  className={`shrink-0 rounded px-1 text-[10px] ${
                    tag.annotated ? 'bg-accent/15 text-accent' : 'bg-ink/5 text-muted'
                  }`}
                >
                  {tag.annotated ? t('tags.annotated') : t('tags.lightweight')}
                </span>
                <span className="min-w-0 flex-1" />
                {tag.subject !== null && (
                  <span className="max-w-[35%] shrink-0 truncate text-xs text-muted">
                    {tag.subject}
                  </span>
                )}
                <span className="shrink-0 font-mono text-xs text-muted">{tag.sha.slice(0, 7)}</span>
                <span className="shrink-0 text-xs text-muted">
                  {relativeTime(tag.updatedAt, settings.locale)}
                </span>
              </button>
              <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex group-focus-within:flex">
                {remoteName !== null && (
                  <button
                    type="button"
                    title={t('tags.push', { remote: remoteName })}
                    aria-label={t('tags.push', { remote: remoteName })}
                    className="rounded p-0.5 text-muted hover:bg-ink/10 hover:text-ink"
                    onClick={(event) => {
                      event.stopPropagation()
                      pushTag(tag.name)
                    }}
                  >
                    <UploadIcon className="size-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  title={t('tags.delete')}
                  aria-label={t('tags.delete')}
                  className="rounded p-0.5 text-muted hover:bg-danger/10 hover:text-danger"
                  onClick={(event) => {
                    event.stopPropagation()
                    setDeleteAsk({ tag, onRemote: remoteHasTag(tag.name) })
                  }}
                >
                  <TrashIcon className="size-3.5" />
                </button>
              </span>
            </div>
          ))}

          <div className="mt-1 flex items-center gap-2 border-t border-line px-3 py-1">
            <p className="min-w-0 flex-1 truncate text-xs font-semibold tracking-wide text-muted uppercase">
              {remoteLoading
                ? t('tags.remoteLoading')
                : remoteName === null
                  ? t('tags.remoteSectionNoRemote')
                  : t('tags.remoteSection', { remote: remoteName })}
            </p>
            {remoteName !== null && (
              <>
                <button
                  type="button"
                  className="shrink-0 rounded px-1.5 py-0.5 text-xs text-muted hover:bg-ink/5 hover:text-ink"
                  onClick={fetchTags}
                >
                  {t('tags.fetchTags')}
                </button>
                <button
                  type="button"
                  className="shrink-0 rounded px-1.5 py-0.5 text-xs text-muted hover:bg-ink/5 hover:text-ink"
                  onClick={pushAll}
                >
                  {t('tags.pushAll')}
                </button>
              </>
            )}
          </div>
          {remoteName === null && remoteError === null && !remoteLoading && (
            <p className="px-3 py-2 text-xs text-muted">{t('tags.remoteSectionHint')}</p>
          )}
          {remoteError !== null && (
            <p className="flex items-center gap-2 px-3 py-2 text-xs text-muted">
              <span className="min-w-0 flex-1 break-words">{remoteError}</span>
              <button
                type="button"
                className="shrink-0 rounded border border-line px-1.5 py-0.5 hover:bg-ink/5 hover:text-ink"
                onClick={() => void loadRemote()}
              >
                {t('tags.retry')}
              </button>
            </p>
          )}
          {remoteName !== null && !remoteLoading && remoteTags.length === 0 && (
            <p className="px-3 py-2 text-xs text-muted">{t('tags.remoteEmpty')}</p>
          )}
          {remoteName !== null &&
            remoteTags.map((tag) => (
              <div key={tag.name} className="group flex h-8 items-center gap-2 px-2 hover:bg-ink/5">
                <span className="min-w-0 flex-1 truncate pl-5 font-mono text-sm text-ink">
                  {tag.name}
                </span>
                <span className="shrink-0 font-mono text-xs text-muted">{tag.sha.slice(0, 7)}</span>
                <button
                  type="button"
                  title={t('tags.deleteOnRemote', { remote: remoteName })}
                  aria-label={t('tags.deleteOnRemote', { remote: remoteName })}
                  className="hidden shrink-0 rounded p-0.5 text-muted hover:bg-danger/10 hover:text-danger group-hover:block group-focus-within:block"
                  onClick={() => setRemoteDeleteAsk(tag)}
                >
                  <TrashIcon className="size-3.5" />
                </button>
              </div>
            ))}
        </div>

        {error !== null && (
          <p className="border-t border-line px-3 py-1.5 text-xs break-words text-danger">{error}</p>
        )}

        <div className="flex items-center gap-2 border-t border-line px-3 py-1.5">
          <button
            type="button"
            className="rounded border border-line px-2 py-1 text-xs text-ink hover:bg-ink/5"
            onClick={() => setCreate(true)}
          >
            {t('tags.newTag')}
          </button>
        </div>
      </div>

      {create && (
        <CreateTagDialog
          record={record}
          onClose={() => {
            setCreate(false)
            void loadLocal()
          }}
        />
      )}

      {deleteAsk !== null && (
        <ConfirmDialog
          title={t('tags.deleteTitle', { name: deleteAsk.tag.name })}
          body={deleteAsk.onRemote ? t('tags.deleteBodyRemote', { remote: remoteName ?? '' }) : t('tags.deleteBody')}
          confirmLabel={t('tags.deleteAction')}
          danger
          onConfirm={() => {
            const target = deleteAsk
            setDeleteAsk(null)
            deleteLocal(target.tag, target.onRemote)
          }}
          onClose={() => setDeleteAsk(null)}
        />
      )}

      {remoteDeleteAsk !== null && (
        <ConfirmDialog
          title={t('tags.remoteDeleteTitle', { name: remoteDeleteAsk.name, remote: remoteName ?? '' })}
          body={t('tags.remoteDeleteBody')}
          confirmLabel={t('tags.deleteAction')}
          danger
          onConfirm={() => deleteOnRemote(remoteDeleteAsk)}
          onClose={() => setRemoteDeleteAsk(null)}
        />
      )}
    </div>
  )
}

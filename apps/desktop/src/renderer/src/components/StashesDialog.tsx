import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { FileChange, RepoRecord, StashEntry } from '@gitreedesk/shared'
import { api } from '../api'
import { repoInfoOf, useEditor } from '../contexts/editor'
import { useSettings } from '../contexts/settings'
import { errorText, notifyUndoable } from '../lib/reporting'
import { relativeTime } from '../lib/relative-time'
import { notify } from '../notify'
import { ConfirmDialog } from './ConfirmDialog'
import { StashCreateDialog } from './StashCreateDialog'
import { ChevronRightIcon, XIcon } from './icons'

/** Lists the stash entries with apply/pop/drop, inline file previews and creation. */
export function StashesDialog({
  record,
  onClose
}: {
  record: RepoRecord
  onClose: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const settings = useSettings()
  const editor = useEditor()

  const [stashes, setStashes] = useState<readonly StashEntry[] | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [files, setFiles] = useState<readonly FileChange[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [dropAsk, setDropAsk] = useState<StashEntry | null>(null)
  const [create, setCreate] = useState(false)
  const busyRef = useRef(false)

  const load = useCallback(async (): Promise<void> => {
    try {
      const { stashes: loaded } = await api.invoke('git:stashList', { gitDir: record.gitDir })
      setStashes(loaded)
      setExpanded((current) =>
        current !== null && loaded.some((entry) => entry.selector === current) ? current : null
      )
    } catch (failure) {
      setError(errorText(failure, t))
    }
  }, [record.gitDir, t])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (expanded === null || stashes === null) {
      setFiles(null)
      return
    }
    const entry = stashes.find((candidate) => candidate.selector === expanded)
    if (entry === undefined) {
      setFiles(null)
      return
    }
    let live = true
    setFiles(null)
    void api.invoke('git:stashFiles', { gitDir: record.gitDir, stash: entry.selector }).then(
      ({ files: loaded }) => {
        if (live) setFiles(loaded)
      },
      () => {
        if (live) {
          setFiles([])
          notify({ message: t('stash.loadFiles'), tone: 'error' })
        }
      }
    )
    return () => {
      live = false
    }
  }, [expanded, record.gitDir, stashes, t])

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

  const apply = useCallback(
    (entry: StashEntry): void => {
      void run('apply', async () => {
        const result = await api.invoke('git:stashApply', {
          gitDir: record.gitDir,
          stash: entry.selector
        })
        if (result.stopped) {
          notify({ message: t('stash.applyStopped'), tone: 'error' })
        } else {
          notifyUndoable(t, record.gitDir, t('stash.applied'), result.undo)
        }
        await load()
      })
    },
    [load, record.gitDir, run, t]
  )

  const pop = useCallback(
    (entry: StashEntry): void => {
      void run('pop', async () => {
        const result = await api.invoke('git:stashPop', {
          gitDir: record.gitDir,
          stash: entry.selector
        })
        if (result.stopped) {
          notify({ message: t('stash.popStopped'), tone: 'error' })
        } else {
          notifyUndoable(t, record.gitDir, t('stash.popped'), result.undo)
        }
        await load()
      })
    },
    [load, record.gitDir, run, t]
  )

  const drop = useCallback(
    (entry: StashEntry): void => {
      setDropAsk(null)
      void run('drop', async () => {
        const result = await api.invoke('git:stashDrop', {
          gitDir: record.gitDir,
          stash: entry.selector
        })
        notifyUndoable(t, record.gitDir, t('stash.dropped'), result.undo)
        await load()
      })
    },
    [load, record.gitDir, run, t]
  )

  const showFile = useCallback(
    (entry: StashEntry, file: FileChange): void => {
      editor.openDiff(repoInfoOf(record), {
        path: file.path,
        origPath: file.origPath,
        from: { kind: 'rev', rev: `${entry.sha}^` },
        to: { kind: 'rev', rev: entry.sha }
      })
    },
    [editor, record]
  )

  const blocking = dropAsk !== null || create

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
        aria-label={t('stash.listTitle', { name: record.name })}
        className="h-fit w-full max-w-xl overflow-hidden rounded-lg border border-line bg-panel shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !blocking) onClose()
        }}
      >
        <header className="flex items-center gap-2 border-b border-line px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
            {t('stash.listTitle', { name: record.name })}
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
          {stashes !== null && stashes.length === 0 && (
            <p className="px-3 py-4 text-center text-sm text-muted">{t('stash.empty')}</p>
          )}
          {stashes?.map((entry) => {
            const open = expanded === entry.selector
            return (
              <div key={entry.selector}>
                <div className="group flex h-8 items-center gap-1 px-2 hover:bg-ink/5">
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-label={t('stash.show')}
                    className="shrink-0 rounded p-0.5 text-muted hover:bg-ink/10 hover:text-ink"
                    onClick={() => setExpanded(open ? null : entry.selector)}
                  >
                    <ChevronRightIcon className={`size-3.5 ${open ? 'rotate-90' : ''}`} />
                  </button>
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    title={t('stash.show')}
                    onClick={() => setExpanded(open ? null : entry.selector)}
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{entry.subject}</span>
                    {entry.branch !== null && (
                      <span className="max-w-[25%] shrink-0 truncate font-mono text-xs text-muted">
                        {entry.branch}
                      </span>
                    )}
                    <span className="shrink-0 text-xs text-muted">
                      {t('stash.files', { count: entry.files })}
                    </span>
                    <span className="shrink-0 text-xs text-muted">
                      {relativeTime(entry.at, settings.locale)}
                    </span>
                  </button>
                  <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex group-focus-within:flex">
                    <button
                      type="button"
                      className="shrink-0 rounded px-1.5 py-0.5 text-xs text-muted hover:bg-ink/10 hover:text-ink"
                      onClick={() => apply(entry)}
                    >
                      {t('stash.apply')}
                    </button>
                    <button
                      type="button"
                      className="shrink-0 rounded px-1.5 py-0.5 text-xs text-muted hover:bg-ink/10 hover:text-ink"
                      onClick={() => pop(entry)}
                    >
                      {t('stash.pop')}
                    </button>
                    <button
                      type="button"
                      className="shrink-0 rounded px-1.5 py-0.5 text-xs text-muted hover:bg-danger/10 hover:text-danger"
                      onClick={() => setDropAsk(entry)}
                    >
                      {t('stash.drop')}
                    </button>
                  </span>
                </div>
                {open && (
                  <div className="pb-1">
                    {files === null && (
                      <p className="px-6 py-1 text-xs text-muted">…</p>
                    )}
                    {files?.map((file) => (
                      <button
                        key={`${file.path}\u0000${file.kind}`}
                        type="button"
                        className="flex h-6 w-full items-center gap-2 px-6 text-left hover:bg-ink/5"
                        onClick={() => showFile(entry, file)}
                      >
                        <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink">
                          {file.origPath === undefined || file.origPath === file.path
                            ? file.path
                            : `${file.origPath} → ${file.path}`}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
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
            {t('stash.newButton')}
          </button>
        </div>
      </div>

      {create && (
        <StashCreateDialog
          record={record}
          onClose={() => {
            setCreate(false)
            void load()
          }}
        />
      )}

      {dropAsk !== null && (
        <ConfirmDialog
          title={t('stash.dropTitle')}
          body={t('stash.dropBody', { message: dropAsk.subject })}
          confirmLabel={t('stash.dropAction')}
          danger
          onConfirm={() => drop(dropAsk)}
          onClose={() => setDropAsk(null)}
        />
      )}
    </div>
  )
}

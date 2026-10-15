import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { GtdIpcError, type ChangeKind, type FileChange, type GitRef, type RepoRecord } from '@gitreedesk/shared'
import { api } from '../api'
import { repoInfoOf, useEditor } from '../contexts/editor'
import { useOperations } from '../contexts/operations-context'
import { useSettings } from '../contexts/settings'
import { useWorkspace } from '../contexts/workspace'
import { fuzzyFilter } from '../lib/fuzzy'
import { errorText, notifyServiceError, stashNotice } from '../lib/reporting'
import { relativeTime } from '../lib/relative-time'
import { notify } from '../notify'
import { ConfirmDialog } from './ConfirmDialog'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'
import { CreateBranchDialog } from './CreateBranchDialog'
import { PromptDialog } from './PromptDialog'
import { SearchIcon, UploadIcon, XIcon } from './icons'

const CHANGE_LETTER: Record<ChangeKind, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  typeChanged: 'T'
}

export function BranchPicker({
  record,
  onClose
}: {
  record: RepoRecord
  onClose: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const settings = useSettings()
  const { statuses } = useWorkspace()
  const operations = useOperations()
  const editor = useEditor()

  const [refs, setRefs] = useState<readonly GitRef[] | null>(null)
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; ref: GitRef } | null>(null)
  const [create, setCreate] = useState<{ initialName?: string; startPoint?: string } | null>(null)
  const [renameTarget, setRenameTarget] = useState<GitRef | null>(null)
  const [deleteAsk, setDeleteAsk] = useState<{ ref: GitRef; phase: 'confirm' | 'unmerged' } | null>(null)
  const [upstreamTarget, setUpstreamTarget] = useState<GitRef | null>(null)
  const [compare, setCompare] = useState<{ branch: string; files: readonly FileChange[] } | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const busyRef = useRef(false)

  const status = statuses.get(record.gitDir)?.status ?? null
  const detachedSha = status !== null && status.head.detached ? status.head.sha : null
  const bare = record.kind === 'bare'

  const load = useCallback(async (): Promise<void> => {
    try {
      const { refs: loaded } = await api.invoke('git:refs', { gitDir: record.gitDir })
      setRefs(loaded)
    } catch (failure) {
      setError(errorText(failure, t))
    }
  }, [record.gitDir, t])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const local = useMemo(
    () => fuzzyFilter(query, (refs ?? []).filter((ref) => ref.kind === 'branch'), (ref) => ref.name),
    [refs, query]
  )
  const remoteBranches = useMemo(
    () => fuzzyFilter(query, (refs ?? []).filter((ref) => ref.kind === 'remote'), (ref) => ref.name),
    [refs, query]
  )

  const blocking =
    menu !== null ||
    create !== null ||
    renameTarget !== null ||
    deleteAsk !== null ||
    upstreamTarget !== null ||
    compare !== null

  const run = useCallback(
    async (
      label: string,
      task: () => Promise<void>,
      handled?: (failure: unknown) => boolean
    ): Promise<void> => {
      if (busyRef.current) return
      busyRef.current = true
      setBusy(label)
      setError(null)
      try {
        await task()
      } catch (failure) {
        if (handled === undefined || !handled(failure)) setError(errorText(failure, t))
      } finally {
        busyRef.current = false
        setBusy(null)
      }
    },
    [t]
  )

  const reportStash = useCallback(
    (stash: { stashed: boolean; stashRestored: boolean; stashConflict: boolean }): void => {
      const notice = stashNotice(stash, t)
      if (notice !== null) notify({ message: notice, tone: stash.stashConflict ? 'error' : 'info' })
    },
    [t]
  )

  const checkout = useCallback(
    (ref: GitRef): void => {
      if (bare) {
        notify({ message: t('branches.bareCheckout'), tone: 'error' })
        return
      }
      void run(ref.name, async () => {
        const { stash } = await api.invoke('git:branchCheckout', {
          gitDir: record.gitDir,
          name: ref.name
        })
        notify({ message: t('branches.switched', { name: ref.name }) })
        reportStash(stash)
        onClose()
      })
    },
    [bare, onClose, record.gitDir, reportStash, run, t]
  )

  const checkoutRemote = useCallback((ref: GitRef): void => {
    const slash = ref.name.indexOf('/')
    const branchName = slash === -1 ? ref.name : ref.name.slice(slash + 1)
    setCreate({ initialName: branchName, startPoint: ref.name })
  }, [])

  const copyName = useCallback((name: string): void => {
    void api.invoke('app:copyText', { text: name }).catch((failure: unknown) => {
      notifyServiceError(failure, t)
    })
  }, [t])

  const openCompareFile = useCallback(
    (branch: string, file: FileChange): void => {
      editor.openDiff(repoInfoOf(record), {
        path: file.path,
        origPath: file.origPath,
        from: { kind: 'rev', rev: 'HEAD' },
        to: { kind: 'rev', rev: branch }
      })
    },
    [editor, record]
  )

  const runCompare = useCallback(
    (ref: GitRef): void => {
      void run('compare', async () => {
        const { files } = await api.invoke('git:diffFiles', {
          gitDir: record.gitDir,
          from: 'HEAD',
          to: ref.name
        })
        if (files.length === 0) {
          notify({ message: t('branches.noDiff', { branch: ref.name }) })
          onClose()
          return
        }
        const first = files[0]
        if (files.length === 1 && first !== undefined) {
          openCompareFile(ref.name, first)
          onClose()
          return
        }
        setCompare({ branch: ref.name, files })
      })
    },
    [onClose, openCompareFile, record.gitDir, run, t]
  )

  const deleteBranch = useCallback(
    (ref: GitRef, force: boolean): void => {
      void run(
        'delete',
        async () => {
          const result = await api.invoke('git:branchDelete', {
            gitDir: record.gitDir,
            name: ref.name,
            ...(force ? { force: true } : {})
          })
          const backup = result.backup
          if (backup !== null) {
            notify({
              message: t('branches.deletedBackup', { name: ref.name }),
              action: {
                label: t('branches.undo'),
                run: () => {
                  void (async () => {
                    try {
                      await api.invoke('git:branchCreate', {
                        gitDir: record.gitDir,
                        name: ref.name,
                        startPoint: backup.sha
                      })
                      notify({ message: t('branches.restored', { name: ref.name }) })
                    } catch (failure) {
                      notifyServiceError(failure, t)
                    }
                  })()
                }
              }
            })
          } else {
            notify({ message: t('branches.deleted', { name: ref.name }) })
          }
          await load()
        },
        (failure) => {
          if (
            !force &&
            failure instanceof GtdIpcError &&
            failure.code === 'branch-unmerged'
          ) {
            setDeleteAsk({ ref, phase: 'unmerged' })
            return true
          }
          return false
        }
      )
    },
    [load, record.gitDir, run, t]
  )

  const submitRename = useCallback(
    (value: string): void => {
      const ref = renameTarget
      setRenameTarget(null)
      if (ref === null) return
      const newName = value.trim()
      if (newName === '' || newName === ref.name) return
      void run('rename', async () => {
        await api.invoke('git:branchRename', {
          gitDir: record.gitDir,
          name: ref.name,
          newName
        })
        notify({ message: t('branches.renamed', { old: ref.name, new: newName }) })
        await load()
      })
    },
    [load, record.gitDir, renameTarget, run, t]
  )

  const setUpstream = useCallback(
    (branch: GitRef, upstream: GitRef): void => {
      setUpstreamTarget(null)
      void run('upstream', async () => {
        await api.invoke('git:branchSetUpstream', {
          gitDir: record.gitDir,
          name: branch.name,
          upstream: upstream.name
        })
        notify({
          message: t('branches.upstreamSet', { branch: branch.name, upstream: upstream.name })
        })
        await load()
      })
    },
    [load, record.gitDir, run, t]
  )

  const menuItems = (ref: GitRef): ContextMenuItem[] => {
    const isHead = ref.isHead || (status !== null && status.head.ref === ref.name)
    if (ref.kind === 'remote') {
      return [
        {
          label: t('branches.checkoutAsLocal'),
          disabled: bare,
          onSelect: () => checkoutRemote(ref)
        },
        { label: t('branches.copyName'), onSelect: () => copyName(ref.name) }
      ]
    }
    const onBranch = status !== null && status.head.ref !== null
    const mergeDisabled = isHead || bare || !onBranch
    return [
      { label: t('branches.checkout'), disabled: isHead || bare, onSelect: () => checkout(ref) },
      {
        label: ref.upstream === null ? t('branches.publish') : t('branches.push'),
        onSelect: () =>
          operations.pushBranch(record, ref.name, { hasUpstream: ref.upstream !== null })
      },
      {
        label: t('merge.menu'),
        divider: true,
        disabled: mergeDisabled,
        onSelect: () => {
          onClose()
          operations.beginMerge(record, ref.name)
        }
      },
      {
        label: t('rebase.menu'),
        disabled: mergeDisabled,
        onSelect: () => {
          onClose()
          operations.rebaseOnto(record, ref.name)
        }
      },
      {
        label: t('rebase.interactiveMenu'),
        disabled: mergeDisabled,
        onSelect: () => {
          onClose()
          operations.beginInteractiveRebase(record, ref.name)
        }
      },
      { divider: true, label: t('branches.rename'), disabled: bare, onSelect: () => setRenameTarget(ref) },
      {
        label: t('branches.delete'),
        disabled: isHead || bare,
        onSelect: () => setDeleteAsk({ ref, phase: 'confirm' })
      },
      {
        label: ref.upstream === null ? t('branches.setUpstream') : t('branches.changeUpstream'),
        disabled: bare || remoteBranches.length === 0,
        onSelect: () => setUpstreamTarget(ref)
      },
      {
        label: t('branches.compare'),
        divider: true,
        disabled: isHead || status === null,
        onSelect: () => runCompare(ref)
      },
      { label: t('branches.copyName'), onSelect: () => copyName(ref.name) }
    ]
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape' && !blocking) {
      event.preventDefault()
      onClose()
    }
  }

  const date = (ref: GitRef): string => relativeTime(ref.updatedAt, settings.locale)

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
        aria-label={t('branches.title', { name: record.name })}
        className="h-fit w-full max-w-xl overflow-hidden rounded-lg border border-line bg-panel shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-line px-3 py-2">
          <SearchIcon className="size-4 shrink-0 text-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t('branches.filterPlaceholder')}
            aria-label={t('branches.filterPlaceholder')}
            className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-muted"
          />
          {busy !== null && <span className="shrink-0 animate-pulse text-xs text-muted">…</span>}
        </div>

        {detachedSha !== null && (
          <div className="flex items-center gap-2 border-b border-line bg-warn/10 px-3 py-1.5 text-xs text-warn">
            <span className="min-w-0 flex-1 truncate">
              {t('branches.detachedBanner', { sha: detachedSha.slice(0, 7) })}
            </span>
            <button
              type="button"
              className="shrink-0 rounded border border-warn/40 px-1.5 py-0.5 hover:bg-warn/15"
              onClick={() => setCreate({ startPoint: detachedSha })}
            >
              {t('branches.createHere')}
            </button>
          </div>
        )}

        <div className="max-h-96 overflow-y-auto py-1">
          {refs !== null && local.length === 0 && remoteBranches.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-muted">
              {refs.length === 0 ? t('branches.empty') : t('branches.noResults')}
            </p>
          )}
          {local.length > 0 && (
            <BranchSection title={t('branches.localSection', { count: local.length })}>
              {local.map((ref) => renderBranchRow(ref))}
            </BranchSection>
          )}
          {remoteBranches.length > 0 && (
            <BranchSection title={t('branches.remoteSection', { count: remoteBranches.length })}>
              {remoteBranches.map((ref) => renderBranchRow(ref))}
            </BranchSection>
          )}
        </div>

        {error !== null && (
          <p className="border-t border-line px-3 py-1.5 text-xs break-words text-danger">{error}</p>
        )}

        <div className="flex items-center gap-2 border-t border-line px-3 py-1.5">
          <button
            type="button"
            disabled={bare}
            className="rounded border border-line px-2 py-1 text-xs text-ink hover:bg-ink/5 disabled:opacity-40"
            onClick={() => setCreate({})}
          >
            {t('branches.newBranch')}
          </button>
          <span className="min-w-0 flex-1" />
          <button
            type="button"
            aria-label={t('dialogs.close')}
            className="rounded p-1 text-muted hover:bg-ink/5 hover:text-ink"
            onClick={onClose}
          >
            <XIcon className="size-3.5" />
          </button>
        </div>
      </div>

      {menu !== null && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems(menu.ref)}
          onClose={() => setMenu(null)}
        />
      )}

      {create !== null && (
        <CreateBranchDialog
          record={record}
          {...(create.initialName !== undefined ? { initialName: create.initialName } : {})}
          {...(create.startPoint !== undefined ? { initialStartPoint: create.startPoint } : {})}
          onClose={() => setCreate(null)}
          onCreated={() => void load()}
        />
      )}

      {renameTarget !== null && (
        <PromptDialog
          title={t('branches.renameTitle', { name: renameTarget.name })}
          label={t('branches.newNameLabel')}
          initialValue={renameTarget.name}
          submitLabel={t('branches.renameAction')}
          hint={t('branches.renameHint')}
          onSubmit={submitRename}
          onClose={() => setRenameTarget(null)}
        />
      )}

      {deleteAsk !== null && deleteAsk.phase === 'confirm' && (
        <ConfirmDialog
          title={t('branches.deleteTitle', { name: deleteAsk.ref.name })}
          body={t('branches.deleteBody')}
          confirmLabel={t('branches.deleteAction')}
          danger
          onConfirm={() => {
            const ref = deleteAsk.ref
            setDeleteAsk(null)
            deleteBranch(ref, false)
          }}
          onClose={() => setDeleteAsk(null)}
        />
      )}

      {deleteAsk !== null && deleteAsk.phase === 'unmerged' && (
        <ConfirmDialog
          title={t('branches.deleteUnmergedTitle', { name: deleteAsk.ref.name })}
          body={t('branches.deleteUnmergedBody')}
          confirmLabel={t('branches.deleteAction')}
          danger
          onConfirm={() => {
            const ref = deleteAsk.ref
            setDeleteAsk(null)
            deleteBranch(ref, true)
          }}
          onClose={() => setDeleteAsk(null)}
        />
      )}

      {upstreamTarget !== null && (
        <UpstreamPicker
          branch={upstreamTarget}
          refs={refs ?? []}
          onPick={(upstream) => setUpstream(upstreamTarget, upstream)}
          onClose={() => setUpstreamTarget(null)}
        />
      )}

      {compare !== null && (
        <div
          className="fixed inset-0 z-50 flex justify-center bg-black/40 pt-24"
          onMouseDown={() => setCompare(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="h-fit w-full max-w-lg overflow-hidden rounded-lg border border-line bg-panel shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="flex items-center gap-2 border-b border-line px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
                {t('branches.compareTitle', { branch: compare.branch })}
              </span>
              <button
                type="button"
                aria-label={t('dialogs.close')}
                className="shrink-0 rounded p-0.5 text-muted hover:bg-ink/5 hover:text-ink"
                onClick={() => setCompare(null)}
              >
                <XIcon className="size-3.5" />
              </button>
            </header>
            <ul className="max-h-96 overflow-y-auto py-1">
              {compare.files.map((file) => (
                <li key={`${file.origPath ?? ''}\u0000${file.path}`}>
                  <button
                    type="button"
                    className="flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-sm hover:bg-ink/5"
                    onClick={() => {
                      openCompareFile(compare.branch, file)
                      setCompare(null)
                      onClose()
                    }}
                  >
                    <span className="w-3 shrink-0 text-center font-mono text-xs text-muted">
                      {CHANGE_LETTER[file.kind]}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-ink">{file.path}</span>
                    {file.origPath !== undefined && (
                      <span className="min-w-0 shrink-0 truncate font-mono text-xs text-muted">
                        ← {file.origPath}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  )

  function renderBranchRow(ref: GitRef): JSX.Element {
    const isHead = ref.isHead || (status !== null && status.head.ref === ref.name)
    const isRemote = ref.kind === 'remote'
    return (
      <div
        key={ref.fullName}
        className="group flex h-8 items-center gap-2 px-2 hover:bg-ink/5"
      >
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => {
            if (isRemote) checkoutRemote(ref)
            else checkout(ref)
          }}
        >
          <span
            className={`w-1.5 shrink-0 self-stretch rounded-full ${isHead ? 'bg-accent' : ''}`}
            aria-hidden="true"
          />
          <span
            className={`min-w-0 shrink-0 max-w-[45%] truncate font-mono text-sm ${
              isHead ? 'font-semibold text-ink' : 'text-ink'
            }`}
          >
            {ref.name}
          </span>
          {isHead && (
            <span className="shrink-0 rounded bg-accent/15 px-1 text-[10px] text-accent">
              {t('branches.current')}
            </span>
          )}
          {ref.upstream !== null && (
            <span className="hidden min-w-0 truncate font-mono text-xs text-muted sm:inline">
              {ref.upstream}
            </span>
          )}
          <span className="min-w-0 flex-1" />
          {ref.behind > 0 && <span className="shrink-0 text-xs text-muted">↓{ref.behind}</span>}
          {ref.ahead > 0 && <span className="shrink-0 text-xs text-muted">↑{ref.ahead}</span>}
          {ref.subject !== null && (
            <span className="max-w-[35%] shrink-0 truncate text-xs text-muted">{ref.subject}</span>
          )}
          <span className="shrink-0 text-xs text-muted">{date(ref)}</span>
        </button>
        <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex group-focus-within:flex">
          {!isRemote && (
            <button
              type="button"
              title={ref.upstream === null ? t('branches.publish') : t('branches.push')}
              aria-label={ref.upstream === null ? t('branches.publish') : t('branches.push')}
              className="rounded p-0.5 text-muted hover:bg-ink/10 hover:text-ink"
              onClick={(event) => {
                event.stopPropagation()
                operations.pushBranch(record, ref.name, { hasUpstream: ref.upstream !== null })
              }}
            >
              <UploadIcon className="size-3.5" />
            </button>
          )}
          <button
            type="button"
            title={t('branches.menu')}
            aria-label={t('branches.menu')}
            aria-haspopup="menu"
            className="rounded px-1 text-muted hover:bg-ink/10 hover:text-ink"
            onClick={(event) => {
              event.stopPropagation()
              const rect = event.currentTarget.getBoundingClientRect()
              setMenu({ x: rect.right, y: rect.bottom + 2, ref })
            }}
          >
            ⋯
          </button>
        </span>
      </div>
    )
  }
}

function BranchSection({
  title,
  children
}: {
  title: string
  children: readonly JSX.Element[]
}): JSX.Element {
  return (
    <div>
      <p className="px-3 py-1 text-xs font-semibold tracking-wide text-muted uppercase">{title}</p>
      {children}
    </div>
  )
}

function UpstreamPicker({
  branch,
  refs,
  onPick,
  onClose
}: {
  branch: GitRef
  refs: readonly GitRef[]
  onPick: (upstream: GitRef) => void
  onClose: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)
  const candidates = useMemo(
    () => fuzzyFilter(query, refs.filter((ref) => ref.kind === 'remote'), (ref) => ref.name),
    [refs, query]
  )

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-black/40 pt-32" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="h-fit w-full max-w-md overflow-hidden rounded-lg border border-line bg-panel shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-center gap-2 border-b border-line px-3 py-2">
          <SearchIcon className="size-4 shrink-0 text-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                onClose()
              }
            }}
            placeholder={t('branches.upstreamTitle', { branch: branch.name })}
            aria-label={t('branches.upstreamTitle', { branch: branch.name })}
            className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-muted"
          />
        </header>
        <ul className="max-h-72 overflow-y-auto py-1">
          {candidates.length === 0 && (
            <li className="px-3 py-4 text-center text-sm text-muted">{t('branches.noResults')}</li>
          )}
          {candidates.map((ref) => (
            <li key={ref.fullName}>
              <button
                type="button"
                className="flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-sm hover:bg-ink/5"
                onClick={() => onPick(ref)}
              >
                <span className="min-w-0 flex-1 truncate font-mono text-ink">{ref.name}</span>
                {ref.subject !== null && (
                  <span className="max-w-[45%] shrink-0 truncate text-xs text-muted">
                    {ref.subject}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

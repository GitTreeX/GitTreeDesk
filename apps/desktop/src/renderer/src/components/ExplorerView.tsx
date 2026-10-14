import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { FsEntry, RepoRecord } from '@gitreedesk/shared'
import { api } from '../api'
import { isEditableTarget } from '../commands/keybinding'
import { useEditor } from '../contexts/editor'
import { useTerminal } from '../contexts/terminal'
import { useTreeUi } from '../contexts/tree'
import { useWorkspace } from '../contexts/workspace'
import { notify, notifyError } from '../notify'
import { ancestorsWithin, visibleRows, type ExplorerRow } from '../tree/explorer-model'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'
import { ConfirmDialog } from './ConfirmDialog'
import { PromptDialog } from './PromptDialog'
import { branchLabel, RepoBadges } from './RepoBadges'
import {
  ChevronRightIcon,
  FileIcon,
  FilePlusIcon,
  FolderIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  LinkIcon
} from './icons'

const ROW_HEIGHT = 28
const EMPTY_CHILDREN: ReadonlyMap<string, readonly FsEntry[]> = new Map()

function parentOf(path: string): string | null {
  const index = path.lastIndexOf('/')
  return index <= 0 ? null : path.slice(0, index)
}

function errorText(error: unknown): { message: string; details: string } {
  const details = error instanceof Error ? error.message : String(error)
  return { message: details, details }
}

interface NewEntryState {
  dir: string
  kind: 'file' | 'dir'
}

export function ExplorerView(): JSX.Element {
  const { t } = useTranslation()
  const { descriptor, statuses } = useWorkspace()
  const tree = useTreeUi()
  const editor = useEditor()
  const terminal = useTerminal()
  const root = descriptor?.root ?? ''

  const [children, setChildren] = useState<ReadonlyMap<string, readonly FsEntry[]>>(EMPTY_CHILDREN)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [cursorPath, setCursorPath] = useState<string | null>(null)
  const [rootError, setRootError] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; row: ExplorerRow } | null>(null)
  const [newEntry, setNewEntry] = useState<NewEntryState | null>(null)
  const [renaming, setRenaming] = useState<ExplorerRow | null>(null)
  const [trashing, setTrashing] = useState<ExplorerRow | null>(null)

  const childrenRef = useRef(children)
  childrenRef.current = children
  const rowsRef = useRef<readonly ExplorerRow[]>([])
  const cursorRef = useRef<string | null>(null)
  cursorRef.current = cursorPath
  const pendingScrollRef = useRef<string | null>(null)

  const collator = useMemo(() => new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }), [])

  const rows = useMemo(
    () => (root === '' ? [] : visibleRows(root, children, expanded, collator)),
    [root, children, expanded, collator]
  )
  rowsRef.current = rows

  const recordByPath = useMemo(() => {
    const map = new Map<string, RepoRecord>()
    for (const record of descriptor?.records ?? []) map.set(record.path, record)
    return map
  }, [descriptor])

  const cursorIndex = cursorPath === null ? -1 : rows.findIndex((row) => row.path === cursorPath)

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12
  })

  const load = useCallback(
    async (dir: string, silent: boolean): Promise<void> => {
      try {
        const { entries } = await api.invoke('fs:readDir', { path: dir })
        setChildren((current) => new Map(current).set(dir, entries))
        if (dir === root) setRootError(null)
      } catch (error) {
        if (!silent) {
          const { message, details } = errorText(error)
          notifyError(message, details)
          if (dir === root) setRootError(message)
        }
      }
    },
    [root]
  )

  useEffect(() => {
    setChildren(EMPTY_CHILDREN)
    setExpanded(new Set())
    setCursorPath(null)
    setRootError(null)
    void load(root, false)
  }, [root, load])

  // Watch the root plus every expanded folder; release everything on unmount.
  const watchedRef = useRef(new Set<string>())
  useEffect(() => {
    if (root === '') return
    const watched = watchedRef.current
    const desired = new Set([root, ...expanded])
    for (const dir of desired) {
      if (watched.has(dir)) continue
      watched.add(dir)
      void api.invoke('fs:watch', { path: dir }).catch(() => {
        watched.delete(dir)
      })
    }
    for (const dir of [...watched]) {
      if (desired.has(dir)) continue
      watched.delete(dir)
      void api.invoke('fs:unwatch', { path: dir }).catch(() => undefined)
    }
  }, [root, expanded])

  useEffect(() => {
    const watched = watchedRef.current
    return () => {
      for (const dir of watched) void api.invoke('fs:unwatch', { path: dir }).catch(() => undefined)
      watched.clear()
    }
  }, [])

  const refresh = useCallback(
    (dirs: Iterable<string>): void => {
      const seen = new Set<string>()
      for (const dir of dirs) {
        if (seen.has(dir)) continue
        seen.add(dir)
        if (dir === root || childrenRef.current.has(dir)) void load(dir, true)
      }
    },
    [root, load]
  )

  useEffect(() => {
    if (root === '') return
    return api.on('fs:changed', (event) => {
      if (event.root !== root) return
      const dirs = new Set<string>()
      for (const path of event.paths) {
        const parent = parentOf(path)
        if (parent !== null && parent.startsWith(root)) dirs.add(parent)
      }
      refresh(dirs)
    })
  }, [root, refresh])

  useEffect(() => {
    if (root === '') return
    return api.on('workspace:reposChanged', (event) => {
      if (event.root !== root) return
      const dirs = new Set<string>()
      for (const record of [...event.added, ...event.removed, ...event.updated]) {
        for (const dir of ancestorsWithin(root, record.path)) dirs.add(dir)
        const parent = parentOf(record.path)
        if (parent !== null && parent.startsWith(root)) dirs.add(parent)
      }
      refresh(dirs)
    })
  }, [root, refresh])

  const toggleExpand = useCallback(
    (row: ExplorerRow): void => {
      if (!row.expandable) return
      if (expanded.has(row.path)) {
        setExpanded((current) => {
          const next = new Set(current)
          next.delete(row.path)
          return next
        })
        return
      }
      setExpanded((current) => new Set(current).add(row.path))
      if (!childrenRef.current.has(row.path)) void load(row.path, false)
    },
    [expanded, load]
  )

  const collapse = useCallback((path: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      next.delete(path)
      return next
    })
  }, [])

  const openFile = useCallback(
    (path: string, preview: boolean): void => {
      editor.openFile(path, { preview })
    },
    [editor]
  )

  // Reveal requests from editor tabs: load and expand the ancestors, then scroll to the row.
  const pendingReveal = tree.pendingExplorerReveal
  useEffect(() => {
    if (pendingReveal === null) return
    tree.consumeExplorerReveal()
    if (root === '' || !pendingReveal.startsWith(`${root}/`)) return
    void (async () => {
      const dirs = ancestorsWithin(root, pendingReveal)
      for (const dir of dirs) {
        if (!childrenRef.current.has(dir)) await load(dir, true)
      }
      setExpanded((current) => new Set([...current, ...dirs]))
      setCursorPath(pendingReveal)
      pendingScrollRef.current = pendingReveal
    })()
  }, [pendingReveal, root, load, tree])

  useEffect(() => {
    const target = pendingScrollRef.current
    if (target === null) return
    const index = rows.findIndex((row) => row.path === target)
    if (index < 0) return
    pendingScrollRef.current = null
    scrollRef.current?.focus()
    virtualizer.scrollToIndex(index, { align: 'center' })
  }, [rows, virtualizer])

  const openInEditor = useCallback((path: string): void => {
    void api.invoke('editor:openInCode', { path }).catch((error: unknown) => {
      const { message, details } = errorText(error)
      notifyError(message, details)
    })
  }, [])

  const copyPath = useCallback((text: string): void => {
    void api.invoke('app:copyText', { text }).catch((error: unknown) => {
      const { message, details } = errorText(error)
      notifyError(message, details)
    })
  }, [])

  const reveal = useCallback((path: string): void => {
    void api.invoke('fs:reveal', { path }).catch((error: unknown) => {
      const { message, details } = errorText(error)
      notifyError(message, details)
    })
  }, [])

  const createEntry = useCallback(
    async (dir: string, kind: 'file' | 'dir', name: string): Promise<void> => {
      try {
        const { path } = await api.invoke('fs:create', { parent: dir, name, kind })
        if (dir !== root) setExpanded((current) => new Set(current).add(dir))
        await load(dir, false)
        setCursorPath(path)
        setNewEntry(null)
      } catch (error) {
        const { message, details } = errorText(error)
        notifyError(message, details)
      }
    },
    [root, load]
  )

  const renameEntry = useCallback(
    async (row: ExplorerRow, newName: string): Promise<void> => {
      try {
        const { path } = await api.invoke('fs:rename', { path: row.path, newName })
        const parent = parentOf(row.path)
        if (parent !== null) await load(parent, false)
        setCursorPath(path)
        setRenaming(null)
      } catch (error) {
        const { message, details } = errorText(error)
        notifyError(message, details)
      }
    },
    [load]
  )

  const trashEntry = useCallback(
    async (row: ExplorerRow): Promise<void> => {
      try {
        await api.invoke('fs:trash', { path: row.path })
        const parent = parentOf(row.path)
        if (parent !== null) await load(parent, false)
        setCursorPath((current) =>
          current === row.path || (current !== null && current.startsWith(`${row.path}/`)) ? null : current
        )
        notify({ message: t('notify.movedToTrash', { name: row.name }) })
      } catch (error) {
        const { message, details } = errorText(error)
        notifyError(message, details)
      } finally {
        setTrashing(null)
      }
    },
    [load, t]
  )

  // Imperative surface used by toolbar buttons, context menus, and commands.
  const actions = useMemo(
    () => ({
      hasCursor: () => cursorRef.current !== null,
      newFile: () => setNewEntry({ dir: targetDir(rowsRef.current, cursorRef.current, root), kind: 'file' }),
      newFolder: () => setNewEntry({ dir: targetDir(rowsRef.current, cursorRef.current, root), kind: 'dir' }),
      rename: () => {
        const row = cursorRow(rowsRef.current, cursorRef.current)
        if (row !== null) setRenaming(row)
      },
      remove: () => {
        const row = cursorRow(rowsRef.current, cursorRef.current)
        if (row !== null) setTrashing(row)
      },
      reveal: () => {
        const row = cursorRow(rowsRef.current, cursorRef.current)
        if (row !== null) reveal(row.path)
      },
      copyPath: () => {
        const row = cursorRow(rowsRef.current, cursorRef.current)
        if (row !== null) copyPath(row.path)
      },
      openInEditor: () => {
        const row = cursorRow(rowsRef.current, cursorRef.current)
        if (row !== null) openInEditor(row.path)
      }
    }),
    [root, reveal, copyPath, openInEditor]
  )

  useEffect(() => {
    tree.explorerActions.current = actions
    return () => {
      if (tree.explorerActions.current === actions) tree.explorerActions.current = null
    }
  }, [tree.explorerActions, actions])

  const focusRow = (path: string, index: number): void => {
    setCursorPath(path)
    scrollRef.current?.focus()
    virtualizer.scrollToIndex(index, { align: 'auto' })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (isEditableTarget(event.target as { tagName?: string; isContentEditable?: boolean })) return
    if (rows.length === 0) return
    const current = cursorIndex
    const row = current >= 0 ? rows[current] : undefined

    switch (event.key) {
      case 'ArrowDown': {
        event.preventDefault()
        const next = current < 0 ? 0 : Math.min(current + 1, rows.length - 1)
        const target = rows[next]
        if (target !== undefined) focusRow(target.path, next)
        break
      }
      case 'ArrowUp': {
        event.preventDefault()
        const next = current < 0 ? 0 : Math.max(current - 1, 0)
        const target = rows[next]
        if (target !== undefined) focusRow(target.path, next)
        break
      }
      case 'ArrowRight': {
        event.preventDefault()
        if (row === undefined) return
        if (row.expandable && !expanded.has(row.path)) {
          toggleExpand(row)
        } else {
          const child = rows[current + 1]
          if (child !== undefined && child.depth > row.depth) focusRow(child.path, current + 1)
        }
        break
      }
      case 'ArrowLeft': {
        event.preventDefault()
        if (row === undefined) return
        if (row.expandable && expanded.has(row.path)) {
          collapse(row.path)
        } else {
          for (let index = current - 1; index >= 0; index -= 1) {
            const candidate = rows[index]
            if (candidate !== undefined && candidate.depth < row.depth) {
              focusRow(candidate.path, index)
              break
            }
          }
        }
        break
      }
      case 'Enter': {
        event.preventDefault()
        if (row === undefined) return
        if (row.expandable) toggleExpand(row)
        else openFile(row.path, false)
        break
      }
      default:
        break
    }
  }

  const menuItems = (row: ExplorerRow): ContextMenuItem[] => {
    const target = row.kind === 'dir' ? row.path : (parentOf(row.path) ?? root)
    return [
      {
        label: t('menu.newFile'),
        disabled: row.kind !== 'dir',
        onSelect: () => setNewEntry({ dir: target, kind: 'file' })
      },
      {
        label: t('menu.newFolder'),
        disabled: row.kind !== 'dir',
        onSelect: () => setNewEntry({ dir: target, kind: 'dir' })
      },
      { label: t('menu.openInEditor'), onSelect: () => openInEditor(row.path) },
      { label: t('menu.openTerminal'), onSelect: () => terminal.open(target) },
      { label: t('menu.reveal'), onSelect: () => reveal(row.path) },
      { label: t('menu.copyPath'), onSelect: () => copyPath(row.path) },
      { label: t('menu.rename'), onSelect: () => setRenaming(row) },
      { label: t('menu.delete'), onSelect: () => setTrashing(row) }
    ]
  }

  const empty = rows.length === 0
  const cursorVisible = cursorIndex >= 0

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ExplorerToolbar
        onNewFile={() => actions.newFile()}
        onNewFolder={() => actions.newFolder()}
      />
      <div
        ref={scrollRef}
        tabIndex={0}
        role="tree"
        aria-label={t('view.explorer')}
        className="min-h-0 flex-1 overflow-auto outline-none"
        onKeyDown={onKeyDown}
        onContextMenu={(event) => {
          if (event.target === scrollRef.current) {
            event.preventDefault()
            setMenu(null)
          }
        }}
      >
        {empty && rootError !== null && (
          <div className="px-3 py-4">
            <p className="text-sm text-ink">{t('explorer.loadFailed')}</p>
            <button
              type="button"
              className="mt-2 rounded border border-line px-2 py-1 text-xs text-ink hover:bg-ink/5"
              onClick={() => void load(root, false)}
            >
              {t('explorer.retry')}
            </button>
          </div>
        )}
        {empty && rootError === null && (
          <p className="px-3 py-4 text-sm text-muted">{t('explorer.empty')}</p>
        )}
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index]
            if (row === undefined) return null
            const record = recordByPath.get(row.path)
            const status = record === undefined ? null : (statuses.get(record.gitDir)?.status ?? null)
            const isCursor = item.index === cursorIndex
            return (
              <div
                key={row.path}
                role="treeitem"
                aria-level={row.depth + 1}
                aria-expanded={row.expandable ? row.expanded : undefined}
                className={`flex cursor-default items-center gap-1.5 pr-2 text-sm ${
                  isCursor && cursorVisible ? 'bg-accent/10' : 'hover:bg-ink/5'
                }`}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  height: ROW_HEIGHT,
                  transform: `translateY(${item.start}px)`,
                  paddingLeft: 6 + row.depth * 14
                }}
                onClick={() => {
                  setCursorPath(row.path)
                  if (!row.expandable) openFile(row.path, true)
                }}
                onDoubleClick={() => (row.expandable ? toggleExpand(row) : openFile(row.path, false))}
                onContextMenu={(event: MouseEvent<HTMLDivElement>) => {
                  event.preventDefault()
                  setCursorPath(row.path)
                  setMenu({ x: event.clientX, y: event.clientY, row })
                }}
              >
                <button
                  type="button"
                  tabIndex={-1}
                  aria-hidden={!row.expandable}
                  className={`shrink-0 rounded p-0.5 text-muted ${
                    row.expandable ? 'hover:bg-ink/10 hover:text-ink' : 'invisible'
                  }`}
                  onClick={(event) => {
                    event.stopPropagation()
                    toggleExpand(row)
                  }}
                >
                  <ChevronRightIcon className={`size-3.5 ${row.expanded ? 'rotate-90' : ''}`} />
                </button>
                <RowIcon row={row} />
                <span
                  className={`max-w-[50%] min-w-0 shrink-0 truncate text-ink ${
                    record !== undefined ? 'font-medium' : ''
                  }`}
                >
                  {row.name}
                </span>
                {record !== undefined && (
                  <>
                    <span className="min-w-0 truncate font-mono text-xs text-muted">
                      {branchLabel(record, status)}
                    </span>
                    <span className="min-w-0 flex-1" />
                    <RepoBadges record={record} status={status} options={tree.viewOptions} />
                  </>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {menu !== null && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.row)} onClose={() => setMenu(null)} />
      )}

      {newEntry !== null && (
        <PromptDialog
          title={newEntry.kind === 'file' ? t('menu.newFile') : t('menu.newFolder')}
          label={t('dialogs.nameLabel')}
          submitLabel={t('dialogs.create')}
          validate={(value) => validateName(value, t)}
          onSubmit={(name) => void createEntry(newEntry.dir, newEntry.kind, name.trim())}
          onClose={() => setNewEntry(null)}
        />
      )}

      {renaming !== null && (
        <PromptDialog
          title={t('menu.rename')}
          label={t('dialogs.nameLabel')}
          initialValue={renaming.name}
          submitLabel={t('dialogs.rename')}
          validate={(value) => validateName(value, t)}
          onSubmit={(name) => void renameEntry(renaming, name.trim())}
          onClose={() => setRenaming(null)}
        />
      )}

      {trashing !== null && (
        <ConfirmDialog
          title={t('dialogs.trashTitle')}
          body={t('dialogs.trashBody', { name: trashing.name })}
          confirmLabel={t('menu.delete')}
          danger
          onConfirm={() => void trashEntry(trashing)}
          onClose={() => setTrashing(null)}
        />
      )}
    </div>
  )
}

function ExplorerToolbar({
  onNewFile,
  onNewFolder
}: {
  onNewFile: () => void
  onNewFolder: () => void
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="flex h-8 shrink-0 items-center gap-1 border-b border-line px-2">
      <button
        type="button"
        title={t('menu.newFile')}
        className="rounded p-1 text-muted hover:bg-ink/5 hover:text-ink"
        onClick={onNewFile}
      >
        <FilePlusIcon className="size-4" />
      </button>
      <button
        type="button"
        title={t('menu.newFolder')}
        className="rounded p-1 text-muted hover:bg-ink/5 hover:text-ink"
        onClick={onNewFolder}
      >
        <FolderPlusIcon className="size-4" />
      </button>
    </div>
  )
}

function RowIcon({ row }: { row: ExplorerRow }): JSX.Element {
  if (row.kind === 'dir') {
    return row.expanded ? (
      <FolderOpenIcon className="size-4 shrink-0 text-muted" />
    ) : (
      <FolderIcon className="size-4 shrink-0 text-muted" />
    )
  }
  if (row.kind === 'symlink') return <LinkIcon className="size-4 shrink-0 text-muted" />
  return <FileIcon className="size-4 shrink-0 text-muted" />
}

function cursorRow(rows: readonly ExplorerRow[], cursor: string | null): ExplorerRow | null {
  if (cursor === null) return null
  return rows.find((row) => row.path === cursor) ?? null
}

/** Directory that new entries go into: the cursor's folder, or its parent for files. */
function targetDir(rows: readonly ExplorerRow[], cursor: string | null, root: string): string {
  const row = cursorRow(rows, cursor)
  if (row === null) return root
  return row.kind === 'dir' ? row.path : (parentOf(row.path) ?? root)
}

function validateName(value: string, t: (key: string) => string): string | null {
  const name = value.trim()
  if (name.length === 0) return t('explorer.errors.invalidName')
  if (name === '.' || name === '..' || /[/\\\u0000-\u001f]/.test(name)) return t('explorer.errors.invalidName')
  return null
}

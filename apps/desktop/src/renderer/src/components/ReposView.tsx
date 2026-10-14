import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { RepoRecord, RepoStatus } from '@gitreedesk/shared'
import { api } from '../api'
import { isEditableTarget } from '../commands/keybinding'
import { useOperations } from '../contexts/operations-context'
import { useReposUi } from '../contexts/repos'
import { useTreeUi } from '../contexts/tree'
import { useWorkspace } from '../contexts/workspace'
import { notifyError } from '../notify'
import { nextSelectable } from '../tree/nav'
import {
  buildReposTree,
  checkoutKey,
  hasActiveFilters,
  type RepoFilters,
  type RepoNode,
  type ReposRow
} from '../tree/repos-model'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'
import { branchLabel, RepoBadges } from './RepoBadges'
import { CheckSquareIcon, ChevronRightIcon, SquareIcon } from './icons'

const ROW_HEIGHT = 28
const NO_RECORDS: readonly RepoRecord[] = []

function isRepoRow(row: ReposRow): row is Extract<ReposRow, { type: 'repo' }> {
  return row.type === 'repo'
}

export function ReposView(): JSX.Element {
  const { t } = useTranslation()
  const { descriptor, statuses } = useWorkspace()
  const tree = useTreeUi()
  const repoUi = useReposUi()
  const operations = useOperations()
  const records = descriptor?.records ?? NO_RECORDS

  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [cursorKey, setCursorKey] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; node: RepoNode } | null>(null)

  const statusFor = useCallback(
    (record: RepoRecord): RepoStatus | null => statuses.get(record.gitDir)?.status ?? null,
    [statuses]
  )

  const expanded = useMemo<ReadonlySet<string> | null>(() => {
    if (collapsed.size === 0) return null
    return new Set(records.filter((record) => !collapsed.has(record.path)).map((record) => record.path))
  }, [records, collapsed])

  const rows = useMemo(
    () =>
      buildReposTree(records, {
        showExternal: tree.viewOptions.showExternalWorktrees,
        filters: tree.filters,
        groups: descriptor?.config.groups ?? null,
        statusFor,
        expanded
      }),
    [records, tree.viewOptions.showExternalWorktrees, tree.filters, descriptor, statusFor, expanded]
  )

  const cursorIndex = useMemo(() => {
    if (cursorKey === null) return -1
    return rows.findIndex((row) => isRepoRow(row) && row.node.key === cursorKey)
  }, [rows, cursorKey])

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12
  })

  // Drop selections pointing at repositories that no longer exist.
  useEffect(() => {
    const keys = new Set(records.map((record) => record.path))
    setSelected((current) => {
      const next = new Set([...current].filter((key) => keys.has(key)))
      return next.size === current.size ? current : next
    })
    setCursorKey((current) => (current !== null && !keys.has(current) ? null : current))
    setCollapsed((current) => {
      const next = new Set([...current].filter((key) => keys.has(key)))
      return next.size === current.size ? current : next
    })
  }, [records])

  // Quick-open navigation: reveal and select the requested repository.
  useEffect(() => {
    const focus = tree.pendingRepoFocus
    if (focus === null) return
    const index = rows.findIndex((row) => isRepoRow(row) && row.node.key === focus)
    if (index === -1) {
      if (collapsed.size > 0) {
        setCollapsed(new Set())
        return
      }
      const record = records.find((candidate) => candidate.path === focus)
      if (record !== undefined) {
        if (record.external && !tree.viewOptions.showExternalWorktrees) {
          tree.setViewOptions({ ...tree.viewOptions, showExternalWorktrees: true })
          return
        }
        if (hasActiveFilters(tree.filters)) {
          tree.setFilters({ dirty: false, aheadBehind: false, worktrees: false })
          return
        }
      }
      tree.consumeRepoFocus()
      return
    }
    setCursorKey(focus)
    setSelected(new Set([focus]))
    virtualizer.scrollToIndex(index, { align: 'center' })
    tree.consumeRepoFocus()
  }, [tree, rows, records, collapsed, virtualizer])

  const expandable = (node: RepoNode): boolean => node.hasChildren

  // Commands consult the selection through this ref while the view is mounted.
  useEffect(() => {
    tree.reposActions.current = {
      selectedRecords: () => {
        const picked: RepoRecord[] = []
        for (const row of rows) {
          if (isRepoRow(row) && selected.has(row.node.key)) picked.push(row.node.record)
        }
        return picked
      }
    }
    return () => {
      tree.reposActions.current = null
    }
  }, [tree, rows, selected])

  const toggleCollapsed = (node: RepoNode): void => {
    if (!expandable(node)) return
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(node.record.path)) next.delete(node.record.path)
      else next.add(node.record.path)
      return next
    })
  }

  const scrollToIndex = (index: number): void => {
    virtualizer.scrollToIndex(index, { align: 'auto' })
  }

  const moveCursor = (direction: 1 | -1): void => {
    const next = nextSelectable(rows, cursorIndex, direction, isRepoRow)
    const row = rows[next]
    if (row === undefined || !isRepoRow(row)) return
    setCursorKey(row.node.key)
    setSelected(new Set([row.node.key]))
    scrollToIndex(next)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (isEditableTarget(event.target as { tagName?: string; isContentEditable?: boolean })) return
    const row = cursorIndex >= 0 ? rows[cursorIndex] : undefined
    const node = row !== undefined && isRepoRow(row) ? row.node : null

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        moveCursor(1)
        break
      case 'ArrowUp':
        event.preventDefault()
        moveCursor(-1)
        break
      case 'ArrowRight':
        event.preventDefault()
        if (node !== null && expandable(node) && collapsed.has(node.record.path)) {
          setCollapsed((current) => {
            const next = new Set(current)
            next.delete(node.record.path)
            return next
          })
        }
        break
      case 'ArrowLeft':
        event.preventDefault()
        if (node !== null && expandable(node) && !collapsed.has(node.record.path)) {
          setCollapsed((current) => new Set(current).add(node.record.path))
        }
        break
      case 'Enter':
        event.preventDefault()
        if (node !== null && expandable(node)) toggleCollapsed(node)
        break
      case ' ': {
        if (node === null) return
        event.preventDefault()
        tree.setScmSelected(checkoutKey(node.record), !tree.isScmSelected(checkoutKey(node.record)))
        break
      }
      default:
        break
    }
  }

  const onRowMouseDown = (event: MouseEvent<HTMLDivElement>, node: RepoNode): void => {
    const key = node.key
    if (node.record.gitDir.length > 0) repoUi.setActiveKey(node.record.gitDir)
    if (event.ctrlKey || event.metaKey) {
      setSelected((current) => {
        const next = new Set(current)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
      })
      setCursorKey(key)
      return
    }
    if (event.shiftKey && cursorKey !== null && cursorKey !== key) {
      const from = rows.findIndex((candidate) => isRepoRow(candidate) && candidate.node.key === cursorKey)
      const to = rows.findIndex((candidate) => isRepoRow(candidate) && candidate.node.key === key)
      if (from >= 0 && to >= 0) {
        const [start, end] = from <= to ? [from, to] : [to, from]
        const keys = rows
          .slice(start, end + 1)
          .filter(isRepoRow)
          .map((candidate) => candidate.node.key)
        setSelected(new Set(keys))
        return
      }
    }
    setCursorKey(key)
    setSelected(new Set([key]))
  }

  const copyPath = useCallback((text: string): void => {
    void api.invoke('app:copyText', { text }).catch((error: unknown) => {
      notifyError(error instanceof Error ? error.message : String(error))
    })
  }, [])

  const reveal = useCallback((path: string): void => {
    void api.invoke('fs:reveal', { path }).catch((error: unknown) => {
      notifyError(error instanceof Error ? error.message : String(error))
    })
  }, [])

  const openInEditor = useCallback((path: string): void => {
    void api.invoke('editor:openInCode', { path }).catch((error: unknown) => {
      notifyError(error instanceof Error ? error.message : String(error))
    })
  }, [])

  const menuItems = (node: RepoNode): ContextMenuItem[] => {
    const record = node.record
    // Row keys are checkout paths, so the selection is directly copyable.
    const inSelection = selected.has(node.key) && selected.size > 0
    const paths = inSelection ? [...selected] : [node.key]
    const picked = inSelection
      ? rows.filter(isRepoRow).filter((row) => selected.has(row.node.key)).map((row) => row.node.record)
      : [record]
    const syncTargets = picked.filter((candidate) => candidate.gitDir.length > 0)
    const pullable = syncTargets.filter((candidate) => candidate.kind !== 'bare')
    const status = statusFor(record)
    const branch = status?.head.ref ?? null
    const pushable = record.kind !== 'bare' && branch !== null
    const canTarget = record.gitDir.length > 0
    return [
      {
        label: t('menu.checkoutBranch'),
        disabled: !canTarget || record.kind === 'bare',
        onSelect: () => {
          repoUi.setActiveKey(record.gitDir)
          operations.openBranches(record)
        }
      },
      {
        label: t('menu.createBranch'),
        disabled: !canTarget || record.kind === 'bare',
        onSelect: () => {
          repoUi.setActiveKey(record.gitDir)
          operations.openCreateBranch(record)
        }
      },
      {
        label: syncTargets.length > 1 ? t('menu.fetchSelected') : t('menu.fetch'),
        disabled: syncTargets.length === 0,
        onSelect: () => operations.fetchRepos(syncTargets)
      },
      {
        label: syncTargets.length > 1 ? t('menu.pullSelected') : t('menu.pull'),
        disabled: pullable.length === 0,
        onSelect: () => operations.pullRepos(pullable)
      },
      {
        label: t('menu.push'),
        disabled: !pushable,
        onSelect: () => {
          if (branch === null) return
          operations.pushBranch(record, branch, { hasUpstream: status !== null && status.upstream !== null })
        }
      },
      {
        label: t('menu.remotes'),
        disabled: !canTarget,
        onSelect: () => {
          repoUi.setActiveKey(record.gitDir)
          operations.openRemotes(record)
        }
      },
      {
        label: t('menu.tags'),
        disabled: !canTarget,
        onSelect: () => {
          repoUi.setActiveKey(record.gitDir)
          operations.openTags(record)
        }
      },
      {
        label: t('menu.stashCreate'),
        disabled: !canTarget || record.kind === 'bare',
        onSelect: () => {
          repoUi.setActiveKey(record.gitDir)
          operations.openStashCreate(record)
        }
      },
      {
        label: t('menu.stashes'),
        disabled: !canTarget || record.kind === 'bare',
        onSelect: () => {
          repoUi.setActiveKey(record.gitDir)
          operations.openStashes(record)
        }
      },
      {
        label: t('menu.restoreBackup'),
        disabled: !canTarget,
        onSelect: () => {
          repoUi.setActiveKey(record.gitDir)
          operations.openBackupRestore(record)
        }
      },
      {
        label: paths.length > 1 ? t('menu.copyPaths') : t('menu.copyPath'),
        onSelect: () => copyPath(paths.join('\n'))
      },
      { label: t('menu.reveal'), onSelect: () => reveal(node.record.path) },
      { label: t('menu.openInEditor'), onSelect: () => openInEditor(node.record.path) }
    ]
  }

  const toggleScm = (record: RepoRecord): void => {
    const key = checkoutKey(record)
    tree.setScmSelected(key, !tree.isScmSelected(key))
  }

  if (records.length === 0) {
    return (
      <div className="px-3 py-4">
        <p className="text-sm text-ink">{t('repos.empty')}</p>
        <p className="mt-1 text-xs text-muted">{t('repos.emptyHint')}</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ReposToolbar />
      <div
        ref={scrollRef}
        tabIndex={0}
        role="tree"
        aria-label={t('view.repos')}
        className="min-h-0 flex-1 overflow-auto outline-none"
        onKeyDown={onKeyDown}
        onMouseDown={(event) => {
          if (event.target === scrollRef.current) setSelected(new Set())
        }}
      >
        {rows.length === 0 && (
          <p className="px-3 py-4 text-sm text-muted">{t('repos.emptyFiltered')}</p>
        )}
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index]
            if (row === undefined) return null
            if (row.type === 'group') {
              return (
                <div
                  key={row.key}
                  className="flex items-center pr-2"
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    height: ROW_HEIGHT,
                    transform: `translateY(${item.start}px)`,
                    paddingLeft: 6
                  }}
                >
                  <span className="truncate text-xs font-semibold tracking-wide text-muted uppercase">
                    {row.label}
                  </span>
                </div>
              )
            }

            const node = row.node
            const record = node.record
            const status = statusFor(record)
            const isCursor = node.key === cursorKey
            const isSelected = selected.has(node.key)
            const label = branchLabel(record, status)

            return (
              <div
                key={row.key}
                role="treeitem"
                aria-level={node.depth + 1}
                aria-selected={isSelected}
                aria-expanded={node.hasChildren ? node.expanded : undefined}
                title={record.path}
                className={`flex cursor-default items-center gap-1.5 pr-2 text-sm ${
                  isCursor ? 'bg-accent/10' : isSelected ? 'bg-ink/5' : 'hover:bg-ink/5'
                } ${record.external ? 'opacity-60' : ''}`}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  height: ROW_HEIGHT,
                  transform: `translateY(${item.start}px)`,
                  paddingLeft: 6 + node.depth * 14
                }}
                onMouseDown={(event) => onRowMouseDown(event, node)}
                onContextMenu={(event) => {
                  event.preventDefault()
                  setCursorKey(node.key)
                  if (!selected.has(node.key)) setSelected(new Set([node.key]))
                  if (record.gitDir.length > 0) repoUi.setActiveKey(record.gitDir)
                  setMenu({ x: event.clientX, y: event.clientY, node })
                }}
              >
                <button
                  type="button"
                  tabIndex={-1}
                  aria-hidden={!node.hasChildren}
                  className={`shrink-0 rounded p-0.5 text-muted ${
                    node.hasChildren ? 'hover:bg-ink/10 hover:text-ink' : 'invisible'
                  }`}
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation()
                    toggleCollapsed(node)
                  }}
                >
                  <ChevronRightIcon className={`size-3.5 ${node.expanded ? 'rotate-90' : ''}`} />
                </button>
                <input
                  type="checkbox"
                  checked={tree.isScmSelected(checkoutKey(record))}
                  title={t('repos.includeInScm')}
                  aria-label={t('repos.includeInScm')}
                  className="shrink-0 accent-accent"
                  onMouseDown={(event) => event.stopPropagation()}
                  onChange={() => toggleScm(record)}
                />
                <span className="max-w-[50%] min-w-0 shrink-0 truncate font-medium text-ink">
                  {record.name}
                </span>
                {label !== '' && (
                  <span className="min-w-0 truncate font-mono text-xs text-muted">{label}</span>
                )}
                {record.kind === 'worktree' && (
                  <span className="min-w-0 shrink truncate text-xs text-muted">
                    @ {record.external ? record.path : record.relPath}
                  </span>
                )}
                <span className="min-w-0 flex-1" />
                <RepoBadges
                  record={record}
                  status={status}
                  options={tree.viewOptions}
                  main={node.isMain && node.hasWorktreeChildren}
                />
              </div>
            )
          })}
        </div>
      </div>

      {menu !== null && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.node)} onClose={() => setMenu(null)} />
      )}
    </div>
  )
}

function ReposToolbar(): JSX.Element {
  const { t } = useTranslation()
  const { descriptor } = useWorkspace()
  const tree = useTreeUi()
  const records = descriptor?.records ?? NO_RECORDS

  const chips: readonly { key: keyof RepoFilters; label: string }[] = [
    { key: 'dirty', label: t('filters.dirty') },
    { key: 'aheadBehind', label: t('filters.aheadBehind') },
    { key: 'worktrees', label: t('filters.worktrees') }
  ]

  return (
    <div className="flex min-h-8 shrink-0 flex-wrap items-center gap-1 border-b border-line px-2 py-1">
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          aria-pressed={tree.filters[chip.key]}
          className={`whitespace-nowrap rounded border px-1.5 py-0.5 text-xs ${
            tree.filters[chip.key]
              ? 'border-accent/60 bg-accent/15 text-ink'
              : 'border-line text-muted hover:bg-ink/5 hover:text-ink'
          }`}
          onClick={() => tree.setFilters({ ...tree.filters, [chip.key]: !tree.filters[chip.key] })}
        >
          {chip.label}
        </button>
      ))}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <button
          type="button"
          title={t('repos.selectAll')}
          className="rounded p-1 text-muted hover:bg-ink/5 hover:text-ink"
          onClick={() => tree.setScmDeselected([])}
        >
          <CheckSquareIcon className="size-4" />
        </button>
        <button
          type="button"
          title={t('repos.selectNone')}
          className="rounded p-1 text-muted hover:bg-ink/5 hover:text-ink"
          onClick={() => tree.setScmDeselected(records.map((record) => checkoutKey(record)))}
        >
          <SquareIcon className="size-4" />
        </button>
      </div>
    </div>
  )
}

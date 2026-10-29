import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
  type MouseEvent
} from 'react'
import { useTranslation } from 'react-i18next'
import type { ConflictSide, RepoRecord, RepoStatus } from '@gitreedesk/shared'
import { api } from '../api'
import { isEditableTarget } from '../commands/keybinding'
import { repoInfoOf, scmDiffSpec, useEditor } from '../contexts/editor'
import { useGraph } from '../contexts/graph'
import { useOperations } from '../contexts/operations-context'
import { useReposUi } from '../contexts/repos'
import { useSettings } from '../contexts/settings'
import { useTerminal } from '../contexts/terminal'
import { useTreeUi, type ScmActions } from '../contexts/tree'
import { useWorkspace } from '../contexts/workspace'
import { notify, notifyError } from '../notify'
import { notifyServiceError } from '../lib/reporting'
import { rowHeightFor } from '../theme'
import { checkoutKey } from '../tree/repos-model'
import {
  buildScmModel,
  DEFAULT_SCM_GROUPS,
  groupCollapseKey,
  repoCollapseKey,
  stagePathspecs,
  SCM_GROUPS,
  unstagePathspecs,
  UNTRACKED_PAGE,
  type ScmRepoSection,
  type ScmRow
} from '../tree/scm-model'
import { CommitBox } from './CommitBox'
import { ConfirmDialog } from './ConfirmDialog'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'
import { OperationBanner } from './OperationBanner'
import { branchLabel } from './RepoBadges'
import {
  ArchiveIcon,
  CheckSquareIcon,
  ChevronRightIcon,
  GraphIcon,
  IgnoreIcon,
  MinusIcon,
  PlusIcon,
  UndoIcon,
  XIcon
} from './icons'

const NO_RECORDS: readonly RepoRecord[] = []
const NO_ROWS: FlatItem[] = []

const LETTER_TONE: Record<string, string> = {
  M: 'text-warn',
  T: 'text-warn',
  A: 'text-success',
  U: 'text-success',
  D: 'text-danger',
  '!': 'text-danger',
  R: 'text-accent',
  C: 'text-accent'
}

interface FlatItem {
  id: string
  section: ScmRepoSection
  row: ScmRow
}

function itemId(section: ScmRepoSection, row: ScmRow): string {
  return `${section.key}\u0000${row.id}`
}

function absPath(record: RepoRecord, relPath: string): string {
  return `${record.path}/${relPath.replace(/\/$/, '')}`
}

/** Directory a row's terminal starts in: the folder itself for directory rows, else the file's parent. */
function dirOf(item: FlatItem): string {
  const record = item.section.record
  if (item.row.path.endsWith('/')) {
    return `${record.path}/${item.row.path.replace(/\/+$/, '')}`
  }
  const file = absPath(record, item.row.path)
  const slash = file.lastIndexOf('/')
  return slash <= 0 ? record.path : file.slice(0, slash)
}

interface RepoBatch {
  record: RepoRecord
  paths: Set<string>
}

function collectBatches(
  picked: readonly FlatItem[],
  pathsFor: (row: ScmRow) => readonly string[]
): RepoBatch[] {
  const batches = new Map<string, RepoBatch>()
  for (const item of picked) {
    const paths = pathsFor(item.row)
    if (paths.length === 0) continue
    let batch = batches.get(item.section.key)
    if (batch === undefined) {
      batch = { record: item.section.record, paths: new Set() }
      batches.set(item.section.key, batch)
    }
    for (const path of paths) batch.paths.add(path)
  }
  return [...batches.values()]
}

async function invokeBatches(
  batches: readonly RepoBatch[],
  channel: 'git:stage' | 'git:unstage' | 'git:discard'
): Promise<void> {
  for (const batch of batches) {
    try {
      await api.invoke(channel, { gitDir: batch.record.gitDir, paths: [...batch.paths] })
    } catch (error) {
      notifyError(error instanceof Error ? error.message : String(error))
    }
  }
}

export function ScmView(): JSX.Element {
  const { t } = useTranslation()
  const { descriptor, statuses } = useWorkspace()
  const tree = useTreeUi()
  const editor = useEditor()
  const repoUi = useReposUi()
  const operations = useOperations()
  const graph = useGraph()
  const terminal = useTerminal()
  const settings = useSettings()
  const rowHeight = rowHeightFor(settings.density)
  const records = descriptor?.records ?? NO_RECORDS
  const trusted = descriptor?.trusted ?? false

  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [cursorId, setCursorId] = useState<string | null>(null)
  const [untrackedLimits, setUntrackedLimits] = useState<ReadonlyMap<string, number>>(new Map())
  const [menu, setMenu] = useState<{ x: number; y: number; item: FlatItem } | null>(null)
  const [discardRows, setDiscardRows] = useState<FlatItem[] | null>(null)
  const anchorRef = useRef<string | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const rowRefs = useRef(new Map<string, HTMLDivElement>())

  const statusFor = useCallback(
    (record: RepoRecord): RepoStatus | null => statuses.get(record.gitDir)?.status ?? null,
    [statuses]
  )

  const sections = useMemo(
    () =>
      buildScmModel({
        records,
        statusFor,
        isSelected: tree.isScmSelected,
        onlySelected: tree.scmOnlySelected,
        groups: tree.scmGroups,
        untrackedLimitFor: (key) => untrackedLimits.get(key) ?? UNTRACKED_PAGE
      }),
    [records, statusFor, tree.isScmSelected, tree.scmOnlySelected, tree.scmGroups, untrackedLimits]
  )

  const hiddenGroups = useMemo(
    () => SCM_GROUPS.filter((group) => !tree.scmGroups[group]),
    [tree.scmGroups]
  )
  const checkedCount = useMemo(
    () => records.filter((record) => tree.isScmSelected(checkoutKey(record))).length,
    [records, tree.isScmSelected]
  )
  const scopeFiltered = tree.scmOnlySelected && checkedCount < records.length
  const filtersActive = hiddenGroups.length > 0 || scopeFiltered

  // Working-tree edits only reach the status pipeline through tree watches, so the
  // repos this view covers stay watched while it is mounted; released on unmount.
  const watchedRef = useRef(new Set<string>())
  useEffect(() => {
    const watched = watchedRef.current
    const desired = new Set<string>()
    for (const record of records) {
      if (record.gitDir === '') continue
      if (tree.scmOnlySelected && !tree.isScmSelected(checkoutKey(record))) continue
      desired.add(record.path)
    }
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
  }, [records, tree.isScmSelected, tree.scmOnlySelected])

  useEffect(() => {
    const watched = watchedRef.current
    return () => {
      for (const dir of watched) void api.invoke('fs:unwatch', { path: dir }).catch(() => undefined)
      watched.clear()
    }
  }, [])

  const items = useMemo(() => {
    const list: FlatItem[] = []
    const collapsed = new Set(tree.scmCollapsed)
    for (const section of sections) {
      if (collapsed.has(repoCollapseKey(section.key))) continue
      for (const block of section.groups) {
        if (collapsed.has(groupCollapseKey(section.key, block.group))) continue
        for (const row of block.rows) list.push({ id: itemId(section, row), section, row })
      }
    }
    return list
  }, [sections, tree.scmCollapsed])

  const itemIndex = useMemo(() => {
    const index = new Map<string, number>()
    items.forEach((item, position) => index.set(item.id, position))
    return index
  }, [items])

  // Selections die with the rows they point at: staging moves a row into another group.
  useEffect(() => {
    setSelected((current) => {
      if (current.size === 0) return current
      const alive = new Set(items.map((item) => item.id))
      const next = new Set([...current].filter((id) => alive.has(id)))
      return next.size === current.size ? current : next
    })
  }, [items])

  const selectedItems = useMemo(
    () => (selected.size === 0 ? NO_ROWS : items.filter((item) => selected.has(item.id))),
    [selected, items]
  )

  const toggleCollapsed = useCallback(
    (key: string): void => {
      const next = new Set(tree.scmCollapsed)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      tree.setScmCollapsed([...next])
    },
    [tree]
  )

  const runStage = useCallback((picked: readonly FlatItem[]): void => {
    void invokeBatches(
      collectBatches(picked, (row) => stagePathspecs([row])),
      'git:stage'
    )
  }, [])

  const runUnstage = useCallback((picked: readonly FlatItem[]): void => {
    void invokeBatches(
      collectBatches(picked, (row) => unstagePathspecs([row])),
      'git:unstage'
    )
  }, [])

  const runDiscard = useCallback((picked: readonly FlatItem[]): void => {
    void (async () => {
      const tracked = picked.filter((item) => item.row.group === 'unstaged')
      await invokeBatches(collectBatches(tracked, (row) => [row.path]), 'git:discard')
      for (const item of picked) {
        if (item.row.group !== 'untracked') continue
        try {
          await api.invoke('fs:trash', { path: absPath(item.section.record, item.row.path) })
        } catch (error) {
          notifyError(error instanceof Error ? error.message : String(error))
        }
      }
    })()
  }, [])

  const confirmDiscard = useCallback(
    (picked: readonly FlatItem[]): void => {
      const untrackedOnly = picked.every((item) => item.row.group === 'untracked')
      if (untrackedOnly) runDiscard(picked)
      else setDiscardRows([...picked])
    },
    [runDiscard]
  )

  const toggleStaged = useCallback(
    (picked: readonly FlatItem[]): void => {
      const staged = picked.filter((item) => item.row.group === 'staged')
      const rest = picked.filter((item) => item.row.group !== 'staged')
      void (async () => {
        await invokeBatches(
          collectBatches(staged, (row) => unstagePathspecs([row])),
          'git:unstage'
        )
        await invokeBatches(
          collectBatches(rest, (row) => stagePathspecs([row])),
          'git:stage'
        )
      })()
    },
    []
  )

  const ignoreRow = useCallback(
    (item: FlatItem): void => {
      if (item.row.group !== 'untracked') return
      void api
        .invoke('git:ignore', { gitDir: item.section.record.gitDir, path: item.row.path })
        .then(({ pattern }) => {
          notify({ message: t('scm.ignored', { pattern }) })
        })
        .catch((error: unknown) => {
          notifyError(error instanceof Error ? error.message : String(error))
        })
    },
    [t]
  )

  const resolveConflict = useCallback(
    (item: FlatItem, resolution: ConflictSide): void => {
      void api
        .invoke('git:conflictResolve', {
          gitDir: item.section.record.gitDir,
          path: item.row.path,
          resolution
        })
        .then(() => {
          notify({ message: t('conflict.resolved', { name: item.row.name }) })
        })
        .catch((error: unknown) => {
          notifyServiceError(error, t)
        })
    },
    [t]
  )

  const openConflictInEditor = useCallback(
    (item: FlatItem): void => {
      editor.openFile(absPath(item.section.record, item.row.path))
    },
    [editor]
  )

  const openMergeTool = useCallback(
    (item: FlatItem): void => {
      void api
        .invoke('git:openMergeTool', {
          gitDir: item.section.record.gitDir,
          path: absPath(item.section.record, item.row.path)
        })
        .catch((error: unknown) => {
          notifyServiceError(error, t)
        })
    },
    [t]
  )

  const actions = useMemo((): ScmActions => {
    const canStage = selectedItems.some((item) => item.row.group !== 'staged')
    const canUnstage = selectedItems.some((item) => item.row.group === 'staged')
    const canDiscard = selectedItems.some(
      (item) => item.row.group === 'unstaged' || item.row.group === 'untracked'
    )
    return {
      hasSelection: () => selected.size > 0,
      canStage: () => canStage,
      canUnstage: () => canUnstage,
      canDiscard: () => canDiscard,
      stageSelected: () => {
        runStage(selectedItems.filter((item) => item.row.group !== 'staged'))
      },
      unstageSelected: () => {
        runUnstage(selectedItems.filter((item) => item.row.group === 'staged'))
      },
      discardSelected: () => {
        confirmDiscard(
          selectedItems.filter(
            (item) => item.row.group === 'unstaged' || item.row.group === 'untracked'
          )
        )
      }
    }
  }, [selected.size, selectedItems, runStage, runUnstage, confirmDiscard])

  useEffect(() => {
    tree.scmActions.current = actions
    return () => {
      if (tree.scmActions.current === actions) tree.scmActions.current = null
    }
  }, [tree.scmActions, actions])

  // The activity bar's Focus Source Control gesture lands here.
  useEffect(() => {
    if (tree.scmFocusTicket === 0) return
    listRef.current?.focus()
  }, [tree.scmFocusTicket])

  const scrollToId = (id: string): void => {
    rowRefs.current.get(id)?.scrollIntoView({ block: 'nearest' })
  }

  const selectSingle = (id: string): void => {
    setCursorId(id)
    anchorRef.current = id
    setSelected(new Set([id]))
  }

  const openDiff = useCallback(
    (item: FlatItem, preview: boolean): void => {
      const spec = scmDiffSpec(item.row)
      if (spec === null) return
      editor.openDiff(repoInfoOf(item.section.record), spec, { preview })
    },
    [editor]
  )

  const onRowMouseDown = (event: MouseEvent<HTMLDivElement>, item: FlatItem): void => {
    if (event.button !== 0) return
    if (item.section.record.gitDir.length > 0) {
      repoUi.setActiveKey(item.section.record.gitDir)
    }
    if (event.ctrlKey || event.metaKey) {
      setSelected((current) => {
        const next = new Set(current)
        if (next.has(item.id)) next.delete(item.id)
        else next.add(item.id)
        return next
      })
      setCursorId(item.id)
      anchorRef.current = item.id
      return
    }
    if (event.shiftKey && anchorRef.current !== null) {
      const from = itemIndex.get(anchorRef.current)
      const to = itemIndex.get(item.id)
      if (from !== undefined && to !== undefined) {
        const [start, end] = from <= to ? [from, to] : [to, from]
        setSelected(new Set(items.slice(start, end + 1).map((entry) => entry.id)))
        setCursorId(item.id)
        return
      }
    }
    selectSingle(item.id)
    openDiff(item, true)
  }

  const moveCursor = (direction: 1 | -1): void => {
    if (items.length === 0) return
    const current = cursorId === null ? -1 : (itemIndex.get(cursorId) ?? -1)
    const next = current === -1 ? (direction === 1 ? 0 : items.length - 1) : current + direction
    const item = items[next]
    if (item === undefined) return
    selectSingle(item.id)
    scrollToId(item.id)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (isEditableTarget(event.target as { tagName?: string; isContentEditable?: boolean })) return
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        moveCursor(1)
        break
      case 'ArrowUp':
        event.preventDefault()
        moveCursor(-1)
        break
      case 'ArrowLeft': {
        const item = cursorId === null ? undefined : items[itemIndex.get(cursorId) ?? -1]
        if (item !== undefined) {
          event.preventDefault()
          const groupKey = groupCollapseKey(item.section.key, item.row.group)
          if (!tree.scmCollapsed.includes(groupKey)) toggleCollapsed(groupKey)
          else toggleCollapsed(repoCollapseKey(item.section.key))
        }
        break
      }
      case 'ArrowRight': {
        const item = cursorId === null ? undefined : items[itemIndex.get(cursorId) ?? -1]
        if (item !== undefined) {
          event.preventDefault()
          const groupKey = groupCollapseKey(item.section.key, item.row.group)
          if (tree.scmCollapsed.includes(groupKey)) toggleCollapsed(groupKey)
        }
        break
      }
      case ' ': {
        const picked = selectedItems.length > 0 ? selectedItems : cursorRow()
        if (picked.length === 0) return
        event.preventDefault()
        toggleStaged(picked)
        break
      }
      case 'Enter': {
        const item = cursorId === null ? undefined : items[itemIndex.get(cursorId) ?? -1]
        if (item === undefined) return
        event.preventDefault()
        openDiff(item, false)
        break
      }
      default:
        break
    }
  }

  const cursorRow = (): FlatItem[] => {
    if (cursorId === null) return NO_ROWS
    const item = items[itemIndex.get(cursorId) ?? -1]
    return item === undefined ? NO_ROWS : [item]
  }

  const copyPathOf = (target: FlatItem): void => {
    void api
      .invoke('app:copyText', { text: absPath(target.section.record, target.row.path) })
      .catch((error: unknown) => {
        notifyError(error instanceof Error ? error.message : String(error))
      })
  }

  const menuItems = (item: FlatItem): ContextMenuItem[] => {
    if (item.row.group === 'conflicts') {
      return [
        // Resolution.
        { label: t('conflict.ours'), onSelect: () => resolveConflict(item, 'ours') },
        { label: t('conflict.theirs'), onSelect: () => resolveConflict(item, 'theirs') },
        { label: t('conflict.both'), onSelect: () => resolveConflict(item, 'both') },
        { divider: true, label: t('conflict.openInEditor'), onSelect: () => openConflictInEditor(item) },
        { label: t('conflict.openTool'), onSelect: () => openMergeTool(item) },
        // Finish and file actions.
        { divider: true, label: t('scm.resolve'), onSelect: () => runStage([item]) },
        { divider: true, label: t('menu.openTerminal'), onSelect: () => terminal.open(dirOf(item)) },
        { label: t('menu.copyPath'), onSelect: () => copyPathOf(item) }
      ]
    }
    const picked = selected.has(item.id) ? selectedItems : [item]
    const canStage = picked.some((entry) => entry.row.group !== 'staged')
    const canUnstage = picked.some((entry) => entry.row.group === 'staged')
    const canDiscard = picked.some(
      (entry) => entry.row.group === 'unstaged' || entry.row.group === 'untracked'
    )
    const untracked = item.row.group === 'untracked'
    const menu: ContextMenuItem[] = []
    if (canStage) {
      menu.push({
        label: t('scm.stage'),
        onSelect: () => runStage(picked.filter((entry) => entry.row.group !== 'staged'))
      })
    }
    if (canUnstage) {
      menu.push({
        label: t('scm.unstage'),
        onSelect: () => runUnstage(picked.filter((entry) => entry.row.group === 'staged'))
      })
    }
    if (canDiscard) {
      menu.push({
        label: t('scm.discard'),
        onSelect: () =>
          confirmDiscard(
            picked.filter(
              (entry) => entry.row.group === 'unstaged' || entry.row.group === 'untracked'
            )
          )
      })
    }
    if (untracked) {
      menu.push({ label: t('scm.ignore'), onSelect: () => ignoreRow(item) })
    }
    const stashPaths = [
      ...new Set(
        picked
          .filter((entry) => entry.section.key === item.section.key && entry.row.group !== 'conflicts')
          .map((entry) => entry.row.path)
      )
    ]
    menu.push({
      label: t('stash.selectedMenu'),
      divider: true,
      onSelect: () => operations.openStashCreate(item.section.record, { paths: stashPaths })
    })
    menu.push({ divider: true, label: t('menu.openTerminal'), onSelect: () => terminal.open(dirOf(item)) })
    menu.push({ label: t('menu.copyPath'), onSelect: () => copyPathOf(item) })
    return menu
  }

  const collapsed = useMemo(() => new Set(tree.scmCollapsed), [tree.scmCollapsed])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {filtersActive && (
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-2 py-1">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
            {hiddenGroups.map((group) => (
              <button
                key={group}
                type="button"
                title={t('scm.showGroup', { group: t(`scm.groups.${group}`) })}
                className="inline-flex max-w-full items-center gap-1 rounded border border-line px-1.5 py-0.5 text-xs text-ink hover:bg-ink/5"
                onClick={() => tree.setScmGroups({ ...tree.scmGroups, [group]: true })}
              >
                <span className="truncate">
                  {t('scm.hiddenGroup', { group: t(`scm.groups.${group}`) })}
                </span>
                <XIcon className="size-3 shrink-0 text-muted" />
              </button>
            ))}
            {scopeFiltered && (
              <button
                type="button"
                title={t('scm.showAllRepos')}
                className="inline-flex max-w-full items-center gap-1 rounded border border-line px-1.5 py-0.5 text-xs text-ink hover:bg-ink/5"
                onClick={() => tree.setScmOnlySelected(false)}
              >
                <span className="truncate">
                  {t('scm.scopedRepos', { selected: checkedCount, total: records.length })}
                </span>
                <XIcon className="size-3 shrink-0 text-muted" />
              </button>
            )}
          </div>
          <button
            type="button"
            className="shrink-0 rounded px-1 py-0.5 text-xs text-muted hover:bg-ink/5 hover:text-ink"
            onClick={() => {
              tree.setScmGroups(DEFAULT_SCM_GROUPS)
              tree.setScmOnlySelected(false)
            }}
          >
            {t('scm.showAll')}
          </button>
        </div>
      )}
      <div
        ref={listRef}
        tabIndex={0}
        role="tree"
        aria-label={t('view.scm')}
        className="min-h-0 flex-1 overflow-auto outline-none"
        onKeyDown={onKeyDown}
        onMouseDown={(event) => {
          if (event.target === listRef.current) setSelected(new Set())
        }}
      >
        {sections.length === 0 && (
          <p className="px-3 py-4 text-sm text-muted">
            {filtersActive ? t('scm.emptyFiltered') : t('scm.empty')}
          </p>
        )}
        {sections.map((section) => {
          const repoCollapsed = collapsed.has(repoCollapseKey(section.key))
          const status = statusFor(section.record)
          const branch = branchLabel(section.record, status)
          const stageableRows =
            section.counts.unstaged + section.counts.untracked + section.counts.conflicts
          return (
            <div key={section.key}>
              <div className="group/repo sticky top-0 flex h-7 items-center gap-1 border-b border-line/60 bg-panel pr-1 pl-1">
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={section.record.name}
                  aria-expanded={!repoCollapsed}
                  className="shrink-0 rounded p-0.5 text-muted hover:bg-ink/10 hover:text-ink"
                  onClick={() => toggleCollapsed(repoCollapseKey(section.key))}
                >
                  <ChevronRightIcon className={`size-3.5 ${repoCollapsed ? '' : 'rotate-90'}`} />
                </button>
                <span className="min-w-0 shrink-0 truncate text-xs font-semibold tracking-wide text-ink uppercase">
                  {section.record.name}
                </span>
                {branch !== '' && (
                  <button
                    type="button"
                    tabIndex={-1}
                    title={t('scm.branchPicker')}
                    className={`min-w-0 truncate rounded px-1 font-mono text-xs hover:bg-ink/10 hover:text-ink ${
                      status?.head.detached === true ? 'text-warn' : 'text-muted'
                    }`}
                    onClick={() => {
                      if (section.record.gitDir.length > 0) repoUi.setActiveKey(section.record.gitDir)
                      operations.openBranches(section.record)
                    }}
                  >
                    {branch}
                  </button>
                )}
                <span className="min-w-0 flex-1" />
                {stageableRows > 0 && (
                  <button
                    type="button"
                    tabIndex={-1}
                    title={t('scm.stageAll')}
                    aria-label={t('scm.stageAll')}
                    className="hidden shrink-0 rounded p-0.5 text-muted hover:bg-ink/10 hover:text-ink group-hover/repo:block"
                    onClick={() => {
                      void api
                        .invoke('git:stageAll', { gitDir: section.record.gitDir })
                        .catch((error: unknown) => {
                          notifyError(error instanceof Error ? error.message : String(error))
                        })
                    }}
                  >
                    <PlusIcon className="size-3.5" />
                  </button>
                )}
                {section.counts.staged > 0 && (
                  <button
                    type="button"
                    tabIndex={-1}
                    title={t('scm.unstageAll')}
                    aria-label={t('scm.unstageAll')}
                    className="hidden shrink-0 rounded p-0.5 text-muted hover:bg-ink/10 hover:text-ink group-hover/repo:block"
                    onClick={() => {
                      void api
                        .invoke('git:unstageAll', { gitDir: section.record.gitDir })
                        .catch((error: unknown) => {
                          notifyError(error instanceof Error ? error.message : String(error))
                        })
                    }}
                  >
                    <MinusIcon className="size-3.5" />
                  </button>
                )}
                {section.record.kind !== 'bare' && (
                  <button
                    type="button"
                    tabIndex={-1}
                    title={t('stash.listMenu')}
                    aria-label={t('stash.listMenu')}
                    className="hidden shrink-0 rounded p-0.5 text-muted hover:bg-ink/10 hover:text-ink group-hover/repo:block"
                    onClick={() => operations.openStashes(section.record)}
                  >
                    <ArchiveIcon className="size-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  tabIndex={-1}
                  title={t('menu.openGraph')}
                  aria-label={t('menu.openGraph')}
                  className="shrink-0 rounded p-0.5 text-muted hover:bg-ink/10 hover:text-ink"
                  onClick={() => {
                    if (section.record.gitDir.length > 0) {
                      repoUi.setActiveKey(section.record.gitDir)
                    }
                    graph.openGraph(section.record)
                  }}
                >
                  <GraphIcon className="size-3.5" />
                </button>
              </div>

              {status !== null && status.head.detached && (
                <div className="flex items-center gap-2 border-b border-line/60 bg-warn/10 px-3 py-1 text-xs text-warn">
                  <span className="min-w-0 flex-1 truncate">
                    {t('branches.detachedBanner', { sha: (status.head.sha ?? '').slice(0, 7) })}
                  </span>
                  <button
                    type="button"
                    className="shrink-0 rounded border border-warn/40 px-1.5 py-0.5 hover:bg-warn/15"
                    onClick={() =>
                      operations.openCreateBranch(section.record, {
                        startPoint: status.head.sha ?? 'HEAD'
                      })
                    }
                  >
                    {t('branches.createHere')}
                  </button>
                </div>
              )}

              {section.operation !== 'none' && (
                <OperationBanner
                  record={section.record}
                  operation={section.operation}
                  conflicts={section.counts.conflicts}
                />
              )}

              {!repoCollapsed &&
                section.groups.map((block) => {
                  const groupKey = groupCollapseKey(section.key, block.group)
                  const groupCollapsed = collapsed.has(groupKey)
                  return (
                    <div key={block.group}>
                      <button
                        type="button"
                        tabIndex={-1}
                        aria-expanded={!groupCollapsed}
                        className="flex h-6 w-full items-center gap-1 px-1 text-xs text-muted hover:text-ink"
                        onClick={() => toggleCollapsed(groupKey)}
                      >
                        <ChevronRightIcon
                          className={`size-3 shrink-0 ${groupCollapsed ? '' : 'rotate-90'}`}
                        />
                        <span className="truncate">{t(`scm.groups.${block.group}`)}</span>
                        <span className="shrink-0">{block.rows.length + block.hidden}</span>
                      </button>
                      {!groupCollapsed && block.rows.map((row) => renderRow(section, row))}
                      {!groupCollapsed && block.hidden > 0 && (
                        <button
                          type="button"
                          tabIndex={-1}
                          className="block w-full px-6 py-1 text-left text-xs text-accent hover:underline"
                          onClick={() =>
                            setUntrackedLimits((current) => {
                              const next = new Map(current)
                              next.set(
                                section.key,
                                (next.get(section.key) ?? UNTRACKED_PAGE) + UNTRACKED_PAGE
                              )
                              return next
                            })
                          }
                        >
                          {t('scm.showMore', { count: block.hidden })}
                        </button>
                      )}
                    </div>
                  )
                })}

              {!repoCollapsed && (
                <CommitBox record={section.record} status={status} trusted={trusted} />
              )}
            </div>
          )
        })}
      </div>

      {menu !== null && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems(menu.item)}
          onClose={() => setMenu(null)}
        />
      )}

      {discardRows !== null && (
        <ConfirmDialog
          title={t('scm.discardTitle')}
          body={
            discardRows.length === 1
              ? t('scm.discardBodyOne', { name: discardRows[0]?.row.name ?? '' })
              : t('scm.discardBodyMany', { count: discardRows.length })
          }
          confirmLabel={t('scm.discard')}
          danger
          onConfirm={() => {
            const picked = discardRows
            setDiscardRows(null)
            runDiscard(picked)
          }}
          onClose={() => setDiscardRows(null)}
        />
      )}
    </div>
  )

  function renderRow(section: ScmRepoSection, row: ScmRow): JSX.Element {
    const id = itemId(section, row)
    const isCursor = id === cursorId
    const isSelected = selected.has(id)
    const tone = LETTER_TONE[row.letter] ?? 'text-muted'
    const item: FlatItem = { id, section, row }
    return (
      <div
        key={id}
        ref={(element) => {
          if (element === null) rowRefs.current.delete(id)
          else rowRefs.current.set(id, element)
        }}
        role="treeitem"
        aria-selected={isSelected}
        title={`${row.dir}${row.dir === '' ? '' : '/'}${row.name}`}
        className={`group/row flex cursor-default items-center gap-1.5 pr-1 pl-5 text-sm select-none ${
          isCursor ? 'bg-accent/10' : isSelected ? 'bg-ink/5' : 'hover:bg-ink/5'
        }`}
        style={{ height: rowHeight }}
        onMouseDown={(event) => onRowMouseDown(event, item)}
        onDoubleClick={() => openDiff(item, false)}
        onContextMenu={(event) => {
          event.preventDefault()
          if (!selected.has(id)) selectSingle(id)
          setMenu({ x: event.clientX, y: event.clientY, item })
        }}
      >
        <span className={`w-3 shrink-0 text-center font-mono text-xs ${tone}`}>{row.letter}</span>
        <span className="max-w-[45%] min-w-0 shrink-0 truncate text-ink">{row.name}</span>
        {row.dir !== '' && (
          <span className="min-w-0 truncate font-mono text-xs text-muted">{row.dir}</span>
        )}
        <span className="min-w-0 flex-1" />
        <span className="hidden shrink-0 items-center gap-0.5 group-hover/row:flex group-focus-within/row:flex">
          {row.group === 'conflicts' && (
            <>
              <ConflictChip
                label={t('conflict.ours')}
                title={t('conflict.oursHint')}
                onClick={() => resolveConflict(item, 'ours')}
              />
              <ConflictChip
                label={t('conflict.theirs')}
                title={t('conflict.theirsHint')}
                onClick={() => resolveConflict(item, 'theirs')}
              />
              <ConflictChip
                label={t('conflict.both')}
                title={t('conflict.bothHint')}
                onClick={() => resolveConflict(item, 'both')}
              />
              <RowButton
                label={t('scm.resolve')}
                onClick={() => runStage([item])}
                icon={<CheckSquareIcon className="size-3.5" />}
              />
            </>
          )}
          {row.group === 'staged' && (
            <RowButton
              label={t('scm.unstage')}
              onClick={() => runUnstage([item])}
              icon={<MinusIcon className="size-3.5" />}
            />
          )}
          {row.group !== 'staged' && row.group !== 'conflicts' && (
            <RowButton
              label={t('scm.stage')}
              onClick={() => runStage([item])}
              icon={<PlusIcon className="size-3.5" />}
            />
          )}
          {(row.group === 'unstaged' || row.group === 'untracked') && (
            <RowButton
              label={t('scm.discard')}
              onClick={() => confirmDiscard([item])}
              icon={<UndoIcon className="size-3.5" />}
            />
          )}
          {row.group === 'untracked' && (
            <RowButton
              label={t('scm.ignore')}
              onClick={() => ignoreRow(item)}
              icon={<IgnoreIcon className="size-3.5" />}
            />
          )}
        </span>
      </div>
    )
  }
}

function ConflictChip({
  label,
  title,
  onClick
}: {
  label: string
  title: string
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      tabIndex={-1}
      title={title}
      className="rounded border border-line px-1 py-px text-[10px] text-muted hover:bg-ink/10 hover:text-ink"
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
    >
      {label}
    </button>
  )
}

function RowButton({
  label,
  icon,
  onClick
}: {
  label: string
  icon: JSX.Element
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      tabIndex={-1}
      title={label}
      aria-label={label}
      className="rounded p-0.5 text-muted hover:bg-ink/10 hover:text-ink"
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
    >
      {icon}
    </button>
  )
}

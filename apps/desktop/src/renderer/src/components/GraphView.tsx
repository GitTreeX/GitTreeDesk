import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent
} from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useTranslation } from 'react-i18next'
import type { ChangeKind, CommitDetails, CommitFileStat, FileChange, GitRef } from '@gitreedesk/shared'
import { api } from '../api'
import { repoInfoOf, useEditor, type GraphTab } from '../contexts/editor'
import { EMPTY_GRAPH_FILTERS, useGraph, type GraphFilters } from '../contexts/graph'
import { useOperations, type CommitTarget } from '../contexts/operations-context'
import { useSettings } from '../contexts/settings'
import { useWorkspace } from '../contexts/workspace'
import { notify } from '../notify'
import { errorText, notifyServiceError, stashNotice } from '../lib/reporting'
import { relativeTime } from '../lib/relative-time'
import { layoutCommits, prioritizedRefName, refsBySha, type GraphRow } from '../tree/graph-model'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'
import { OperationBanner } from './OperationBanner'
import { XIcon } from './icons'

const ROW_HEIGHT = 36
const LANE_WIDTH = 14
const CHIP_LIMIT = 3
const CHANGE_LETTER: Record<ChangeKind, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  typeChanged: 'T'
}

/** Lane colors from a fixed palette; a lane keeps its color across rows. */
const LANE_COLORS = [
  '#4f8feb',
  '#e0953d',
  '#43a56c',
  '#b06fd6',
  '#d9628b',
  '#3fb0c9',
  '#c2543f',
  '#8a8f98'
]

function laneColor(lane: number): string {
  return LANE_COLORS[lane % LANE_COLORS.length] as string
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

function sameRevs(a: string[] | null, b: string[] | null): boolean {
  if (a === null || b === null) return a === b
  return a.length === b.length && a.every((entry, index) => entry === b[index])
}

function filtersEqual(a: GraphFilters, b: GraphFilters): boolean {
  return (
    a.author === b.author &&
    a.path === b.path &&
    a.since === b.since &&
    a.until === b.until &&
    a.grep === b.grep &&
    a.currentBranch === b.currentBranch &&
    sameRevs(a.revs, b.revs)
  )
}

function chipClass(ref: GitRef): string {
  const base = 'inline-block max-w-36 shrink-0 truncate rounded border px-1 text-[10px] leading-4'
  if (ref.isHead) return `${base} border-accent bg-accent font-semibold text-white`
  if (ref.kind === 'branch') return `${base} border-accent/40 bg-accent/10 text-accent`
  if (ref.kind === 'tag') return `${base} border-warn/40 bg-warn/10 text-warn`
  return `${base} border-line bg-ink/5 text-muted`
}

interface CompareState {
  from: string
  to: string
  files: readonly FileChange[]
}

export function GraphView({ tab }: { tab: GraphTab }): JSX.Element | null {
  const { t } = useTranslation()
  const { locale } = useSettings()
  const graph = useGraph()
  const editor = useEditor()
  const operations = useOperations()
  const workspace = useWorkspace()
  const gitDir = tab.repo.gitDir
  const record = useMemo(
    () => workspace.descriptor?.records.find((candidate) => candidate.gitDir === gitDir) ?? null,
    [workspace.descriptor, gitDir]
  )
  const slice = graph.slices.get(gitDir)
  const commits = slice?.commits ?? []
  const filters = slice?.filters ?? EMPTY_GRAPH_FILTERS

  const rootRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const refsBoxRef = useRef<HTMLDivElement | null>(null)

  // The draft mirrors the stored filters while the user types; text fields
  // commit on a short debounce, everything else commits immediately.
  const [draft, setDraft] = useState<GraphFilters>(filters)
  const draftRef = useRef(draft)
  draftRef.current = draft
  const committedRef = useRef<GraphFilters>(filters)

  useEffect(() => {
    if (filtersEqual(filters, committedRef.current)) return
    if (!filtersEqual(draftRef.current, committedRef.current)) return
    committedRef.current = filters
    setDraft(filters)
  }, [filters])

  useEffect(() => {
    if (filtersEqual(draft, committedRef.current)) return
    const timer = setTimeout(() => {
      committedRef.current = draft
      graph.setFilters(gitDir, {
        author: draft.author,
        path: draft.path,
        since: draft.since,
        until: draft.until,
        grep: draft.grep
      })
    }, 300)
    return () => clearTimeout(timer)
  }, [draft, gitDir, graph])

  const applyNow = useCallback(
    (update: Partial<GraphFilters>): void => {
      const next = { ...draftRef.current, ...update }
      committedRef.current = next
      setDraft(next)
      graph.setFilters(gitDir, update)
    },
    [graph, gitDir]
  )

  const [refsOpen, setRefsOpen] = useState(false)
  useEffect(() => {
    if (!refsOpen) return
    const onDown = (event: MouseEvent): void => {
      if (refsBoxRef.current !== null && !refsBoxRef.current.contains(event.target as Node)) {
        setRefsOpen(false)
      }
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [refsOpen])

  const [cursor, setCursor] = useState<string | null>(null)
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set())
  const [detailSha, setDetailSha] = useState<string | null>(null)
  const [detailAttempt, setDetailAttempt] = useState(0)
  const [compareBase, setCompareBase] = useState<string | null>(null)
  const [compare, setCompare] = useState<CompareState | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  const layout = useMemo(() => layoutCommits(commits), [commits])
  const bySha = useMemo(() => new Map(commits.map((commit) => [commit.sha, commit])), [commits])
  const refs = useMemo(() => refsBySha(slice?.refs ?? []), [slice?.refs])

  const headStatus = workspace.statuses.get(gitDir)?.status.head
  const detached = headStatus?.detached === true
  const operation = workspace.statuses.get(gitDir)?.status.operation ?? 'none'
  const conflicts = workspace.statuses.get(gitDir)?.status.conflicted.length ?? 0

  const virtualizer = useVirtualizer({
    count: commits.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12
  })

  const onScroll = useCallback((): void => {
    const element = scrollRef.current
    if (element === null) return
    if (element.scrollHeight - element.scrollTop - element.clientHeight < ROW_HEIGHT * 20) {
      graph.loadMore(gitDir)
    }
  }, [graph, gitDir])

  // Commit details load on demand for the open row.
  const [details, setDetails] = useState<CommitDetails | null>(null)
  const [detailsError, setDetailsError] = useState<string | null>(null)
  const [detailsLoading, setDetailsLoading] = useState(false)
  useEffect(() => {
    if (detailSha === null) {
      setDetails(null)
      setDetailsError(null)
      setDetailsLoading(false)
      return
    }
    let live = true
    setDetails(null)
    setDetailsError(null)
    setDetailsLoading(true)
    void (async () => {
      try {
        const { commit } = await api.invoke('git:commitDetails', { gitDir, sha: detailSha })
        if (!live) return
        setDetails(commit)
        setDetailsLoading(false)
      } catch (failure) {
        if (!live) return
        setDetailsError(errorText(failure, t))
        setDetailsLoading(false)
      }
    })()
    return () => {
      live = false
    }
  }, [gitDir, detailSha, detailAttempt, t])

  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }),
    [locale]
  )

  const copyText = useCallback(
    (text: string): void => {
      void api.invoke('app:copyText', { text }).catch((failure: unknown) => {
        notifyServiceError(failure, t)
      })
    },
    [t]
  )

  const checkoutCommit = useCallback(
    (sha: string): void => {
      void (async () => {
        try {
          const { stash } = await api.invoke('git:checkoutDetach', { gitDir, rev: sha })
          notify({ message: t('graph.checkout.done', { sha: sha.slice(0, 7) }) })
          const notice = stashNotice(stash, t)
          if (notice !== null) notify({ message: notice, tone: stash.stashConflict ? 'error' : 'info' })
        } catch (failure) {
          notifyServiceError(failure, t)
        }
      })()
    },
    [gitDir, t]
  )

  const openCompareFile = useCallback(
    (from: string, to: string, file: FileChange): void => {
      if (record === null) return
      editor.openDiff(repoInfoOf(record), {
        path: file.path,
        origPath: file.origPath,
        from: { kind: 'rev', rev: from },
        to: { kind: 'rev', rev: to }
      })
    },
    [editor, record]
  )

  const runCompare = useCallback(
    (from: string, to: string): void => {
      void (async () => {
        try {
          const { files } = await api.invoke('git:diffFiles', { gitDir, from, to })
          const first = files[0]
          if (files.length === 0) {
            notify({ message: t('graph.compare.noDiff') })
          } else if (files.length === 1 && first !== undefined) {
            openCompareFile(from, to, first)
          } else {
            setCompare({ from, to, files })
          }
        } catch (failure) {
          notifyServiceError(failure, t)
        }
      })()
    },
    [gitDir, openCompareFile, t]
  )

  const openFileDiff = useCallback(
    (file: CommitFileStat): void => {
      if (record === null || details === null) return
      editor.openCommitDiff({
        repo: repoInfoOf(record),
        sha: details.sha,
        parent: details.parents[0] ?? null,
        path: file.path,
        ...(file.origPath !== undefined ? { origPath: file.origPath } : {}),
        subject: details.message.split('\n')[0] ?? ''
      })
    },
    [details, editor, record]
  )

  const moveCursor = useCallback(
    (delta: number): void => {
      if (commits.length === 0) return
      const index = cursor === null ? -1 : commits.findIndex((commit) => commit.sha === cursor)
      const base = index === -1 ? (delta > 0 ? -1 : commits.length) : index
      const nextIndex = Math.max(0, Math.min(commits.length - 1, base + delta))
      const next = commits[nextIndex]
      if (next === undefined) return
      setCursor(next.sha)
      virtualizer.scrollToIndex(nextIndex, { align: 'auto' })
    },
    [commits, cursor, virtualizer]
  )

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        searchRef.current?.focus()
        return
      }
      if (isEditableTarget(event.target)) return
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        moveCursor(1)
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        moveCursor(-1)
      } else if (event.key === 'Enter') {
        if (cursor !== null) setDetailSha(cursor)
      } else if (event.key === 'Escape') {
        if (menu !== null) setMenu(null)
        else if (detailSha !== null) setDetailSha(null)
      }
    },
    [cursor, detailSha, menu, moveCursor]
  )

  const clickRow = useCallback((event: ReactMouseEvent, sha: string): void => {
    rootRef.current?.focus()
    if (event.ctrlKey || event.metaKey) {
      setCursor(sha)
      setSelection((current) => {
        const next = new Set(current)
        if (next.has(sha)) next.delete(sha)
        else next.add(sha)
        return next
      })
      return
    }
    setCursor(sha)
    setSelection(new Set([sha]))
    setDetailSha(sha)
  }, [])

  const openRowMenu = useCallback((event: ReactMouseEvent, sha: string): void => {
    event.preventDefault()
    rootRef.current?.focus()
    setCursor(sha)
    setSelection((current) => (current.has(sha) ? current : new Set([sha])))
    setMenu({ x: event.clientX, y: event.clientY })
  }, [])

  const openDetailsMenu = useCallback(
    (event: ReactMouseEvent): void => {
      if (detailSha === null) return
      if (!selection.has(detailSha)) {
        setCursor(detailSha)
        setSelection(new Set([detailSha]))
      }
      setMenu({ x: event.clientX, y: event.clientY })
    },
    [detailSha, selection]
  )

  const toggleRev = useCallback(
    (name: string): void => {
      const current = draftRef.current.revs ?? []
      const next = current.includes(name)
        ? current.filter((entry) => entry !== name)
        : [...current, name]
      applyNow({ revs: next.length > 0 ? next : null })
    },
    [applyNow]
  )

  const selectedTargets = useMemo<CommitTarget[]>(() => {
    const ordered: CommitTarget[] = []
    for (const commit of commits) {
      if (selection.has(commit.sha)) {
        ordered.push({ sha: commit.sha, subject: commit.subject, parents: commit.parents })
      }
    }
    return ordered
  }, [commits, selection])

  const isPushed = useCallback(
    (sha: string): boolean => slice !== undefined && slice.upstream !== null && !slice.outgoing.includes(sha),
    [slice]
  )

  const menuItems = useMemo<ContextMenuItem[]>(() => {
    if (menu === null || record === null) return []
    const items: ContextMenuItem[] = []
    const single = selectedTargets.length === 1 ? selectedTargets[0] : undefined
    if (single !== undefined) {
      const refName = prioritizedRefName(refs.get(single.sha) ?? [])
      items.push({
        label: t('graph.menu.checkout'),
        onSelect: () => checkoutCommit(single.sha)
      })
      items.push({
        label: t('graph.menu.createBranch'),
        onSelect: () => operations.openCreateBranch(record, { startPoint: single.sha })
      })
      items.push({
        label: t('graph.menu.createTag'),
        onSelect: () => operations.openCreateTag(record, { target: single.sha })
      })
      items.push({
        divider: true,
        label: t('graph.menu.cherryPick'),
        onSelect: () => operations.openCherryPick(record, single)
      })
      items.push({
        label: t('graph.menu.revert'),
        onSelect: () => operations.openRevert(record, single)
      })
      if (!detached) {
        items.push({
          label: t('graph.menu.reset'),
          onSelect: () => operations.openReset(record, single)
        })
        items.push({
          label: t('graph.menu.rebaseOnto'),
          onSelect: () => operations.rebaseOnto(record, single.sha)
        })
        items.push({
          label: t('graph.menu.rebaseInteractive'),
          onSelect: () => operations.beginInteractiveRebase(record, single.sha)
        })
      }
      items.push({
        label: t('graph.menu.edit'),
        onSelect: () =>
          operations.openEditCommits(record, [single], { pushed: isPushed(single.sha) })
      })
      items.push({
        divider: true,
        label: t('graph.menu.copySha'),
        onSelect: () => copyText(single.sha)
      })
      items.push({
        label: t('graph.menu.copyRef'),
        disabled: refName === null,
        onSelect: () => {
          if (refName !== null) copyText(refName)
        }
      })
      items.push({
        divider: true,
        label: t('graph.menu.selectCompare'),
        disabled: compareBase === single.sha,
        onSelect: () => setCompareBase(single.sha)
      })
      if (compareBase !== null && compareBase !== single.sha) {
        const base = compareBase
        items.push({
          label: t('graph.menu.compareWith', { sha: base.slice(0, 7) }),
          onSelect: () => {
            setCompareBase(null)
            runCompare(base, single.sha)
          }
        })
      }
    } else if (selectedTargets.length > 1) {
      items.push({
        label: t('graph.menu.editMany', { count: selectedTargets.length }),
        onSelect: () =>
          operations.openEditCommits(record, selectedTargets, {
            pushed: selectedTargets.some((target) => isPushed(target.sha))
          })
      })
    }
    return items
  }, [
    checkoutCommit,
    compareBase,
    copyText,
    detached,
    isPushed,
    menu,
    operations,
    record,
    refs,
    runCompare,
    selectedTargets,
    t
  ])

  if (slice === undefined) return null

  const laneCount = Math.max(layout.laneCount, 1)
  const gutterWidth = laneCount * LANE_WIDTH
  const shownFilters =
    !filtersEqual(draft, EMPTY_GRAPH_FILTERS) || !filtersEqual(filters, EMPTY_GRAPH_FILTERS)
  const selectedRevs = new Set(draft.revs ?? [])
  const inputClass =
    'h-6 min-w-0 rounded border border-line bg-canvas px-2 text-xs text-ink outline-none focus:border-accent'

  return (
    <div
      ref={rootRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="flex min-h-0 flex-1 outline-none"
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line bg-panel px-2 py-1.5 text-xs">
          <input
            ref={searchRef}
            value={draft.grep}
            placeholder={t('graph.toolbar.search')}
            onChange={(event) => setDraft((current) => ({ ...current, grep: event.target.value }))}
            className={`${inputClass} w-44`}
          />
          <div ref={refsBoxRef} className="relative">
            <button
              type="button"
              className={`h-6 rounded border px-2 text-xs ${
                selectedRevs.size > 0
                  ? 'border-accent/50 bg-accent/10 text-accent'
                  : 'border-line bg-canvas text-muted hover:text-ink'
              }`}
              onClick={() => setRefsOpen((current) => !current)}
            >
              {selectedRevs.size === 0
                ? t('graph.toolbar.refsAll')
                : t('graph.toolbar.refsCount', { count: selectedRevs.size })}
            </button>
            {refsOpen && (
              <div className="absolute top-7 left-0 z-30 max-h-72 w-64 overflow-y-auto rounded-md border border-line bg-panel py-1 shadow-lg">
                {slice.refs.length === 0 && (
                  <p className="px-3 py-1 text-xs text-muted">{t('graph.toolbar.refsEmpty')}</p>
                )}
                {(['branch', 'remote', 'tag'] as const).map((kind) => {
                  const group = slice.refs.filter((ref) => ref.kind === kind)
                  if (group.length === 0) return null
                  return (
                    <div key={kind}>
                      <p className="px-3 pt-1 text-[10px] font-semibold tracking-wide text-muted uppercase">
                        {t(`graph.toolbar.kinds.${kind}`)}
                      </p>
                      {group.map((ref) => (
                        <label
                          key={ref.fullName}
                          className="flex cursor-pointer items-center gap-2 px-3 py-0.5 hover:bg-ink/5"
                        >
                          <input
                            type="checkbox"
                            checked={selectedRevs.has(ref.name)}
                            className="accent-accent"
                            onChange={() => toggleRev(ref.name)}
                          />
                          <span className="truncate text-xs text-ink" title={ref.fullName}>
                            {ref.name}
                          </span>
                        </label>
                      ))}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
          <input
            value={draft.author}
            placeholder={t('graph.toolbar.author')}
            onChange={(event) => setDraft((current) => ({ ...current, author: event.target.value }))}
            className={`${inputClass} w-28`}
          />
          <input
            value={draft.path}
            placeholder={t('graph.toolbar.path')}
            onChange={(event) => setDraft((current) => ({ ...current, path: event.target.value }))}
            className={`${inputClass} w-32`}
          />
          <label className="flex items-center gap-1 text-muted">
            <span>{t('graph.toolbar.since')}</span>
            <input
              type="date"
              value={draft.since}
              onChange={(event) => setDraft((current) => ({ ...current, since: event.target.value }))}
              className={inputClass}
            />
          </label>
          <label className="flex items-center gap-1 text-muted">
            <span>{t('graph.toolbar.until')}</span>
            <input
              type="date"
              value={draft.until}
              onChange={(event) => setDraft((current) => ({ ...current, until: event.target.value }))}
              className={inputClass}
            />
          </label>
          <label className="flex cursor-pointer items-center gap-1 text-ink">
            <input
              type="checkbox"
              checked={draft.currentBranch}
              className="accent-accent"
              onChange={() => applyNow({ currentBranch: !draft.currentBranch })}
            />
            {t('graph.toolbar.currentBranch')}
          </label>
          {shownFilters && (
            <button
              type="button"
              className="h-6 rounded px-2 text-muted hover:bg-ink/5 hover:text-ink"
              onClick={() => applyNow(EMPTY_GRAPH_FILTERS)}
            >
              {t('graph.toolbar.clear')}
            </button>
          )}
          {slice.capped && (
            <span className="ml-auto text-warn">
              {t('graph.capped', { count: slice.total ?? commits.length })}
            </span>
          )}
        </div>

        {detached && record !== null && (
          <div className="flex shrink-0 items-center gap-2 border-b border-line/60 bg-warn/10 px-3 py-1 text-xs text-warn">
            <span className="min-w-0 flex-1 truncate">
              {t('branches.detachedBanner', { sha: (headStatus?.sha ?? '').slice(0, 7) })}
            </span>
            <button
              type="button"
              className="shrink-0 rounded border border-warn/40 px-1.5 py-0.5 hover:bg-warn/15"
              onClick={() =>
                operations.openCreateBranch(record, { startPoint: headStatus?.sha ?? 'HEAD' })
              }
            >
              {t('branches.createHere')}
            </button>
          </div>
        )}

        {operation !== 'none' && record !== null && (
          <OperationBanner record={record} operation={operation} conflicts={conflicts} />
        )}

        {slice.error !== null && commits.length > 0 && (
          <div className="flex shrink-0 items-center gap-2 border-b border-line bg-panel px-3 py-1.5 text-xs">
            <span className="min-w-0 flex-1 truncate text-danger" title={slice.error}>
              {slice.error}
            </span>
            <button
              type="button"
              className="shrink-0 rounded px-2 py-0.5 text-muted hover:bg-ink/5 hover:text-ink"
              onClick={() => graph.reload(gitDir)}
            >
              {t('graph.retry')}
            </button>
          </div>
        )}

        <div
          ref={scrollRef}
          onScroll={onScroll}
          onMouseDown={() => rootRef.current?.focus()}
          className="min-h-0 flex-1 overflow-auto"
        >
          {commits.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
              <p className="max-w-md text-center text-sm break-words text-muted">
                {slice.loading ? t('graph.loading') : (slice.error ?? t('graph.empty'))}
              </p>
              {!slice.loading && slice.error !== null && (
                <button
                  type="button"
                  className="rounded border border-line px-3 py-1 text-xs text-ink hover:bg-ink/5"
                  onClick={() => graph.reload(gitDir)}
                >
                  {t('graph.retry')}
                </button>
              )}
            </div>
          ) : (
            <div style={{ height: virtualizer.getTotalSize() }} className="relative">
              {virtualizer.getVirtualItems().map((item) => {
                const commit = commits[item.index]
                const row = layout.rows[item.index]
                if (commit === undefined || row === undefined) return null
                const isTip = commit.sha === slice.headSha
                const isSelected = selection.has(commit.sha)
                const refsForCommit = refs.get(commit.sha) ?? []
                const shown = refsForCommit.slice(0, CHIP_LIMIT)
                const hidden = refsForCommit.length - shown.length
                const outgoing = slice.outgoing.includes(commit.sha)
                const incoming = slice.incoming.includes(commit.sha)
                return (
                  <div
                    key={commit.sha}
                    style={{ height: item.size, transform: `translateY(${String(item.start)}px)` }}
                    onClick={(event) => clickRow(event, commit.sha)}
                    onContextMenu={(event) => openRowMenu(event, commit.sha)}
                    className={`absolute inset-x-0 flex cursor-default items-center gap-1.5 border-l-2 pr-3 text-xs ${
                      compareBase === commit.sha ? 'border-accent' : 'border-transparent'
                    } ${
                      isSelected
                        ? 'bg-accent/10'
                        : isTip
                          ? 'bg-accent/5'
                          : cursor === commit.sha
                            ? 'bg-ink/5'
                            : 'hover:bg-ink/5'
                    }`}
                  >
                    <LaneSvg row={row} laneCount={laneCount} tip={isTip} width={gutterWidth} />
                    <span className="flex w-4 shrink-0 items-center justify-center">
                      {outgoing && (
                        <span className="text-accent" title={t('graph.marks.outgoing')}>
                          ↑
                        </span>
                      )}
                      {incoming && (
                        <span className="text-warn" title={t('graph.marks.incoming')}>
                          ↓
                        </span>
                      )}
                    </span>
                    <span className="w-14 shrink-0 font-mono text-muted">{commit.sha.slice(0, 7)}</span>
                    <span className="flex min-w-0 max-w-[38%] shrink-0 items-center gap-1 overflow-hidden">
                      {detached && isTip && (
                        <span
                          className="inline-block shrink-0 rounded border border-accent bg-accent px-1 text-[10px] leading-4 font-semibold text-white"
                          title={t('graph.chips.detached')}
                        >
                          HEAD
                        </span>
                      )}
                      {shown.map((ref) => (
                        <span
                          key={ref.fullName}
                          className={chipClass(ref)}
                          title={
                            ref.isHead
                              ? t('graph.chips.head', { branch: ref.name })
                              : ref.fullName
                          }
                        >
                          {ref.isHead ? `HEAD → ${ref.name}` : ref.name}
                        </span>
                      ))}
                      {hidden > 0 && (
                        <span
                          className="inline-block shrink-0 rounded border border-line bg-ink/5 px-1 text-[10px] leading-4 text-muted"
                          title={refsForCommit
                            .slice(CHIP_LIMIT)
                            .map((ref) => ref.name)
                            .join('\n')}
                        >
                          +{hidden}
                        </span>
                      )}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-ink" title={commit.subject}>
                      {commit.subject}
                    </span>
                    <span className="w-28 shrink-0 truncate text-right text-muted">
                      {commit.author.name}
                    </span>
                    <span className="w-20 shrink-0 text-right text-muted">
                      {relativeTime(commit.author.date, locale)}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <footer className="flex h-7 shrink-0 items-center justify-between border-t border-line bg-panel px-3 text-xs text-muted">
          <span>{slice.loadingMore ? t('graph.loadingMore') : ''}</span>
          <span>{t('graph.loaded', { count: commits.length })}</span>
        </footer>
      </div>

      {detailSha !== null && (
        <aside className="flex w-85 shrink-0 flex-col border-l border-line bg-panel">
          <header className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
              {t('graph.details.title')}
            </span>
            <button
              type="button"
              aria-label={t('graph.details.more')}
              title={t('graph.details.more')}
              className="shrink-0 rounded px-1.5 py-0.5 text-muted hover:bg-ink/5 hover:text-ink"
              onClick={openDetailsMenu}
            >
              …
            </button>
            <button
              type="button"
              aria-label={t('dialogs.close')}
              className="shrink-0 rounded p-0.5 text-muted hover:bg-ink/5 hover:text-ink"
              onClick={() => setDetailSha(null)}
            >
              <XIcon className="size-3.5" />
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
            {detailsLoading && <p className="text-xs text-muted">{t('graph.details.loading')}</p>}
            {!detailsLoading && detailsError !== null && (
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 text-xs break-words text-danger">{detailsError}</span>
                <button
                  type="button"
                  className="shrink-0 rounded border border-line px-2 py-0.5 text-xs text-ink hover:bg-ink/5"
                  onClick={() => setDetailAttempt((current) => current + 1)}
                >
                  {t('graph.retry')}
                </button>
              </div>
            )}
            {details !== null && (
              <>
                <p className="font-mono text-xs text-muted" title={details.sha}>
                  {details.sha.slice(0, 7)}
                </p>
                <p className="mt-1 text-sm break-words whitespace-pre-wrap text-ink">
                  {details.message}
                </p>
                <dl className="mt-3 space-y-0.5 text-xs">
                  <dt className="text-muted">{t('graph.details.author')}</dt>
                  <dd className="break-words text-ink">
                    {details.author.name} &lt;{details.author.email}&gt;
                  </dd>
                  <dd className="text-muted">{dateFormatter.format(new Date(details.author.date))}</dd>
                  <dt className="pt-1 text-muted">{t('graph.details.committer')}</dt>
                  <dd className="break-words text-ink">
                    {details.committer.name} &lt;{details.committer.email}&gt;
                  </dd>
                  <dd className="text-muted">
                    {dateFormatter.format(new Date(details.committer.date))}
                  </dd>
                </dl>
                <h3 className="mt-3 text-xs font-semibold text-ink">
                  {t('graph.details.files', { count: details.files.length })}
                </h3>
                {details.files.length === 0 ? (
                  <p className="mt-1 text-xs text-muted">{t('graph.details.noFiles')}</p>
                ) : (
                  <ul className="mt-1 space-y-px">
                    {details.files.map((file) => (
                      <li key={`${file.origPath ?? ''}\u0000${file.path}`}>
                        <button
                          type="button"
                          title={file.path}
                          className="flex w-full items-baseline gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-ink/5"
                          onClick={() => openFileDiff(file)}
                        >
                          <span className="w-3 shrink-0 text-center font-mono text-muted">
                            {CHANGE_LETTER[file.kind]}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-ink">{file.path}</span>
                          {file.additions !== null && (
                            <span className="shrink-0 font-mono text-muted">
                              +{file.additions} −{file.deletions ?? 0}
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        </aside>
      )}

      {menu !== null && menuItems.length > 0 && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />
      )}

      {compare !== null && (
        <div
          className="fixed inset-0 z-40 flex justify-center bg-black/40 pt-24"
          onMouseDown={() => setCompare(null)}
        >
          <div
            className="h-fit w-full max-w-md overflow-hidden rounded-lg border border-line bg-panel shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="flex items-center gap-2 border-b border-line px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
                {t('graph.compare.title', {
                  from: compare.from.slice(0, 7),
                  to: compare.to.slice(0, 7)
                })}
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
            <p className="px-3 pt-1.5 text-xs text-muted">
              {t('graph.compare.files', { count: compare.files.length })}
            </p>
            <ul className="max-h-96 overflow-y-auto py-1">
              {compare.files.map((file) => (
                <li key={`${file.origPath ?? ''}\u0000${file.path}`}>
                  <button
                    type="button"
                    className="flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-sm hover:bg-ink/5"
                    onClick={() => {
                      openCompareFile(compare.from, compare.to, file)
                      setCompare(null)
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
}

function LaneSvg({
  row,
  laneCount,
  tip,
  width
}: {
  row: GraphRow
  laneCount: number
  tip: boolean
  width: number
}): JSX.Element {
  const half = ROW_HEIGHT / 2
  const x = (lane: number): number => lane * LANE_WIDTH + LANE_WIDTH / 2
  return (
    <svg width={width} height={ROW_HEIGHT} className="shrink-0" aria-hidden="true">
      {row.edges.map((edge, index) => (
        <line
          key={index}
          x1={edge.fromLane >= 0 ? x(edge.fromLane) : x(row.lane)}
          y1={edge.fromLane >= 0 ? 0 : half}
          x2={edge.toLane >= 0 ? x(edge.toLane) : x(row.lane)}
          y2={edge.toLane >= 0 ? ROW_HEIGHT : half}
          stroke={laneColor(edge.colorLane)}
          strokeWidth={1.5}
        />
      ))}
      <circle
        cx={x(row.lane)}
        cy={half}
        r={tip ? 4.5 : 3.5}
        fill={laneColor(row.lane)}
        stroke={laneColor(row.lane)}
        strokeWidth={0.5}
      />
    </svg>
  )
}

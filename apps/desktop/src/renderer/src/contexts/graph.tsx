import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type ReactNode
} from 'react'
import type {
  CommitInfo,
  GitActivityEntry,
  GitActivityResponse,
  GitGraphRequest,
  GitRef,
  RepoRecord
} from '@gitreedesk/shared'
import { api } from '../api'
import { GRAPH_TAB_LIMIT, repoInfoOf, useEditor } from './editor'
import { useWorkspace } from './workspace'
import { useUiState } from '../use-ui-state'

/** Toolbar filters of one graph tab; `null` revs walk every branch, remote, tag and HEAD. */
export interface GraphFilters {
  revs: string[] | null
  author: string
  path: string
  since: string
  until: string
  grep: string
  /** Restricts the walk to commits reachable from HEAD. */
  currentBranch: boolean
}

export const EMPTY_GRAPH_FILTERS: GraphFilters = {
  revs: null,
  author: '',
  path: '',
  since: '',
  until: '',
  grep: '',
  currentBranch: false
}

/** First page; scrolling streams older history in {@link GRAPH_PAGE_STEP} chunks. */
export const GRAPH_PAGE_SIZE = 1000
export const GRAPH_PAGE_STEP = 2000
/** Huge-repo mode: the loaded window never grows past this. */
export const GRAPH_WINDOW_LIMIT = 10000

/** What the Graph pane shows: one repository's lanes, or the merged workspace timeline. */
export type GraphMode = 'repo' | 'workspace'

/** Window and text filters of the workspace activity timeline. */
export interface ActivityFilters {
  days: number
  author: string
  grep: string
}

export const DEFAULT_ACTIVITY_FILTERS: ActivityFilters = { days: 30, author: '', grep: '' }
export const ACTIVITY_WINDOW_VALUES: readonly number[] = [7, 30, 90, 365]
/** Per repository the timeline reads; recent activity, not whole histories. */
export const ACTIVITY_PER_REPO_LIMIT = 60

/** Loaded state of the cross-repository timeline. */
export interface ActivityState {
  entries: readonly GitActivityEntry[]
  failures: Readonly<GitActivityResponse['failures']>
  /** Checkout keys that filled {@link ACTIVITY_PER_REPO_LIMIT}. */
  truncated: readonly string[]
  loading: boolean
  error: string | null
  /** Checkout keys the running or finished read covers. */
  scope: readonly string[]
  loadedAt: number | null
}

/** A commit the timeline asked a repository graph to select and scroll to. */
export interface GraphReveal {
  gitDir: string
  sha: string
  token: number
}

const INITIAL_ACTIVITY: ActivityState = {
  entries: [],
  failures: [],
  truncated: [],
  loading: false,
  error: null,
  scope: [],
  loadedAt: null
}

const ACTIVITY_FILTERS_KEY = 'graph.activity'
const GRAPH_MODE_KEY = 'graph.mode'

function sanitizeGraphMode(stored: unknown): GraphMode | null {
  return stored === 'workspace' || stored === 'repo' ? stored : null
}

function sanitizeActivityFilters(stored: unknown): ActivityFilters | null {
  if (typeof stored !== 'object' || stored === null) return null
  const value = stored as Record<string, unknown>
  const window = ACTIVITY_WINDOW_VALUES.find((candidate) => candidate === value.days)
  const text = (input: unknown): string => (typeof input === 'string' ? input : '')
  return {
    days: window ?? DEFAULT_ACTIVITY_FILTERS.days,
    author: text(value.author),
    grep: text(value.grep)
  }
}

/** Loaded state of one repository's graph; a slice survives its tab closing (LRU). */
export interface GraphSlice {
  filters: GraphFilters
  commits: readonly CommitInfo[]
  refs: readonly GitRef[]
  upstream: string | null
  outgoing: readonly string[]
  incoming: readonly string[]
  hasMore: boolean
  /** Total commits matching the filters; `null` until a capped window asks for it. */
  total: number | null
  loading: boolean
  loadingMore: boolean
  error: string | null
  /** True once the window stopped at {@link GRAPH_WINDOW_LIMIT}. */
  capped: boolean
  /** HEAD sha the loaded window was read against; auto-refresh watches it. */
  headSha: string | null
}

interface GraphContextValue {
  slices: ReadonlyMap<string, GraphSlice>
  /** Opens (or activates) the graph tab of a checkout and starts its first load. */
  openGraph: (record: RepoRecord) => void
  /** Applies a filter change and reloads from the first page. */
  setFilters: (gitDir: string, update: Partial<GraphFilters>) => void
  resetFilters: (gitDir: string) => void
  reload: (gitDir: string) => void
  loadMore: (gitDir: string) => void
  mode: GraphMode
  setMode: (mode: GraphMode) => void
  activity: ActivityState
  activityFilters: ActivityFilters
  setActivityFilters: (update: Partial<ActivityFilters>) => void
  /** Reads the timeline of the given checkouts; the last scope reloads on filter changes. */
  loadActivity: (gitDirs: readonly string[]) => void
  /** Set when the timeline asks a repository graph to show one of its commits. */
  reveal: GraphReveal | null
  revealCommit: (gitDir: string, sha: string) => void
}

const GraphContext = createContext<GraphContextValue | null>(null)

const EMPTY_SLICES: ReadonlyMap<string, GraphSlice> = new Map()

const INITIAL_SLICE: GraphSlice = {
  filters: EMPTY_GRAPH_FILTERS,
  commits: [],
  refs: [],
  upstream: null,
  outgoing: [],
  incoming: [],
  hasMore: false,
  total: null,
  loading: true,
  loadingMore: false,
  error: null,
  capped: false,
  headSha: null
}

function filtersKey(gitDir: string): string {
  return `graph.filters:${gitDir}`
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function sanitizeFilters(stored: unknown): GraphFilters | null {
  if (typeof stored !== 'object' || stored === null) return null
  const value = stored as Record<string, unknown>
  const text = (input: unknown): string => (typeof input === 'string' ? input : '')
  const revs = Array.isArray(value.revs)
    ? value.revs.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    : []
  return {
    revs: revs.length > 0 ? revs : null,
    author: text(value.author),
    path: text(value.path),
    since: text(value.since),
    until: text(value.until),
    grep: text(value.grep),
    currentBranch: value.currentBranch === true
  }
}

function requestFor(
  gitDir: string,
  filters: GraphFilters,
  skip: number,
  limit: number
): GitGraphRequest {
  const text = (value: string): string | undefined => (value.trim().length > 0 ? value.trim() : undefined)
  return {
    gitDir,
    revs: filters.currentBranch ? ['HEAD'] : (filters.revs ?? undefined),
    author: text(filters.author),
    path: text(filters.path),
    since: text(filters.since),
    until: text(filters.until),
    grep: text(filters.grep),
    skip,
    limit
  }
}

/**
 * Holds the commit graph of each opened repository. The first page is read as
 * soon as a tab opens and further pages append on demand; a slice whose HEAD
 * moved (commit, checkout, rewrite) reloads itself, so a history rewrite shows
 * up without user action.
 */
export function GraphProvider({ children }: { children: ReactNode }): JSX.Element {
  const workspace = useWorkspace()
  const editor = useEditor()
  const [slices, setSlices] = useState<ReadonlyMap<string, GraphSlice>>(EMPTY_SLICES)
  const [activity, setActivity] = useState<ActivityState>(INITIAL_ACTIVITY)
  const [reveal, setReveal] = useState<GraphReveal | null>(null)
  const [mode, storeMode] = useUiState<GraphMode>(GRAPH_MODE_KEY, 'repo', sanitizeGraphMode)
  const [activityFilters, storeActivityFilters] = useUiState<ActivityFilters>(
    ACTIVITY_FILTERS_KEY,
    DEFAULT_ACTIVITY_FILTERS,
    sanitizeActivityFilters
  )
  // useUiState hands out a fresh closure per render; the context keeps stable
  // setters so its value does not change on every status stream update.
  const storeModeRef = useRef(storeMode)
  storeModeRef.current = storeMode
  const storeActivityFiltersRef = useRef(storeActivityFilters)
  storeActivityFiltersRef.current = storeActivityFilters
  const setMode = useCallback((next: GraphMode): void => storeModeRef.current(next), [])
  const activityRef = useRef(activity)
  activityRef.current = activity
  const activityFiltersRef = useRef(activityFilters)
  activityFiltersRef.current = activityFilters
  const activityGeneration = useRef(0)
  const revealTicket = useRef(0)
  const slicesRef = useRef(slices)
  slicesRef.current = slices
  const statusesRef = useRef(workspace.statuses)
  statusesRef.current = workspace.statuses
  const tabsRef = useRef(editor.tabs)
  tabsRef.current = editor.tabs
  /** gitDirs most recently opened first; bounds how many slices stay cached. */
  const recency = useRef<string[]>([])
  const generations = useRef(new Map<string, number>())
  const hydrating = useRef(new Set<string>())
  const root = workspace.descriptor?.root ?? null

  // Slices die with their workspace, like the tabs that show them.
  useEffect(() => {
    setSlices(EMPTY_SLICES)
    recency.current = []
    generations.current = new Map()
    hydrating.current.clear()
    // A closing read of the previous workspace must not land in the new one.
    activityGeneration.current += 1
    setActivity(INITIAL_ACTIVITY)
    setReveal(null)
  }, [root])

  const headOf = useCallback((gitDir: string): string | null => {
    const snapshot = statusesRef.current.get(gitDir)
    return snapshot === undefined ? null : snapshot.status.head.sha
  }, [])

  const bumpGeneration = useCallback((gitDir: string): number => {
    const next = (generations.current.get(gitDir) ?? 0) + 1
    generations.current.set(gitDir, next)
    return next
  }, [])

  const patch = useCallback((gitDir: string, update: (slice: GraphSlice) => GraphSlice): void => {
    setSlices((current) => {
      const slice = current.get(gitDir)
      if (slice === undefined) return current
      const nextSlice = update(slice)
      if (nextSlice === slice) return current
      const next = new Map(current)
      next.set(gitDir, nextSlice)
      return next
    })
  }, [])

  const loadFirstPage = useCallback(
    async (gitDir: string, filters: GraphFilters): Promise<void> => {
      if (!slicesRef.current.has(gitDir)) return
      const generation = bumpGeneration(gitDir)
      patch(gitDir, (slice) => ({ ...slice, filters, loading: true, loadingMore: false, error: null }))
      try {
        const page = await api.invoke('git:graph', requestFor(gitDir, filters, 0, GRAPH_PAGE_SIZE))
        if (generations.current.get(gitDir) !== generation) return
        patch(gitDir, (slice) => ({
          ...slice,
          loading: false,
          commits: page.commits,
          refs: page.refs,
          upstream: page.upstream,
          outgoing: page.outgoing,
          incoming: page.incoming,
          hasMore: page.hasMore,
          total: page.total,
          capped: false,
          headSha: headOf(gitDir)
        }))
      } catch (error) {
        if (generations.current.get(gitDir) !== generation) return
        patch(gitDir, (slice) => ({ ...slice, loading: false, error: errorText(error) }))
      }
    },
    [bumpGeneration, headOf, patch]
  )

  const loadTotal = useCallback(
    async (gitDir: string): Promise<void> => {
      const slice = slicesRef.current.get(gitDir)
      if (slice === undefined) return
      const generation = generations.current.get(gitDir) ?? 0
      try {
        const page = await api.invoke('git:graph', {
          ...requestFor(gitDir, slice.filters, 0, 1),
          countTotal: true
        })
        if (generations.current.get(gitDir) !== generation) return
        patch(gitDir, (current) => ({ ...current, total: page.total }))
      } catch {
        // The cap notice falls back to the loaded count when the count fails.
      }
    },
    [patch]
  )

  const loadMore = useCallback(
    async (gitDir: string): Promise<void> => {
      const slice = slicesRef.current.get(gitDir)
      if (slice === undefined || slice.loading || slice.loadingMore) return
      if (!slice.hasMore || slice.capped) return
      const generation = generations.current.get(gitDir) ?? 0
      patch(gitDir, (current) => ({ ...current, loadingMore: true }))
      try {
        const page = await api.invoke(
          'git:graph',
          requestFor(gitDir, slice.filters, slice.commits.length, GRAPH_PAGE_STEP)
        )
        if (generations.current.get(gitDir) !== generation) return
        const merged = [...slice.commits, ...page.commits]
        const capped = merged.length >= GRAPH_WINDOW_LIMIT
        patch(gitDir, (current) => ({
          ...current,
          loadingMore: false,
          commits: capped ? merged.slice(0, GRAPH_WINDOW_LIMIT) : merged,
          hasMore: page.hasMore,
          capped
        }))
        if (capped) void loadTotal(gitDir)
      } catch (error) {
        if (generations.current.get(gitDir) !== generation) return
        patch(gitDir, (current) => ({ ...current, loadingMore: false, error: errorText(error) }))
      }
    },
    [loadTotal, patch]
  )

  const setFilters = useCallback(
    (gitDir: string, update: Partial<GraphFilters>): void => {
      const slice = slicesRef.current.get(gitDir)
      if (slice === undefined) return
      const filters = { ...slice.filters, ...update }
      void api.invoke('ui-state:set', { key: filtersKey(gitDir), value: filters }).catch((error) => {
        console.error('[graph] persisting filters failed', error)
      })
      void loadFirstPage(gitDir, filters)
    },
    [loadFirstPage]
  )

  const resetFilters = useCallback(
    (gitDir: string): void => {
      setFilters(gitDir, EMPTY_GRAPH_FILTERS)
    },
    [setFilters]
  )

  const reload = useCallback(
    (gitDir: string): void => {
      const slice = slicesRef.current.get(gitDir)
      if (slice === undefined) return
      void loadFirstPage(gitDir, slice.filters)
    },
    [loadFirstPage]
  )

  /** Drops cached slices beyond the LRU window unless their tab is still open. */
  const trimStores = useCallback((): void => {
    setSlices((current) => {
      if (current.size <= GRAPH_TAB_LIMIT) return current
      const keep = new Set(recency.current.slice(0, GRAPH_TAB_LIMIT))
      const open = new Set(
        tabsRef.current.filter((tab) => tab.kind === 'graph').map((tab) => tab.repo.gitDir)
      )
      let next: Map<string, GraphSlice> | null = null
      for (const gitDir of current.keys()) {
        if (keep.has(gitDir) || open.has(gitDir)) continue
        next = next ?? new Map(current)
        next.delete(gitDir)
      }
      return next ?? current
    })
  }, [])

  const ensure = useCallback(
    (gitDir: string): void => {
      recency.current = [gitDir, ...recency.current.filter((entry) => entry !== gitDir)]
      setSlices((current) => {
        if (current.has(gitDir)) return current
        const next = new Map(current)
        next.set(gitDir, INITIAL_SLICE)
        return next
      })
      trimStores()
      if (slicesRef.current.has(gitDir) || hydrating.current.has(gitDir)) return
      hydrating.current.add(gitDir)
      void (async () => {
        let filters = EMPTY_GRAPH_FILTERS
        try {
          const { value } = await api.invoke('ui-state:get', { key: filtersKey(gitDir) })
          const stored = sanitizeFilters(value)
          if (stored !== null) filters = stored
        } catch {
          // Defaults apply when the store has nothing on record.
        } finally {
          hydrating.current.delete(gitDir)
        }
        void loadFirstPage(gitDir, filters)
      })()
    },
    [loadFirstPage, trimStores]
  )

  // A moved HEAD (commit, checkout, rewrite) refreshes a loaded slice.
  useEffect(() => {
    if (root === null) return
    for (const [gitDir, slice] of slices) {
      if (slice.loading || slice.loadingMore || slice.error !== null) continue
      if (headOf(gitDir) !== slice.headSha) void loadFirstPage(gitDir, slice.filters)
    }
  }, [root, slices, workspace.statuses, headOf, loadFirstPage])

  const loadActivity = useCallback((gitDirs: readonly string[]): void => {
    const scope = [...gitDirs]
    const generation = activityGeneration.current + 1
    activityGeneration.current = generation
    if (scope.length === 0) {
      setActivity({ ...INITIAL_ACTIVITY, loading: false })
      return
    }
    setActivity((current) => ({ ...current, loading: true, error: null, scope }))
    const filters = activityFiltersRef.current
    const text = (value: string): string | undefined => (value.trim().length > 0 ? value.trim() : undefined)
    void api
      .invoke('git:activity', {
        gitDirs: scope,
        since: `${String(filters.days)} days ago`,
        author: text(filters.author),
        grep: text(filters.grep),
        maxPerRepo: ACTIVITY_PER_REPO_LIMIT
      })
      .then((response) => {
        if (activityGeneration.current !== generation) return
        setActivity({
          entries: response.entries,
          failures: response.failures,
          truncated: response.truncated,
          loading: false,
          error: null,
          scope,
          loadedAt: Date.now()
        })
      })
      .catch((error: unknown) => {
        if (activityGeneration.current !== generation) return
        setActivity((current) => ({ ...current, loading: false, error: errorText(error) }))
      })
  }, [])

  const setActivityFilters = useCallback(
    (update: Partial<ActivityFilters>): void => {
      const filters = { ...activityFiltersRef.current, ...update }
      // loadActivity reads the ref, so it must see the new filters before the
      // re-render that stores them.
      activityFiltersRef.current = filters
      storeActivityFiltersRef.current(filters)
      if (activityRef.current.scope.length > 0) loadActivity(activityRef.current.scope)
    },
    [loadActivity]
  )

  const revealCommit = useCallback((gitDir: string, sha: string): void => {
    revealTicket.current += 1
    setReveal({ gitDir, sha, token: revealTicket.current })
  }, [])

  const openGraph = useCallback(
    (record: RepoRecord): void => {
      if (record.gitDir.length === 0) return
      ensure(record.gitDir)
      // Opening a repository's graph from anywhere leaves the workspace timeline.
      setMode('repo')
      editor.openGraph(repoInfoOf(record))
    },
    [editor, ensure, setMode]
  )

  const value = useMemo(
    () => ({
      slices,
      openGraph,
      setFilters,
      resetFilters,
      reload,
      loadMore,
      mode,
      setMode,
      activity,
      activityFilters,
      setActivityFilters,
      loadActivity,
      reveal,
      revealCommit
    }),
    [
      slices,
      openGraph,
      setFilters,
      resetFilters,
      reload,
      loadMore,
      mode,
      setMode,
      activity,
      activityFilters,
      setActivityFilters,
      loadActivity,
      reveal,
      revealCommit
    ]
  )

  return <GraphContext.Provider value={value}>{children}</GraphContext.Provider>
}

export function useGraph(): GraphContextValue {
  const value = useContext(GraphContext)
  if (value === null) throw new Error('useGraph requires a GraphProvider')
  return value
}

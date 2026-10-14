import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type JSX,
  type MutableRefObject,
  type ReactNode
} from 'react'
import type { RepoRecord } from '@gitreedesk/shared'
import type { RepoFilters } from '../tree/repos-model'
import { DEFAULT_SCM_GROUPS, type ScmGroupVisibility } from '../tree/scm-model'
import { useUiState } from '../use-ui-state'

export type TreeViewKind = 'explorer' | 'repos'

/** Primary sidebar the activity bar switches between. */
export type SidebarPanel = 'tree' | 'scm'

export interface ViewOptions {
  kindBadges: boolean
  dirty: boolean
  sync: boolean
  operation: boolean
  stash: boolean
  detached: boolean
  showExternalWorktrees: boolean
}

export const DEFAULT_VIEW_OPTIONS: ViewOptions = {
  kindBadges: true,
  dirty: true,
  sync: true,
  operation: true,
  stash: true,
  detached: true,
  showExternalWorktrees: false
}

export const DEFAULT_TREE_FILTERS: RepoFilters = {
  dirty: false,
  aheadBehind: false,
  worktrees: false
}

/** Imperative surface the Explorer advertises while it is the visible view. */
export interface ExplorerActions {
  hasCursor: () => boolean
  newFile: () => void
  newFolder: () => void
  rename: () => void
  remove: () => void
  reveal: () => void
  copyPath: () => void
  openInEditor: () => void
}

/** Imperative surface the Source Control view advertises for commands. */
export interface ScmActions {
  hasSelection: () => boolean
  canStage: () => boolean
  canUnstage: () => boolean
  canDiscard: () => boolean
  stageSelected: () => void
  unstageSelected: () => void
  discardSelected: () => void
}

/** Imperative surface a focused commit box advertises for commands. */
export interface CommitActions {
  canCommit: () => boolean
  commit: () => void
}

/** Imperative surface the Repos view advertises while it is the visible view. */
export interface ReposActions {
  /** Selected repositories; empty when nothing is selected. */
  selectedRecords: () => readonly RepoRecord[]
}

interface TreeUiContextValue {
  view: TreeViewKind
  setView: (next: TreeViewKind) => void
  panel: SidebarPanel
  setPanel: (next: SidebarPanel) => void
  viewOptions: ViewOptions
  setViewOptions: (next: ViewOptions) => void
  filters: RepoFilters
  setFilters: (next: RepoFilters) => void
  /** Checkout keys excluded from the Source Control view; empty means all included. */
  scmDeselected: readonly string[]
  setScmDeselected: (keys: readonly string[]) => void
  isScmSelected: (key: string) => boolean
  setScmSelected: (key: string, selected: boolean) => void
  /** Visible change groups of the Source Control view. */
  scmGroups: ScmGroupVisibility
  setScmGroups: (next: ScmGroupVisibility) => void
  /** Restrict the Source Control view to repositories checked in the Repos view. */
  scmOnlySelected: boolean
  setScmOnlySelected: (next: boolean) => void
  /** Collapsed repository sections and group headers of the Source Control view. */
  scmCollapsed: readonly string[]
  setScmCollapsed: (keys: readonly string[]) => void
  quickPickOpen: boolean
  openQuickPick: () => void
  closeQuickPick: () => void
  /** Repo key the Repos view should reveal; set by quick-open navigation. */
  pendingRepoFocus: string | null
  requestRepoFocus: (key: string) => void
  consumeRepoFocus: () => void
  /** Absolute path the Explorer should reveal; set from editor tabs. */
  pendingExplorerReveal: string | null
  requestExplorerReveal: (path: string) => void
  consumeExplorerReveal: () => void
  /** Bumped to move keyboard focus into the Source Control list. */
  scmFocusTicket: number
  requestScmFocus: () => void
  explorerActions: MutableRefObject<ExplorerActions | null>
  scmActions: MutableRefObject<ScmActions | null>
  reposActions: MutableRefObject<ReposActions | null>
  /** Set while a commit box has focus, so the commit command reaches it. */
  commitActions: MutableRefObject<CommitActions | null>
}

const TreeUiContext = createContext<TreeUiContextValue | null>(null)

const VIEW_KEY = 'tree.view'
const PANEL_KEY = 'sidebar.panel'
const VIEW_OPTIONS_KEY = 'tree.viewOptions'
const FILTERS_KEY = 'tree.filters'
const SCM_KEY = 'tree.scmDeselected'
const SCM_GROUPS_KEY = 'scm.groups'
const SCM_ONLY_SELECTED_KEY = 'scm.onlySelected'
const SCM_COLLAPSED_KEY = 'scm.collapsed'

function sanitizeView(stored: unknown): TreeViewKind | null {
  return stored === 'explorer' || stored === 'repos' ? stored : null
}

function sanitizePanel(stored: unknown): SidebarPanel | null {
  return stored === 'tree' || stored === 'scm' ? stored : null
}

function sanitizeViewOptions(stored: unknown): ViewOptions | null {
  return mergeBooleans(stored, DEFAULT_VIEW_OPTIONS)
}

function sanitizeFilters(stored: unknown): RepoFilters | null {
  return mergeBooleans(stored, DEFAULT_TREE_FILTERS)
}

function sanitizeScmGroups(stored: unknown): ScmGroupVisibility | null {
  return mergeBooleans(stored, DEFAULT_SCM_GROUPS)
}

function mergeBooleans<T extends { [K in keyof T]: boolean }>(stored: unknown, defaults: T): T | null {
  if (typeof stored !== 'object' || stored === null) return null
  const source = stored as Record<string, unknown>
  const next: T = { ...defaults }
  const writable = next as Record<string, boolean>
  for (const key of Object.keys(defaults)) {
    const value = source[key]
    if (typeof value === 'boolean') writable[key] = value
  }
  return next
}

function sanitizeKeys(stored: unknown): string[] | null {
  if (!Array.isArray(stored)) return null
  return stored.filter((item): item is string => typeof item === 'string')
}

function sanitizeBoolean(stored: unknown): boolean | null {
  return typeof stored === 'boolean' ? stored : null
}

export function TreeUiProvider({ children }: { children: ReactNode }): JSX.Element {
  const [view, setView] = useUiState<TreeViewKind>(VIEW_KEY, 'explorer', sanitizeView)
  const [panel, setPanel] = useUiState<SidebarPanel>(PANEL_KEY, 'tree', sanitizePanel)
  const [viewOptions, setViewOptions] = useUiState<ViewOptions>(
    VIEW_OPTIONS_KEY,
    DEFAULT_VIEW_OPTIONS,
    sanitizeViewOptions
  )
  const [filters, setFilters] = useUiState<RepoFilters>(FILTERS_KEY, DEFAULT_TREE_FILTERS, sanitizeFilters)
  const [scmDeselected, setScmDeselectedState] = useUiState<string[]>(SCM_KEY, [], sanitizeKeys)
  const [scmGroups, setScmGroups] = useUiState<ScmGroupVisibility>(
    SCM_GROUPS_KEY,
    DEFAULT_SCM_GROUPS,
    sanitizeScmGroups
  )
  const [scmOnlySelected, setScmOnlySelected] = useUiState<boolean>(
    SCM_ONLY_SELECTED_KEY,
    true,
    sanitizeBoolean
  )
  const [scmCollapsed, setScmCollapsedState] = useUiState<string[]>(SCM_COLLAPSED_KEY, [], sanitizeKeys)
  const [quickPickOpen, setQuickPickOpen] = useState(false)
  const [pendingRepoFocus, setPendingRepoFocus] = useState<string | null>(null)
  const [pendingExplorerReveal, setPendingExplorerReveal] = useState<string | null>(null)
  const [scmFocusTicket, setScmFocusTicket] = useState(0)
  const explorerActions = useRef<ExplorerActions | null>(null)
  const scmActions = useRef<ScmActions | null>(null)
  const reposActions = useRef<ReposActions | null>(null)
  const commitActions = useRef<CommitActions | null>(null)

  const isScmSelected = useCallback(
    (key: string) => !scmDeselected.includes(key),
    [scmDeselected]
  )

  const setScmDeselected = useCallback(
    (keys: readonly string[]) => setScmDeselectedState([...keys]),
    [setScmDeselectedState]
  )

  const setScmSelected = useCallback(
    (key: string, selected: boolean) => {
      const present = !scmDeselected.includes(key)
      if (present === selected) return
      setScmDeselectedState(
        selected ? scmDeselected.filter((item) => item !== key) : [...scmDeselected, key]
      )
    },
    [scmDeselected, setScmDeselectedState]
  )

  const openQuickPick = useCallback(() => setQuickPickOpen(true), [])
  const closeQuickPick = useCallback(() => setQuickPickOpen(false), [])

  const setScmCollapsed = useCallback(
    (keys: readonly string[]) => setScmCollapsedState([...keys]),
    [setScmCollapsedState]
  )

  const requestScmFocus = useCallback(() => setScmFocusTicket((current) => current + 1), [])

  const requestRepoFocus = useCallback(
    (key: string) => {
      setPendingRepoFocus(key)
      setView('repos')
      setPanel('tree')
      setQuickPickOpen(false)
    },
    [setView, setPanel]
  )

  const consumeRepoFocus = useCallback(() => setPendingRepoFocus(null), [])

  const requestExplorerReveal = useCallback(
    (path: string) => {
      setView('explorer')
      setPanel('tree')
      setPendingExplorerReveal(path)
    },
    [setView, setPanel]
  )

  const consumeExplorerReveal = useCallback(() => setPendingExplorerReveal(null), [])

  const value = useMemo(
    () => ({
      view,
      setView,
      panel,
      setPanel,
      viewOptions,
      setViewOptions,
      filters,
      setFilters,
      scmDeselected,
      setScmDeselected,
      isScmSelected,
      setScmSelected,
      scmGroups,
      setScmGroups,
      scmOnlySelected,
      setScmOnlySelected,
      scmCollapsed,
      setScmCollapsed,
      quickPickOpen,
      openQuickPick,
      closeQuickPick,
      pendingRepoFocus,
      requestRepoFocus,
      consumeRepoFocus,
      pendingExplorerReveal,
      requestExplorerReveal,
      consumeExplorerReveal,
      scmFocusTicket,
      requestScmFocus,
      explorerActions,
      scmActions,
      reposActions,
      commitActions
    }),
    [
      view,
      setView,
      panel,
      setPanel,
      viewOptions,
      setViewOptions,
      filters,
      setFilters,
      scmDeselected,
      setScmDeselected,
      isScmSelected,
      setScmSelected,
      scmGroups,
      setScmGroups,
      scmOnlySelected,
      setScmOnlySelected,
      scmCollapsed,
      setScmCollapsed,
      quickPickOpen,
      openQuickPick,
      closeQuickPick,
      pendingRepoFocus,
      requestRepoFocus,
      consumeRepoFocus,
      pendingExplorerReveal,
      requestExplorerReveal,
      consumeExplorerReveal,
      scmFocusTicket,
      requestScmFocus
    ]
  )

  return <TreeUiContext.Provider value={value}>{children}</TreeUiContext.Provider>
}

export function useTreeUi(): TreeUiContextValue {
  const value = useContext(TreeUiContext)
  if (value === null) throw new Error('useTreeUi requires a TreeUiProvider')
  return value
}

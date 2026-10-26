import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type MutableRefObject,
  type ReactNode
} from 'react'
import type { DiffSource, RepoRecord } from '@gitreedesk/shared'
import { compareOrder, compareTabId } from '../editor/compare'
import { useEditorSettings, type EditorSettings } from '../editor/settings'
import type { ScmRow } from '../tree/scm-model'
import { useWorkspace } from './workspace'

/** The parent of a root commit; reading it yields an empty tree in any repository. */
export const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

export interface RepoTabInfo {
  gitDir: string
  /** Absolute worktree root, forward slashes. */
  repoPath: string
  name: string
}

export interface FileTab {
  kind: 'file'
  id: string
  /** Absolute path, forward slashes. */
  path: string
  name: string
  /** Line to reveal; re-requesting bumps {@link focusTicket}. */
  line: number | undefined
  focusTicket: number
}

export interface DiffTab {
  kind: 'diff'
  id: string
  repo: RepoTabInfo
  /** Repo-relative path of the new side. */
  path: string
  origPath: string | null
  from: DiffSource
  to: DiffSource
}

export interface CommitTab {
  kind: 'commit'
  id: string
  repo: RepoTabInfo
  sha: string
  /** First parent; `null` for a root commit. */
  parent: string | null
  path: string
  origPath: string | null
  subject: string
}

export interface CompareTab {
  kind: 'compare'
  id: string
  /** Absolute paths of the two sides, forward slashes; the alphabetically earlier one is left. */
  leftPath: string
  rightPath: string
}

export interface GraphTab {
  kind: 'graph'
  id: string
  repo: RepoTabInfo
}

export interface SettingsTab {
  kind: 'settings'
  id: string
}

export interface ShortcutsTab {
  kind: 'shortcuts'
  id: string
}

export type EditorTab = FileTab | DiffTab | CommitTab | CompareTab | GraphTab | SettingsTab | ShortcutsTab

export const SETTINGS_TAB_ID = 'settings'
export const SHORTCUTS_TAB_ID = 'shortcuts'

/** Graph tabs kept open at once; the least recently used one closes to make room. */
export const GRAPH_TAB_LIMIT = 5

/** Editor navigation history depth. */
const NAV_LIMIT = 50

/** One remembered file location for Alt+← / Alt+→. */
interface NavLocation {
  path: string
  line: number | null
}

/** Imperative surface a file tab advertises while its document is mounted. */
export interface FileTabActions {
  /** Resolves false when the save was blocked (a conflict dialog is showing). */
  save: () => Promise<boolean>
  openInCode: () => void
}

export interface ScmDiffSpec {
  path: string
  origPath: string | undefined
  from: DiffSource
  to: DiffSource
}

export function fileTabId(path: string): string {
  return `file:${path}`
}

export function diffTabId(gitDir: string, path: string): string {
  return `diff:${gitDir}\u0000${path}`
}

export function commitTabId(gitDir: string, sha: string, path: string): string {
  return `commit:${gitDir}\u0000${sha}\u0000${path}`
}

export function graphTabId(gitDir: string): string {
  return `graph:${gitDir}`
}

export function repoInfoOf(record: RepoRecord): RepoTabInfo {
  return { gitDir: record.gitDir, repoPath: record.path, name: record.name }
}

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

/** Diff sources for a Source Control row; `null` for rows without a diffable file. */
export function scmDiffSpec(row: ScmRow): ScmDiffSpec | null {
  if (row.path.endsWith('/')) return null
  if (row.group === 'staged') {
    return {
      path: row.path,
      origPath: row.origPath,
      from: { kind: 'rev', rev: 'HEAD' },
      to: { kind: 'index' }
    }
  }
  return {
    path: row.path,
    origPath: row.origPath,
    from: { kind: 'index' },
    to: { kind: 'worktree' }
  }
}

export function tabLabel(tab: EditorTab): string {
  if (tab.kind === 'file') return tab.name
  if (tab.kind === 'graph') return `${tab.repo.name} (Graph)`
  if (tab.kind === 'settings') return 'Settings'
  if (tab.kind === 'shortcuts') return 'Shortcuts'
  if (tab.kind === 'diff') return baseName(tab.path)
  if (tab.kind === 'compare') return `${baseName(tab.leftPath)} ⇄ ${baseName(tab.rightPath)}`
  return `${baseName(tab.path)} @ ${tab.sha.slice(0, 7)}`
}

interface OpenCommitInput {
  repo: RepoTabInfo
  sha: string
  parent: string | null
  path: string
  origPath?: string
  subject: string
}

interface EditorState {
  tabs: EditorTab[]
  activeId: string | null
  previewId: string | null
  dirty: Set<string>
}

const INITIAL_STATE: EditorState = { tabs: [], activeId: null, previewId: null, dirty: new Set() }

interface EditorContextValue {
  tabs: readonly EditorTab[]
  activeId: string | null
  activeTab: EditorTab | null
  previewId: string | null
  dirtyIds: ReadonlySet<string>
  settings: EditorSettings
  openFile: (path: string, options?: { preview?: boolean; line?: number }) => void
  /** Moves an open file tab to a new path after the file was renamed on disk. */
  remapFileTab: (oldPath: string, newPath: string) => void
  openDiff: (repo: RepoTabInfo, spec: ScmDiffSpec, options?: { preview?: boolean }) => void
  openCommitDiff: (input: OpenCommitInput) => void
  /** Opens (or activates) the tab comparing two workspace files. */
  openCompare: (firstPath: string, secondPath: string) => void
  /** Opens (or activates) the one graph tab of a repository. */
  openGraph: (repo: RepoTabInfo) => void
  /** Opens (or activates) the singleton settings tab. */
  openSettings: () => void
  /** Opens (or activates) the singleton keyboard shortcuts tab. */
  openShortcuts: () => void
  canNavigateBack: () => boolean
  navigateBack: () => void
  canNavigateForward: () => boolean
  navigateForward: () => void
  setDiffSource: (id: string, from: DiffSource) => void
  activateTab: (id: string) => void
  pinTab: (id: string) => void
  setTabDirty: (id: string, dirty: boolean) => void
  requestClose: (ids: readonly string[]) => void
  /** Tab ids waiting for the unsaved-changes decision. */
  closePrompt: readonly string[] | null
  resolveClosePrompt: (action: 'save' | 'discard' | 'cancel') => void
  closeOthers: (id: string) => void
  closeLeft: (id: string) => void
  closeRight: (id: string) => void
  closeAll: () => void
  saveActiveFile: () => void
  openActiveInCode: () => void
  canSaveActive: () => boolean
  fileActions: MutableRefObject<Map<string, FileTabActions>>
  quickOpen: boolean
  openQuickOpen: () => void
  closeQuickOpen: () => void
}

const EditorContext = createContext<EditorContextValue | null>(null)

function insertTab(current: EditorState, tab: EditorTab, preview: boolean): EditorState {
  const tabs = [...current.tabs]
  let previewId = current.previewId
  if (preview) {
    const previewIndex = previewId === null ? -1 : tabs.findIndex((entry) => entry.id === previewId)
    // A preview tab is a single slot: the next preview replaces it unless it was dirtied.
    if (previewIndex >= 0 && previewId !== null && !current.dirty.has(previewId)) {
      tabs[previewIndex] = tab
    } else {
      tabs.push(tab)
    }
    previewId = tab.id
  } else {
    tabs.push(tab)
    if (previewId === tab.id) previewId = null
  }
  return { tabs, activeId: tab.id, previewId, dirty: current.dirty }
}

function removeTabs(state: EditorState, ids: readonly string[]): EditorState {
  const closing = new Set(ids)
  const firstIndex = state.tabs.findIndex((tab) => closing.has(tab.id))
  if (firstIndex === -1) return state
  const tabs = state.tabs.filter((tab) => !closing.has(tab.id))
  const dirty = new Set([...state.dirty].filter((id) => !closing.has(id)))
  const previewId = state.previewId !== null && closing.has(state.previewId) ? null : state.previewId
  let activeId = state.activeId
  if (activeId === null || closing.has(activeId)) {
    const leftCount = state.tabs.slice(0, firstIndex).filter((tab) => !closing.has(tab.id)).length
    const pick = leftCount > 0 ? tabs[leftCount - 1] : tabs[0]
    activeId = pick?.id ?? null
  }
  return { tabs, activeId, previewId, dirty }
}

export function EditorProvider({ children }: { children: ReactNode }): JSX.Element {
  const workspace = useWorkspace()
  const root = workspace.descriptor?.root ?? null
  const [state, setState] = useState<EditorState>(INITIAL_STATE)
  const [closePrompt, setClosePrompt] = useState<readonly string[] | null>(null)
  const [quickOpen, setQuickOpen] = useState(false)
  const fileActions = useRef<Map<string, FileTabActions>>(new Map())
  const settings = useEditorSettings()
  /** Graph tab gitDirs, most recently used first; caps how many stay open. */
  const graphOrder = useRef<string[]>([])

  const stateRef = useRef(state)
  stateRef.current = state
  const closePromptRef = useRef(closePrompt)
  closePromptRef.current = closePrompt
  const navRef = useRef<{ entries: NavLocation[]; index: number }>({ entries: [], index: -1 })

  // Tabs, prompts and the picker die with their workspace.
  useEffect(() => {
    setState(INITIAL_STATE)
    setClosePrompt(null)
    setQuickOpen(false)
    graphOrder.current = []
    navRef.current = { entries: [], index: -1 }
  }, [root])

  const activeTab = useMemo(
    () => state.tabs.find((tab) => tab.id === state.activeId) ?? null,
    [state.tabs, state.activeId]
  )

  const pushNav = useCallback((path: string, line: number | null): void => {
    const current = navRef.current
    const last = current.entries[current.index]
    if (last !== undefined && last.path === path && last.line === line) return
    const entries = [...current.entries.slice(0, current.index + 1), { path, line }]
    if (entries.length > NAV_LIMIT) entries.splice(0, entries.length - NAV_LIMIT)
    navRef.current = { entries, index: entries.length - 1 }
  }, [])

  const openFileAt = useCallback(
    (path: string, options: { preview?: boolean; line?: number } | undefined, record: boolean) => {
      if (record) pushNav(path, options?.line ?? null)
      setState((current) => {
        const index = current.tabs.findIndex((tab) => tab.kind === 'file' && tab.path === path)
        if (index >= 0) {
          const tab = current.tabs[index] as FileTab
          const promote = options?.preview !== true && current.previewId === tab.id
          const next: FileTab =
            options?.line === undefined
              ? tab
              : { ...tab, line: options.line, focusTicket: tab.focusTicket + 1 }
          const tabs = [...current.tabs]
          tabs[index] = next
          return { tabs, activeId: tab.id, previewId: promote ? null : current.previewId, dirty: current.dirty }
        }
        return insertTab(
          current,
          {
            kind: 'file',
            id: fileTabId(path),
            path,
            name: baseName(path),
            line: options?.line,
            focusTicket: 0
          },
          options?.preview === true
        )
      })
    },
    [pushNav]
  )

  const openFile = useCallback(
    (path: string, options?: { preview?: boolean; line?: number }) => openFileAt(path, options, true),
    [openFileAt]
  )

  const remapFileTab = useCallback((oldPath: string, newPath: string): void => {
    const oldId = fileTabId(oldPath)
    const newId = fileTabId(newPath)
    setState((current) => {
      const index = current.tabs.findIndex((tab) => tab.kind === 'file' && tab.path === oldPath)
      if (index === -1) return current
      const tabs = [...current.tabs]
      tabs[index] = { ...(tabs[index] as FileTab), id: newId, path: newPath, name: baseName(newPath) }
      const dirty = new Set(current.dirty)
      if (dirty.delete(oldId)) dirty.add(newId)
      return {
        tabs,
        activeId: current.activeId === oldId ? newId : current.activeId,
        previewId: current.previewId === oldId ? newId : current.previewId,
        dirty
      }
    })
    fileActions.current.delete(oldId)
    navRef.current = {
      ...navRef.current,
      entries: navRef.current.entries.map((entry) =>
        entry.path === oldPath ? { ...entry, path: newPath } : entry
      )
    }
  }, [])

  const applyNav = useCallback(
    (index: number): void => {
      const entry = navRef.current.entries[index]
      if (entry === undefined) return
      navRef.current = { ...navRef.current, index }
      openFileAt(entry.path, entry.line === null ? undefined : { line: entry.line }, false)
    },
    [openFileAt]
  )

  const canNavigateBack = useCallback(() => navRef.current.index > 0, [])

  const navigateBack = useCallback(() => {
    const { index } = navRef.current
    if (index > 0) applyNav(index - 1)
  }, [applyNav])

  const canNavigateForward = useCallback(
    () => navRef.current.index < navRef.current.entries.length - 1,
    []
  )

  const navigateForward = useCallback(() => {
    const { entries, index } = navRef.current
    if (index < entries.length - 1) applyNav(index + 1)
  }, [applyNav])

  const openDiff = useCallback(
    (repo: RepoTabInfo, spec: ScmDiffSpec, options?: { preview?: boolean }) => {
      setState((current) => {
        const id = diffTabId(repo.gitDir, spec.path)
        const index = current.tabs.findIndex((tab) => tab.id === id)
        const next: DiffTab = {
          kind: 'diff',
          id,
          repo,
          path: spec.path,
          origPath: spec.origPath ?? null,
          from: spec.from,
          to: spec.to
        }
        if (index >= 0) {
          const tabs = [...current.tabs]
          tabs[index] = next
          const promote = options?.preview !== true && current.previewId === id
          return { tabs, activeId: id, previewId: promote ? null : current.previewId, dirty: current.dirty }
        }
        return insertTab(current, next, options?.preview === true)
      })
    },
    []
  )

  const openCommitDiff = useCallback((input: OpenCommitInput) => {
    setState((current) => {
      const id = commitTabId(input.repo.gitDir, input.sha, input.path)
      if (current.tabs.some((tab) => tab.id === id)) return { ...current, activeId: id }
      return insertTab(
        current,
        {
          kind: 'commit',
          id,
          repo: input.repo,
          sha: input.sha,
          parent: input.parent,
          path: input.path,
          origPath: input.origPath ?? null,
          subject: input.subject
        },
        false
      )
    })
  }, [])

  const openCompare = useCallback((firstPath: string, secondPath: string) => {
    const [leftPath, rightPath] = compareOrder(firstPath, secondPath)
    const id = compareTabId(firstPath, secondPath)
    setState((current) => {
      const index = current.tabs.findIndex((tab) => tab.id === id)
      if (index >= 0) {
        const tabs = [...current.tabs]
        tabs[index] = { kind: 'compare', id, leftPath, rightPath }
        const promote = current.previewId === id
        return { tabs, activeId: id, previewId: promote ? null : current.previewId, dirty: current.dirty }
      }
      return insertTab(current, { kind: 'compare', id, leftPath, rightPath }, false)
    })
  }, [])

  const touchGraph = useCallback((gitDir: string): void => {
    graphOrder.current = [gitDir, ...graphOrder.current.filter((entry) => entry !== gitDir)]
  }, [])

  const openGraph = useCallback(
    (repo: RepoTabInfo) => {
      touchGraph(repo.gitDir)
      setState((current) => {
        const id = graphTabId(repo.gitDir)
        const index = current.tabs.findIndex((tab) => tab.id === id)
        if (index >= 0) {
          const tabs = [...current.tabs]
          tabs[index] = { kind: 'graph', id, repo }
          return { ...current, tabs, activeId: id }
        }
        return insertTab(current, { kind: 'graph', id, repo }, false)
      })
    },
    [touchGraph]
  )

  const openSettings = useCallback(() => {
    setState((current) => {
      if (current.tabs.some((tab) => tab.kind === 'settings')) {
        return current.activeId === SETTINGS_TAB_ID ? current : { ...current, activeId: SETTINGS_TAB_ID }
      }
      return insertTab(current, { kind: 'settings', id: SETTINGS_TAB_ID }, false)
    })
  }, [])

  const openShortcuts = useCallback(() => {
    setState((current) => {
      if (current.tabs.some((tab) => tab.kind === 'shortcuts')) {
        return current.activeId === SHORTCUTS_TAB_ID ? current : { ...current, activeId: SHORTCUTS_TAB_ID }
      }
      return insertTab(current, { kind: 'shortcuts', id: SHORTCUTS_TAB_ID }, false)
    })
  }, [])

  const setDiffSource = useCallback((id: string, from: DiffSource) => {
    setState((current) => {
      const index = current.tabs.findIndex((tab) => tab.id === id)
      const tab = current.tabs[index]
      if (tab === undefined || tab.kind !== 'diff') return current
      const tabs = [...current.tabs]
      tabs[index] = { ...tab, from }
      return { ...current, tabs }
    })
  }, [])

  const activateTab = useCallback(
    (id: string) => {
      setState((current) => (current.activeId === id ? current : { ...current, activeId: id }))
      const tab = stateRef.current.tabs.find((entry) => entry.id === id)
      if (tab !== undefined && tab.kind === 'graph') touchGraph(tab.repo.gitDir)
    },
    [touchGraph]
  )

  const pinTab = useCallback((id: string) => {
    setState((current) => (current.previewId === id ? { ...current, previewId: null } : current))
  }, [])

  const setTabDirty = useCallback((id: string, dirty: boolean) => {
    setState((current) => {
      if (current.dirty.has(id) === dirty) return current
      const next = new Set(current.dirty)
      if (dirty) next.add(id)
      else next.delete(id)
      // Editing pins a preview tab, exactly as an explicit open would.
      const previewId = dirty && current.previewId === id ? null : current.previewId
      return { ...current, dirty: next, previewId }
    })
  }, [])

  const requestClose = useCallback((ids: readonly string[]) => {
    const current = stateRef.current
    const closing = ids.filter((id) => current.tabs.some((tab) => tab.id === id))
    if (closing.length === 0) return
    const dirty = closing.filter((id) => current.dirty.has(id))
    if (dirty.length === 0) {
      setState((state) => removeTabs(state, closing))
      return
    }
    if (dirty.length < closing.length) {
      const clean = closing.filter((id) => !current.dirty.has(id))
      setState((state) => removeTabs(state, clean))
    }
    setClosePrompt(dirty)
  }, [])

  const resolveClosePrompt = useCallback((action: 'save' | 'discard' | 'cancel') => {
    const ids = closePromptRef.current
    if (ids === null) return
    setClosePrompt(null)
    if (action === 'cancel') return
    if (action === 'discard') {
      setState((state) => removeTabs(state, ids))
      return
    }
    void (async () => {
      const saved: string[] = []
      for (const id of ids) {
        const actions = fileActions.current.get(id)
        const ok = actions === undefined ? true : await actions.save().catch(() => false)
        if (ok) saved.push(id)
      }
      if (saved.length > 0) setState((state) => removeTabs(state, saved))
    })()
  }, [])

  const closeOthers = useCallback(
    (id: string) => {
      const others = stateRef.current.tabs.filter((tab) => tab.id !== id).map((tab) => tab.id)
      if (others.length > 0) requestClose(others)
    },
    [requestClose]
  )

  const closeLeft = useCallback(
    (id: string) => {
      const index = stateRef.current.tabs.findIndex((tab) => tab.id === id)
      if (index < 1) return
      requestClose(stateRef.current.tabs.slice(0, index).map((tab) => tab.id))
    },
    [requestClose]
  )

  const closeRight = useCallback(
    (id: string) => {
      const tabs = stateRef.current.tabs
      const index = tabs.findIndex((tab) => tab.id === id)
      if (index === -1 || index === tabs.length - 1) return
      requestClose(tabs.slice(index + 1).map((tab) => tab.id))
    },
    [requestClose]
  )

  const closeAll = useCallback(() => {
    requestClose(stateRef.current.tabs.map((tab) => tab.id))
  }, [requestClose])

  // Graph tabs are capped: the least recently used one closes when another opens.
  useEffect(() => {
    const graphs = state.tabs.filter((tab) => tab.kind === 'graph')
    if (graphs.length <= GRAPH_TAB_LIMIT) return
    const keep = new Set(graphOrder.current.slice(0, GRAPH_TAB_LIMIT))
    const stale = graphs.filter((tab) => !keep.has(tab.repo.gitDir)).map((tab) => tab.id)
    if (stale.length > 0) requestClose(stale)
  }, [state.tabs, requestClose])

  const saveActiveFile = useCallback(() => {
    const { activeId } = stateRef.current
    if (activeId === null) return
    void fileActions.current
      .get(activeId)
      ?.save()
      .catch(() => undefined)
  }, [])

  const openActiveInCode = useCallback(() => {
    const { activeId } = stateRef.current
    if (activeId === null) return
    fileActions.current.get(activeId)?.openInCode()
  }, [])

  const canSaveActive = useCallback(() => {
    const { activeId } = stateRef.current
    return activeId !== null && fileActions.current.has(activeId)
  }, [])

  const openQuickOpen = useCallback(() => setQuickOpen(true), [])
  const closeQuickOpen = useCallback(() => setQuickOpen(false), [])

  const value = useMemo(
    () => ({
      tabs: state.tabs,
      activeId: state.activeId,
      activeTab,
      previewId: state.previewId,
      dirtyIds: state.dirty,
      settings,
      openFile,
      remapFileTab,
      openDiff,
      openCommitDiff,
      openCompare,
      openGraph,
      openSettings,
      openShortcuts,
      canNavigateBack,
      navigateBack,
      canNavigateForward,
      navigateForward,
      setDiffSource,
      activateTab,
      pinTab,
      setTabDirty,
      requestClose,
      closePrompt,
      resolveClosePrompt,
      closeOthers,
      closeLeft,
      closeRight,
      closeAll,
      saveActiveFile,
      openActiveInCode,
      canSaveActive,
      fileActions,
      quickOpen,
      openQuickOpen,
      closeQuickOpen
    }),
    [
      state,
      activeTab,
      settings,
      openFile,
      remapFileTab,
      openDiff,
      openCommitDiff,
      openCompare,
      openGraph,
      openSettings,
      openShortcuts,
      canNavigateBack,
      navigateBack,
      canNavigateForward,
      navigateForward,
      setDiffSource,
      activateTab,
      pinTab,
      setTabDirty,
      requestClose,
      closePrompt,
      resolveClosePrompt,
      closeOthers,
      closeLeft,
      closeRight,
      closeAll,
      saveActiveFile,
      openActiveInCode,
      canSaveActive,
      quickOpen,
      openQuickOpen,
      closeQuickOpen
    ]
  )

  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>
}

export function useEditor(): EditorContextValue {
  const value = useContext(EditorContext)
  if (value === null) throw new Error('useEditor requires an EditorProvider')
  return value
}

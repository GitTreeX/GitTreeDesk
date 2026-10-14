import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type JSX } from 'react'
import type { RepoRecord } from '@gitreedesk/shared'
import { api } from './api'
import { createBuiltinCommands, type BuiltinContext } from './commands/builtin'
import { KeyBindingService, buildBindings } from './commands/defaults'
import { CommandRegistry } from './commands/registry'
import { AppShell } from './components/AppShell'
import { CommandPalette } from './components/CommandPalette'
import { OutputPanel } from './components/OutputPanel'
import { QuickOpen } from './components/QuickOpen'
import { QuickPick } from './components/QuickPick'
import { StatusBar } from './components/StatusBar'
import { ToastHost } from './components/ToastHost'
import { TrustDialog } from './components/TrustDialog'
import { WelcomeView } from './components/WelcomeView'
import { EditorProvider, useEditor } from './contexts/editor'
import { OperationsProvider } from './contexts/operations'
import { useOperations } from './contexts/operations-context'
import { ReposUiProvider, useReposUi } from './contexts/repos'
import { SettingsProvider, useSettings, type InitialSettings } from './contexts/settings'
import { TreeUiProvider, useTreeUi, type SidebarPanel } from './contexts/tree'
import { WorkspaceProvider, useWorkspace } from './contexts/workspace'
import { nextTheme } from './theme'
import { checkoutKey } from './tree/repos-model'

const SIDEBAR_WIDTH_KEY = 'shell.sidebarWidth'
const SIDEBAR_COLLAPSED_KEY = 'shell.sidebarCollapsed'
const DEFAULT_SIDEBAR_WIDTH = 300
const MIN_SIDEBAR_WIDTH = 220
const MAX_SIDEBAR_WIDTH = 560

function clampWidth(value: number): number {
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, value))
}

function persist(key: string, value: unknown): void {
  void api.invoke('ui-state:set', { key, value }).catch((error: unknown) => {
    console.error(`[app] persisting ${key} failed`, error)
  })
}

export function App({ initialSettings }: { initialSettings: InitialSettings }): JSX.Element {
  return (
    <SettingsProvider initial={initialSettings}>
      <WorkspaceProvider>
        <TreeUiProvider>
          <EditorProvider>
            <ReposUiProvider>
              <OperationsProvider>
                <AppRoot />
              </OperationsProvider>
            </ReposUiProvider>
          </EditorProvider>
        </TreeUiProvider>
      </WorkspaceProvider>
    </SettingsProvider>
  )
}

function AppRoot(): JSX.Element {
  const settings = useSettings()
  const workspace = useWorkspace()
  const tree = useTreeUi()
  const editor = useEditor()
  const repoUi = useReposUi()
  const operations = useOperations()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH)
  const [trustPrompted, setTrustPrompted] = useState(false)
  const [dropActive, setDropActive] = useState(false)
  const dragDepth = useRef(0)
  const collapsedRef = useRef(sidebarCollapsed)
  collapsedRef.current = sidebarCollapsed

  const registry = useMemo(() => new CommandRegistry(), [])
  const keybindings = useMemo(
    () => new KeyBindingService(registry, api.platform, buildBindings(api.platform)),
    [registry]
  )

  const selectPanel = (next: SidebarPanel): void => {
    if (!collapsedRef.current && tree.panel === next) {
      collapsedRef.current = true
      setSidebarCollapsed(true)
      persist(SIDEBAR_COLLAPSED_KEY, true)
      return
    }
    if (collapsedRef.current) {
      collapsedRef.current = false
      setSidebarCollapsed(false)
      persist(SIDEBAR_COLLAPSED_KEY, false)
    }
    tree.setPanel(next)
    if (next === 'scm') tree.requestScmFocus()
  }

  const builtinRef = useRef<BuiltinContext | null>(null)

  // Fetch acts on the Repos-view selection; without one, on the active repo.
  const fetchTargets = (): readonly RepoRecord[] => {
    const selected = tree.reposActions.current?.selectedRecords() ?? []
    if (selected.length > 0) return selected
    return repoUi.activeRecord !== null ? [repoUi.activeRecord] : []
  }

  const syncTarget = (): { record: RepoRecord; branch: string; hasUpstream: boolean } | null => {
    const record = repoUi.activeRecord
    if (record === null || record.kind === 'bare' || record.gitDir.length === 0) return null
    const status = workspace.statuses.get(record.gitDir)?.status ?? null
    const branch = status?.head.ref ?? null
    if (status === null || branch === null) return null
    return { record, branch, hasUpstream: status.upstream !== null }
  }

  const withActiveRecord = (task: (record: RepoRecord) => void): void => {
    const record = repoUi.activeRecord
    if (record !== null) task(record)
  }

  builtinRef.current = {
    openFolder: () => {
      void (async () => {
        try {
          const { path } = await api.invoke('workspace:pick')
          if (path !== null) await workspace.open(path)
        } catch (error) {
          console.error('[app] open folder failed', error)
        }
      })()
    },
    closeFolder: () => void workspace.close(),
    rescan: () => void workspace.rescan(),
    toggleSidebar: () => {
      const next = !collapsedRef.current
      collapsedRef.current = next
      setSidebarCollapsed(next)
      persist(SIDEBAR_COLLAPSED_KEY, next)
    },
    showExplorer: () => {
      tree.setPanel('tree')
      tree.setView('explorer')
    },
    showRepos: () => {
      tree.setPanel('tree')
      tree.setView('repos')
    },
    showScm: () => selectPanel('scm'),
    goToRepo: () => tree.openQuickPick(),
    selectAllRepos: () => tree.setScmDeselected([]),
    selectNoneRepos: () =>
      tree.setScmDeselected((workspace.descriptor?.records ?? []).map((record) => checkoutKey(record))),
    cycleTheme: () => void settings.setTheme(nextTheme(settings.theme)),
    toggleLocale: () => void settings.setLocale(settings.locale === 'en' ? 'zh-Hans' : 'en'),
    trust: () => void workspace.setTrusted(true),
    revokeTrust: () => void workspace.setTrusted(false),
    togglePalette: () => setPaletteOpen((current) => !current),
    dismiss: () => {
      setPaletteOpen(false)
      tree.closeQuickPick()
      editor.closeQuickOpen()
    },
    hasWorkspace: () => workspace.descriptor !== null,
    isTrusted: () => workspace.descriptor?.trusted === true,
    hasExplorerActions: () => tree.explorerActions.current !== null,
    explorerHasCursor: () => tree.explorerActions.current?.hasCursor() ?? false,
    explorerNewFile: () => tree.explorerActions.current?.newFile(),
    explorerNewFolder: () => tree.explorerActions.current?.newFolder(),
    explorerRename: () => tree.explorerActions.current?.rename(),
    explorerDelete: () => tree.explorerActions.current?.remove(),
    explorerReveal: () => tree.explorerActions.current?.reveal(),
    explorerCopyPath: () => tree.explorerActions.current?.copyPath(),
    explorerOpenInEditor: () => tree.explorerActions.current?.openInEditor(),
    scmCanStage: () => tree.scmActions.current?.canStage() ?? false,
    scmCanUnstage: () => tree.scmActions.current?.canUnstage() ?? false,
    scmCanDiscard: () => tree.scmActions.current?.canDiscard() ?? false,
    scmStageSelected: () => tree.scmActions.current?.stageSelected(),
    scmUnstageSelected: () => tree.scmActions.current?.unstageSelected(),
    scmDiscardSelected: () => tree.scmActions.current?.discardSelected(),
    editorCanSave: () => editor.canSaveActive(),
    editorSave: () => editor.saveActiveFile(),
    editorHasTab: () => editor.activeId !== null,
    editorCloseTab: () => {
      const activeId = editor.activeId
      if (activeId !== null) editor.requestClose([activeId])
    },
    editorQuickOpen: () => editor.openQuickOpen(),
    gitBranches: () => withActiveRecord((record) => operations.openBranches(record)),
    gitCreateBranch: () => withActiveRecord((record) => operations.openCreateBranch(record)),
    gitMergeInto: () => withActiveRecord((record) => operations.openBranches(record)),
    gitRebaseCurrent: () => withActiveRecord((record) => operations.openBranches(record)),
    gitFetch: () => operations.fetchRepos(fetchTargets()),
    gitFetchAll: () => operations.fetchRepos(workspace.descriptor?.records ?? []),
    gitPull: () => {
      const target = syncTarget()
      if (target !== null) operations.pullRepos([target.record])
    },
    gitPush: () => {
      const target = syncTarget()
      if (target !== null) {
        operations.pushBranch(target.record, target.branch, { hasUpstream: target.hasUpstream })
      }
    },
    gitRemotes: () => withActiveRecord((record) => operations.openRemotes(record)),
    gitTags: () => withActiveRecord((record) => operations.openTags(record)),
    gitStashCreate: () => withActiveRecord((record) => operations.openStashCreate(record)),
    gitStashes: () => withActiveRecord((record) => operations.openStashes(record)),
    gitRestoreBackup: () => withActiveRecord((record) => operations.openBackupRestore(record)),
    gitHasTarget: () => repoUi.activeRecord !== null,
    gitHasRepos: () => (workspace.descriptor?.records.length ?? 0) > 0,
    gitCanSync: () => syncTarget() !== null,
    gitHasWorktree: () => {
      const record = repoUi.activeRecord
      return record !== null && record.kind !== 'bare' && record.gitDir.length > 0
    },
    toggleOutput: () => operations.setOutputOpen(!operations.outputOpen)
  }

  const getBuiltin = useCallback((): BuiltinContext => {
    const context = builtinRef.current
    if (context === null) throw new Error('The builtin command context is not ready')
    return context
  }, [])

  useEffect(() => {
    for (const definition of createBuiltinCommands(getBuiltin)) registry.register(definition)
  }, [registry, getBuiltin])

  useEffect(() => {
    return api.on('app:command', (event) => {
      void registry.execute(event.command).catch((error: unknown) => {
        console.error(`[app] command ${event.command} failed`, error)
      })
    })
  }, [registry])

  useEffect(() => keybindings.attach(window), [keybindings])

  useEffect(() => {
    setTrustPrompted(false)
  }, [workspace.descriptor?.root])

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const [width, collapsed] = await Promise.all([
          api.invoke('ui-state:get', { key: SIDEBAR_WIDTH_KEY }),
          api.invoke('ui-state:get', { key: SIDEBAR_COLLAPSED_KEY })
        ])
        if (!live) return
        if (typeof width.value === 'number' && Number.isFinite(width.value)) {
          setSidebarWidth(clampWidth(width.value))
        }
        if (typeof collapsed.value === 'boolean') setSidebarCollapsed(collapsed.value)
      } catch {
        // First launch: defaults apply.
      }
    })()
    return () => {
      live = false
    }
  }, [])

  const onResizeCommit = useCallback((width: number) => {
    persist(SIDEBAR_WIDTH_KEY, width)
  }, [])

  const onDragEnter = (event: DragEvent<HTMLDivElement>): void => {
    if (!event.dataTransfer.types.includes('Files')) return
    dragDepth.current += 1
    setDropActive(true)
  }

  const onDragOver = (event: DragEvent<HTMLDivElement>): void => {
    if (event.dataTransfer.types.includes('Files')) event.preventDefault()
  }

  const onDragLeave = (): void => {
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDropActive(false)
  }

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    dragDepth.current = 0
    setDropActive(false)
    const file = event.dataTransfer.files[0]
    if (file === undefined) return
    event.preventDefault()
    const path = api.getPathForFile(file)
    if (path.length > 0) void workspace.open(path)
  }

  const descriptor = workspace.descriptor
  const trustPrompt = descriptor !== null && !descriptor.trusted && !trustPrompted

  return (
    <div
      className="relative flex h-full flex-col bg-canvas text-ink"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {descriptor === null ? (
        <WelcomeView />
      ) : (
        <>
          <AppShell
            sidebarCollapsed={sidebarCollapsed}
            sidebarWidth={sidebarWidth}
            onSelectPanel={selectPanel}
            onResizeSidebar={setSidebarWidth}
            onResizeCommit={onResizeCommit}
          />
          <OutputPanel />
        </>
      )}
      <StatusBar />
      {paletteOpen && (
        <CommandPalette
          registry={registry}
          keybindings={keybindings}
          onClose={() => setPaletteOpen(false)}
        />
      )}
      {tree.quickPickOpen && <QuickPick />}
      {editor.quickOpen && <QuickOpen />}
      <ToastHost />
      {trustPrompt && descriptor !== null && (
        <TrustDialog
          root={descriptor.root}
          onDecide={(trusted) => {
            setTrustPrompted(true)
            void workspace.setTrusted(trusted)
          }}
        />
      )}
      {dropActive && (
        <div className="pointer-events-none absolute inset-1 z-30 rounded-md border-2 border-dashed border-accent/70 bg-accent/5" />
      )}
    </div>
  )
}

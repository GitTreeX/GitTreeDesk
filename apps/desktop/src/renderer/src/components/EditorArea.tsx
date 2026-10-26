import { useCallback, useEffect, useMemo, useState, type JSX, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import { tabLabel, useEditor, type EditorTab, type FileTab } from '../contexts/editor'
import { useSettings } from '../contexts/settings'
import { useTreeUi } from '../contexts/tree'
import { loadMonaco } from '../editor/monaco'
import { notifyError } from '../notify'
import { resolveTheme } from '../theme'
import { CompareFilesView } from './CompareFilesView'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'
import { FileDiffView } from './FileDiffView'
import { FileEditor } from './FileEditor'
import { GraphView } from './GraphView'
import { KeyboardShortcutsView } from './KeyboardShortcutsView'
import { PromptDialog } from './PromptDialog'
import { SettingsView } from './SettingsView'
import { WorkspaceOverview } from './WorkspaceOverview'

const THEME_DARK = 'gtd-dark'
const THEME_LIGHT = 'gtd-light'

function defineThemes(monaco: Awaited<ReturnType<typeof loadMonaco>>): void {
  monaco.editor.defineTheme(THEME_DARK, {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: { 'editor.background': '#121214' }
  })
  monaco.editor.defineTheme(THEME_LIGHT, {
    base: 'vs',
    inherit: true,
    rules: [],
    colors: { 'editor.background': '#ffffff' }
  })
}

export function EditorArea(): JSX.Element {
  const editor = useEditor()
  const { theme } = useSettings()

  useEffect(() => {
    let live = true
    let media: MediaQueryList | null = null
    let onSystemChange: (() => void) | null = null
    void loadMonaco().then((monaco) => {
      if (!live) return
      defineThemes(monaco)
      const apply = (): void => {
        const resolved = resolveTheme(theme, window.matchMedia('(prefers-color-scheme: dark)').matches)
        monaco.editor.setTheme(resolved === 'dark' ? THEME_DARK : THEME_LIGHT)
      }
      apply()
      media = window.matchMedia('(prefers-color-scheme: dark)')
      onSystemChange = apply
      media.addEventListener('change', apply)
    })
    return () => {
      live = false
      if (media !== null && onSystemChange !== null) media.removeEventListener('change', onSystemChange)
    }
  }, [theme])

  if (editor.tabs.length === 0) return <WorkspaceOverview />

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TabStrip />
      <div className="relative flex min-h-0 flex-1 flex-col">
        {editor.tabs.map((tab) => (
          <div
            key={tab.id}
            data-tab-id={tab.id}
            data-active={tab.id === editor.activeId ? 'true' : undefined}
            className={tab.id === editor.activeId ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}
          >
            {tab.kind === 'file' ? (
              <FileEditor tab={tab} active={tab.id === editor.activeId} />
            ) : tab.kind === 'graph' ? (
              <GraphView tab={tab} />
            ) : tab.kind === 'settings' ? (
              <SettingsView />
            ) : tab.kind === 'shortcuts' ? (
              <KeyboardShortcutsView />
            ) : tab.kind === 'compare' ? (
              <CompareFilesView tab={tab} />
            ) : (
              <FileDiffView tab={tab} />
            )}
          </div>
        ))}
        {editor.closePrompt !== null && <ClosePrompt />}
      </div>
    </div>
  )
}

function TabStrip(): JSX.Element {
  const { t } = useTranslation()
  const editor = useEditor()
  const tree = useTreeUi()
  const [menu, setMenu] = useState<{ x: number; y: number; tab: EditorTab } | null>(null)
  const [renaming, setRenaming] = useState<FileTab | null>(null)

  const copyPath = useCallback((text: string): void => {
    void api.invoke('app:copyText', { text }).catch((error: unknown) => {
      notifyError(error instanceof Error ? error.message : String(error))
    })
  }, [])

  const renameTab = useCallback(
    async (tab: FileTab, newName: string): Promise<void> => {
      try {
        if (editor.dirtyIds.has(tab.id)) {
          const actions = editor.fileActions.current.get(tab.id)
          const saved = actions === undefined ? true : await actions.save()
          if (!saved) return
        }
        const { path } = await api.invoke('fs:rename', { path: tab.path, newName })
        editor.remapFileTab(tab.path, path)
        setRenaming(null)
      } catch (error) {
        notifyError(error instanceof Error ? error.message : String(error))
      }
    },
    [editor]
  )

  const validateTabName = useCallback(
    (value: string): string | null => {
      const name = value.trim()
      if (
        name.length === 0 ||
        name === '.' ||
        name === '..' ||
        /[/\\\u0000-\u001f]/.test(name)
      ) {
        return t('explorer.errors.invalidName')
      }
      return null
    },
    [t]
  )

  const absolutePath = useCallback((tab: EditorTab): string | null => {
    if (tab.kind === 'file') return tab.path
    if (tab.kind === 'graph') return tab.repo.repoPath
    if (tab.kind === 'settings' || tab.kind === 'shortcuts' || tab.kind === 'compare') return null
    return `${tab.repo.repoPath}/${tab.path}`
  }, [])

  const menuItems = useCallback(
    (tab: EditorTab): ContextMenuItem[] => {
      const tabs = editor.tabs
      const index = tabs.findIndex((item) => item.id === tab.id)
      const items: ContextMenuItem[] = [
        { label: t('tabs.close'), onSelect: () => editor.requestClose([tab.id]) },
        {
          label: t('tabs.closeLeft'),
          disabled: index < 1,
          onSelect: () => editor.closeLeft(tab.id)
        },
        {
          label: t('tabs.closeRight'),
          disabled: index === -1 || index === tabs.length - 1,
          onSelect: () => editor.closeRight(tab.id)
        },
        { label: t('tabs.closeOthers'), disabled: tabs.length < 2, onSelect: () => editor.closeOthers(tab.id) },
        { label: t('tabs.closeAll'), onSelect: () => editor.closeAll() }
      ]
      const path = absolutePath(tab)
      if (path === null) return items
      const fileItems: ContextMenuItem[] = [{ label: '', separator: true }]
      if (tab.kind === 'file') {
        fileItems.push({ label: t('menu.rename'), onSelect: () => setRenaming(tab) })
      }
      fileItems.push(
        { label: t('menu.copyPath'), onSelect: () => copyPath(path) },
        {
          label: t('menu.reveal'),
          onSelect: () => {
            void api.invoke('fs:reveal', { path }).catch((error: unknown) => {
              notifyError(error instanceof Error ? error.message : String(error))
            })
          }
        },
        {
          label: t('menu.revealInExplorer'),
          onSelect: () => tree.requestExplorerReveal(path)
        }
      )
      return [...items, ...fileItems]
    },
    [absolutePath, copyPath, editor, t, tree]
  )

  return (
    <div role="tablist" className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-line bg-panel">
      {editor.tabs.map((tab) => {
        const active = tab.id === editor.activeId
        const dirty = editor.dirtyIds.has(tab.id)
        const preview = tab.id === editor.previewId
        const label =
          tab.kind === 'settings'
            ? t('settings.title')
            : tab.kind === 'shortcuts'
              ? t('keyboard.title')
              : tabLabel(tab)
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={active}
            title={absolutePath(tab) ?? label}
            className={`group flex max-w-56 shrink-0 cursor-default items-center gap-1.5 border-r border-line px-2.5 text-xs select-none ${
              active ? 'bg-canvas text-ink' : 'text-muted hover:bg-ink/5 hover:text-ink'
            }`}
            onClick={() => {
              editor.activateTab(tab.id)
              editor.pinTab(tab.id)
            }}
            onDoubleClick={() => editor.pinTab(tab.id)}
            onAuxClick={(event: MouseEvent<HTMLDivElement>) => {
              if (event.button === 1) editor.requestClose([tab.id])
            }}
            onContextMenu={(event: MouseEvent<HTMLDivElement>) => {
              event.preventDefault()
              setMenu({ x: event.clientX, y: event.clientY, tab })
            }}
          >
            {dirty && <span className="size-1.5 shrink-0 rounded-full bg-accent" />}
            <span className={`min-w-0 truncate ${preview ? 'italic' : ''}`}>{label}</span>
            <button
              type="button"
              tabIndex={-1}
              aria-label={t('tabs.close')}
              className={`shrink-0 rounded p-0.5 hover:bg-ink/10 hover:text-ink ${
                dirty ? '' : 'invisible group-hover:visible'
              }`}
              onClick={(event) => {
                event.stopPropagation()
                editor.requestClose([tab.id])
              }}
            >
              ✕
            </button>
          </div>
        )
      })}

      {menu !== null && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems(menu.tab)}
          onClose={() => setMenu(null)}
        />
      )}

      {renaming !== null && (
        <PromptDialog
          title={t('menu.rename')}
          label={t('dialogs.nameLabel')}
          initialValue={renaming.name}
          submitLabel={t('dialogs.rename')}
          validate={validateTabName}
          onSubmit={(name) => void renameTab(renaming, name.trim())}
          onClose={() => setRenaming(null)}
        />
      )}
    </div>
  )
}

function ClosePrompt(): JSX.Element {
  const { t } = useTranslation()
  const editor = useEditor()
  const ids = editor.closePrompt ?? []
  const names = useMemo(
    () =>
      editor.tabs
        .filter((tab) => ids.includes(tab.id))
        .map((tab) =>
          tab.kind === 'settings'
            ? t('settings.title')
            : tab.kind === 'shortcuts'
              ? t('keyboard.title')
              : tabLabel(tab)
        ),
    [editor.tabs, ids, t]
  )
  const body =
    names.length === 1
      ? t('editor.closePromptOne', { name: names[0] ?? '' })
      : t('editor.closePromptMany', { count: names.length })

  return (
    <div className="fixed inset-0 z-40 flex justify-center bg-black/40 pt-32" onMouseDown={() => editor.resolveClosePrompt('cancel')}>
      <div
        role="alertdialog"
        aria-modal="true"
        className="h-fit w-full max-w-sm rounded-lg border border-line bg-panel p-4 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 className="text-sm font-semibold text-ink">{t('editor.closePromptTitle')}</h2>
        <p className="mt-2 text-sm break-words text-muted">{body}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="rounded px-3 py-1 text-sm text-muted hover:bg-ink/5 hover:text-ink"
            onClick={() => editor.resolveClosePrompt('cancel')}
          >
            {t('dialogs.cancel')}
          </button>
          <button
            type="button"
            className="rounded border border-line px-3 py-1 text-sm text-ink hover:bg-ink/5"
            onClick={() => editor.resolveClosePrompt('discard')}
          >
            {t('editor.closePromptDiscard')}
          </button>
          <button
            type="button"
            className="rounded bg-accent px-3 py-1 text-sm text-white hover:opacity-90"
            onClick={() => editor.resolveClosePrompt('save')}
          >
            {t('editor.closePromptSave')}
          </button>
        </div>
      </div>
    </div>
  )
}

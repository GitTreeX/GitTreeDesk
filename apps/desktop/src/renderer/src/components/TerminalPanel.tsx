import { useCallback, useState, type JSX, type PointerEvent as ReactPointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useTerminal } from '../contexts/terminal'
import { useWorkspace } from '../contexts/workspace'
import { clampPanelHeight, DEFAULT_PANEL_HEIGHT, sanitizePanelHeight, sessionLabel } from '../lib/terminal'
import { useUiState } from '../use-ui-state'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'
import { ChevronDownIcon, PlusIcon, TerminalIcon, XIcon } from './icons'
import { TerminalView } from './TerminalView'

export function TerminalPanel(): JSX.Element | null {
  const { t } = useTranslation()
  const terminal = useTerminal()
  const workspace = useWorkspace()
  const [storedHeight, setStoredHeight] = useUiState<number>(
    'terminal.panelHeight',
    DEFAULT_PANEL_HEIGHT,
    sanitizePanelHeight
  )
  const [dragHeight, setDragHeight] = useState<number | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  const onHandlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      const startY = event.clientY
      const startHeight = dragHeight ?? storedHeight
      let last = startHeight
      const onMove = (moveEvent: PointerEvent): void => {
        last = clampPanelHeight(startHeight + (startY - moveEvent.clientY))
        setDragHeight(last)
      }
      const onUp = (): void => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        setDragHeight(null)
        setStoredHeight(last)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [dragHeight, setStoredHeight, storedHeight]
  )

  if (!terminal.visible) return null

  const height = dragHeight ?? storedHeight
  const trusted = workspace.descriptor?.trusted === true
  const resolution = terminal.resolution

  const menuItems: ContextMenuItem[] = []
  if (resolution !== null) {
    for (const profile of resolution.info.profiles) {
      const missing = profile.missing === true
      menuItems.push({
        label: missing ? `${profile.name} — ${t('terminal.notFound')}` : profile.name,
        disabled: missing,
        onSelect: () => terminal.open(resolution.dir, { profileId: profile.id })
      })
    }
  }
  if (trusted) {
    const commands = resolution?.info.quickCommands ?? []
    if (commands.length > 0) {
      menuItems.push({ label: t('terminal.profilesQuick'), disabled: true, divider: true, onSelect: () => undefined })
      for (const command of commands) {
        menuItems.push({
          label: command.name,
          onSelect: () => {
            if (resolution !== null) terminal.quickRun(resolution.dir, command.name)
          }
        })
      }
    }
  } else {
    menuItems.push({
      label: t('terminal.quickDisabledUntrusted'),
      disabled: true,
      divider: menuItems.length > 0,
      onSelect: () => undefined
    })
  }

  return (
    <section
      aria-label={t('terminal.title')}
      className="flex shrink-0 flex-col border-t border-line bg-panel"
      style={{ height }}
    >
      <div
        role="separator"
        aria-orientation="horizontal"
        className="h-1 shrink-0 cursor-row-resize bg-transparent hover:bg-accent/40"
        onPointerDown={onHandlePointerDown}
      />
      <header className="flex h-8 shrink-0 items-stretch border-b border-line">
        <div role="tablist" className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
          {terminal.sessions.map((session) => {
            const active = session.id === terminal.activeId
            return (
              <div
                key={session.id}
                role="tab"
                aria-selected={active}
                title={`${session.profileName} · ${session.cwd}`}
                className={`group flex max-w-48 shrink-0 cursor-default items-center gap-1.5 border-r border-line px-2 text-xs select-none ${
                  active ? 'bg-canvas text-ink' : 'text-muted hover:bg-ink/5 hover:text-ink'
                }`}
                onClick={() => terminal.activate(session.id)}
                onAuxClick={(event) => {
                  if (event.button === 1) terminal.closeSession(session.id)
                }}
              >
                {session.color !== null && (
                  <span
                    aria-hidden="true"
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: session.color }}
                  />
                )}
                <span className={`min-w-0 truncate ${session.running ? '' : 'opacity-60'}`}>
                  {session.icon !== null ? `${session.icon} ` : ''}
                  {sessionLabel(session)}
                </span>
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={t('tabs.close')}
                  className="shrink-0 rounded p-0.5 invisible hover:bg-ink/10 hover:text-ink group-hover:visible"
                  onClick={(event) => {
                    event.stopPropagation()
                    terminal.closeSession(session.id)
                  }}
                >
                  <XIcon className="size-3" />
                </button>
              </div>
            )
          })}
        </div>
        <div className="flex shrink-0 items-center gap-1 border-l border-line px-1.5">
          <button
            type="button"
            aria-label={t('terminal.new')}
            title={t('terminal.new')}
            disabled={terminal.targetDir === null}
            className="rounded p-1 text-muted hover:bg-ink/5 hover:text-ink disabled:opacity-40"
            onClick={() => {
              if (terminal.targetDir !== null) terminal.open(terminal.targetDir)
            }}
          >
            <PlusIcon className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label={t('terminal.more')}
            title={t('terminal.more')}
            className="rounded p-1 text-muted hover:bg-ink/5 hover:text-ink"
            onClick={(event) => setMenu({ x: event.clientX, y: event.clientY })}
          >
            <ChevronDownIcon className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label={t('dialogs.close')}
            title={t('dialogs.close')}
            className="rounded p-1 text-muted hover:bg-ink/5 hover:text-ink"
            onClick={() => terminal.setVisible(false)}
          >
            <XIcon className="size-3.5" />
          </button>
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
        {terminal.sessions.map((session) => {
          const active = session.id === terminal.activeId
          return (
            <div
              key={session.id}
              data-terminal-id={session.id}
              data-active={active ? 'true' : undefined}
              className={active ? 'absolute inset-0' : 'hidden'}
            >
              <TerminalView session={session} active={active} />
            </div>
          )
        })}
        {terminal.sessions.length === 0 && (
          <div className="flex h-full items-center justify-center gap-2 text-xs text-muted">
            <TerminalIcon className="size-4" />
            {t('terminal.empty')}
          </div>
        )}
      </div>

      {menu !== null && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />
      )}
    </section>
  )
}

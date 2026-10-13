import { useRef, type JSX, type PointerEvent as ReactPointerEvent } from 'react'
import type { SidebarPanel } from '../contexts/tree'
import { ActivityBar } from './ActivityBar'
import { EditorArea } from './EditorArea'
import { Sidebar } from './Sidebar'

export interface AppShellProps {
  sidebarCollapsed: boolean
  sidebarWidth: number
  onSelectPanel: (panel: SidebarPanel) => void
  onResizeSidebar: (width: number) => void
  onResizeCommit: (width: number) => void
}

const MIN_WIDTH = 220
const MAX_WIDTH = 560

export function AppShell({
  sidebarCollapsed,
  sidebarWidth,
  onSelectPanel,
  onResizeSidebar,
  onResizeCommit
}: AppShellProps): JSX.Element {
  const widthRef = useRef(sidebarWidth)
  widthRef.current = sidebarWidth

  const onHandlePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = widthRef.current
    const onMove = (moveEvent: PointerEvent): void => {
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + moveEvent.clientX - startX))
      onResizeSidebar(next)
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      onResizeCommit(widthRef.current)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <div className="flex min-h-0 flex-1">
      <ActivityBar collapsed={sidebarCollapsed} onSelect={onSelectPanel} />
      {!sidebarCollapsed && (
        <>
          <aside
            className="flex min-h-0 shrink-0 flex-col border-r border-line bg-panel"
            style={{ width: sidebarWidth }}
          >
            <Sidebar />
          </aside>
          <div
            role="separator"
            aria-orientation="vertical"
            className="w-1 shrink-0 cursor-col-resize bg-transparent hover:bg-accent/40"
            onPointerDown={onHandlePointerDown}
          />
        </>
      )}
      <main className="flex min-w-0 flex-1 flex-col">
        <EditorArea />
      </main>
    </div>
  )
}

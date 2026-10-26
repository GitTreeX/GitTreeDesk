import { useEffect, useRef, useState, type JSX } from 'react'

export interface ContextMenuItem {
  label: string
  /** Omitted for separator-only entries. */
  onSelect?: () => void
  disabled?: boolean
  /** Right-aligned accelerator hint, e.g. `F2`. */
  shortcut?: string
  /** Draws a divider above this item. */
  divider?: boolean
  /** Renders as a divider only, with no clickable item. */
  separator?: boolean
}

export function ContextMenu({
  x,
  y,
  items,
  onClose
}: {
  x: number
  y: number
  items: readonly ContextMenuItem[]
  onClose: () => void
}): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState({ x, y })

  useEffect(() => {
    const onPointerDown = (event: MouseEvent): void => {
      if (ref.current !== null && !ref.current.contains(event.target as Node)) onClose()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    const onBlur = (): void => onClose()
    window.addEventListener('mousedown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('mousedown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('blur', onBlur)
    }
  }, [onClose])

  useEffect(() => {
    const element = ref.current
    if (element === null) return
    const rect = element.getBoundingClientRect()
    const margin = 6
    setPosition({
      x: Math.min(x, window.innerWidth - rect.width - margin),
      y: Math.min(y, window.innerHeight - rect.height - margin)
    })
  }, [x, y])

  return (
    <div
      ref={ref}
      role="menu"
      className="fixed z-50 min-w-44 rounded-md border border-line bg-panel py-1 shadow-lg"
      style={{ left: position.x, top: position.y }}
    >
      {items.map((item, index) => (
        <div key={index}>
          {(item.divider === true || item.separator === true) && (
            <div className="my-1 border-t border-line" />
          )}
          {item.separator !== true && (
            <button
              role="menuitem"
              type="button"
              disabled={item.disabled === true}
              className="flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left text-sm text-ink hover:bg-ink/5 disabled:opacity-40"
              onClick={() => {
                onClose()
                item.onSelect?.()
              }}
            >
              <span className="min-w-0 truncate">{item.label}</span>
              {item.shortcut !== undefined && (
                <span className="shrink-0 text-xs text-muted">{item.shortcut}</span>
              )}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

import { useCallback, useRef, useState, type JSX, type PointerEvent as ReactPointerEvent } from 'react'

export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}

/** Commit shas are shown short wherever a label carries one. */
export function shortLabel(label: string): string {
  return /^[0-9a-f]{40}$/i.test(label) ? label.slice(0, 7) : label
}

export function ToolbarChip({
  active,
  label,
  onClick
}: {
  active: boolean
  label: string
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={`whitespace-nowrap rounded border px-1.5 py-0.5 text-xs ${
        active
          ? 'border-accent/60 bg-accent/15 text-ink'
          : 'border-line text-muted hover:bg-ink/5 hover:text-ink'
      }`}
      onClick={onClick}
    >
      {label}
    </button>
  )
}

export function SideLabel({
  label,
  exists,
  size,
  border = false,
  title
}: {
  label: string
  exists: boolean
  size: number
  border?: boolean
  title?: string
}): JSX.Element {
  return (
    <span
      className={`flex w-1/2 min-w-0 items-baseline gap-2 px-3 py-1 ${border ? 'border-l border-line' : ''}`}
      title={title}
    >
      <span className="shrink-0 font-mono text-xs text-ink">{shortLabel(label)}</span>
      <span className="min-w-0 truncate text-xs text-muted">
        {exists ? formatSize(size) : '(missing)'}
      </span>
    </span>
  )
}

function ImageSide({
  label,
  dataUrl,
  size,
  missing
}: {
  label: string
  dataUrl: string | null
  size: number
  missing: string
}): JSX.Element {
  return (
    <figure className="flex min-w-0 flex-1 flex-col items-center justify-center gap-2 overflow-auto p-4">
      <figcaption className="flex items-baseline gap-2 text-xs text-muted">
        <span className="font-mono text-ink">{shortLabel(label)}</span>
        <span>{formatSize(size)}</span>
      </figcaption>
      {dataUrl !== null ? (
        <img src={dataUrl} alt={label} className="max-h-[80%] max-w-full object-contain" />
      ) : (
        <span className="text-xs text-muted">{missing}</span>
      )}
    </figure>
  )
}

interface ImagePane {
  label: string
  dataUrl: string | null
  size: number
}

/**
 * Two images side by side, or overlaid so a draggable divider wipes between them.
 * The wipe needs both sides decodable, so the onion chip only appears when it can work.
 */
export function ImagePairView({
  left,
  right,
  missing,
  twoUpLabel,
  onionLabel,
  revealLabel
}: {
  left: ImagePane
  right: ImagePane
  missing: string
  twoUpLabel: string
  onionLabel: string
  revealLabel: string
}): JSX.Element {
  const [mode, setMode] = useState<'twoUp' | 'onion'>('twoUp')
  const [position, setPosition] = useState(50)
  const boxRef = useRef<HTMLDivElement | null>(null)
  const draggingRef = useRef(false)
  const leftUrl = left.dataUrl
  const rightUrl = right.dataUrl
  const overlayable = leftUrl !== null && rightUrl !== null

  const revealAt = useCallback((clientX: number): void => {
    const box = boxRef.current
    if (box === null) return
    const rect = box.getBoundingClientRect()
    if (rect.width === 0) return
    setPosition(Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100)))
  }, [])

  const drag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (draggingRef.current) revealAt(event.clientX)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-1">
        <ToolbarChip active={mode === 'twoUp'} label={twoUpLabel} onClick={() => setMode('twoUp')} />
        {overlayable && <ToolbarChip active={mode === 'onion'} label={onionLabel} onClick={() => setMode('onion')} />}
        <span className="min-w-0 flex-1" />
        {mode === 'onion' && overlayable ? (
          <>
            <span className="shrink-0 font-mono text-xs text-ink">{shortLabel(left.label)}</span>
            <span className="shrink-0 text-xs text-muted">→</span>
            <span className="shrink-0 font-mono text-xs text-ink">{shortLabel(right.label)}</span>
            <input
              aria-label={revealLabel}
              className="gtd-range w-32 shrink-0"
              max={100}
              min={0}
              type="range"
              value={Math.round(position)}
              onChange={(event) => setPosition(Number(event.currentTarget.value))}
            />
          </>
        ) : null}
      </div>

      {mode === 'onion' && overlayable ? (
        <div
          className="relative min-h-0 flex-1 cursor-ew-resize touch-none select-none overflow-hidden"
          ref={boxRef}
          onPointerCancel={() => {
            draggingRef.current = false
          }}
          onPointerDown={(event) => {
            draggingRef.current = true
            event.currentTarget.setPointerCapture(event.pointerId)
            revealAt(event.clientX)
          }}
          onPointerMove={drag}
          onPointerUp={() => {
            draggingRef.current = false
          }}
        >
          <img
            alt={right.label}
            className="absolute inset-0 h-full w-full object-contain"
            draggable={false}
            src={rightUrl}
          />
          <img
            alt={left.label}
            className="absolute inset-0 h-full w-full object-contain"
            draggable={false}
            src={leftUrl}
            style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
          />
          <div
            className="pointer-events-none absolute inset-y-0 w-px bg-accent"
            style={{ left: `${position}%` }}
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <ImageSide dataUrl={left.dataUrl} label={left.label} missing={missing} size={left.size} />
          <div className="w-px shrink-0 bg-line" />
          <ImageSide dataUrl={right.dataUrl} label={right.label} missing={missing} size={right.size} />
        </div>
      )}
    </div>
  )
}

export function EmptyPanel({
  message,
  action,
  action2
}: {
  message: string
  action?: { label: string; onClick: () => void }
  action2?: { label: string; onClick: () => void }
}): JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6">
      <p className="max-w-md text-center text-sm text-muted">{message}</p>
      <div className="flex items-center gap-2">
        {action !== undefined && (
          <button
            type="button"
            className="rounded bg-accent px-3 py-1 text-sm text-white hover:opacity-90"
            onClick={action.onClick}
          >
            {action.label}
          </button>
        )}
        {action2 !== undefined && (
          <button
            type="button"
            className="rounded border border-line px-3 py-1 text-sm text-ink hover:bg-ink/5"
            onClick={action2.onClick}
          >
            {action2.label}
          </button>
        )}
      </div>
    </div>
  )
}

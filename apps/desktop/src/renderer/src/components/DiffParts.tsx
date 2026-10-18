import type { JSX } from 'react'

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

export function ImageSide({
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

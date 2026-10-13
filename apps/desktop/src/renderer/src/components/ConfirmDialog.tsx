import { useEffect, useRef, type JSX } from 'react'
import { useTranslation } from 'react-i18next'

export interface ConfirmDialogProps {
  title: string
  body: string
  confirmLabel: string
  danger?: boolean
  onConfirm: () => void
  onClose: () => void
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger = false,
  onConfirm,
  onClose
}: ConfirmDialogProps): JSX.Element {
  const { t } = useTranslation()
  const confirmRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    confirmRef.current?.focus()
  }, [])

  return (
    <div className="fixed inset-0 z-40 flex justify-center bg-black/40 pt-32" onMouseDown={onClose}>
      <div
        role="alertdialog"
        aria-modal="true"
        className="h-fit w-full max-w-sm overflow-hidden rounded-lg border border-line bg-panel p-4 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose()
        }}
      >
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        <p className="mt-2 text-sm break-words text-muted">{body}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="rounded px-3 py-1 text-sm text-muted hover:bg-ink/5 hover:text-ink"
            onClick={onClose}
          >
            {t('dialogs.cancel')}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={`rounded px-3 py-1 text-sm text-white hover:opacity-90 ${
              danger ? 'bg-danger' : 'bg-accent'
            }`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

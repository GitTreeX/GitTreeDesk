import { useEffect, useSyncExternalStore, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import { dismissToast, subscribeToasts, toastsSnapshot, type Toast } from '../notify'
import { AlertTriangleIcon, XIcon } from './icons'

const INFO_TIMEOUT_MS = 6000

export function ToastHost(): JSX.Element | null {
  const toasts = useSyncExternalStore(subscribeToasts, toastsSnapshot)
  if (toasts.length === 0) return null
  return (
    <div className="pointer-events-none absolute right-3 bottom-8 z-40 flex w-80 flex-col gap-2">
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} />
      ))}
    </div>
  )
}

function ToastCard({ toast }: { toast: Toast }): JSX.Element {
  const { t } = useTranslation()
  const tone = toast.tone ?? 'info'

  useEffect(() => {
    if (tone !== 'info') return
    const timer = setTimeout(() => dismissToast(toast.id), INFO_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [toast.id, tone])

  const details = toast.details ?? toast.message

  return (
    <div
      role="status"
      className={`pointer-events-auto flex items-start gap-2 rounded-md border bg-panel px-3 py-2 shadow-lg ${
        tone === 'error' ? 'border-danger/50' : 'border-line'
      }`}
    >
      {tone === 'error' && <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-danger" />}
      <div className="min-w-0 flex-1">
        <p className="text-sm break-words text-ink">{toast.message}</p>
        <div className="mt-1 flex items-center gap-3 text-xs">
          {toast.action !== undefined && (
            <button
              type="button"
              className="text-accent hover:underline"
              onClick={() => {
                dismissToast(toast.id)
                toast.action?.run()
              }}
            >
              {toast.action.label}
            </button>
          )}
          <button
            type="button"
            className="text-muted hover:text-ink hover:underline"
            onClick={() => {
              void api
                .invoke('app:copyText', { text: details })
                .catch((error: unknown) => console.error('[notify] copy failed', error))
            }}
          >
            {t('notify.copyDetails')}
          </button>
        </div>
      </div>
      <button
        type="button"
        aria-label={t('notify.dismiss')}
        className="shrink-0 rounded p-0.5 text-muted hover:bg-ink/5 hover:text-ink"
        onClick={() => dismissToast(toast.id)}
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  )
}

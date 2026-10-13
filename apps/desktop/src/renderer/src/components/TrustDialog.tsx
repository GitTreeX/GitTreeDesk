import { useEffect, useRef, type JSX } from 'react'
import { useTranslation } from 'react-i18next'

export function TrustDialog({
  root,
  onDecide
}: {
  root: string
  onDecide: (trusted: boolean) => void
}): JSX.Element {
  const { t } = useTranslation()
  const acceptRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    acceptRef.current?.focus()
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="trust-title"
        className="w-full max-w-md rounded-lg border border-line bg-panel p-5 shadow-xl"
      >
        <h2 id="trust-title" className="text-base font-semibold text-ink">
          {t('trust.title')}
        </h2>
        <p className="mt-2 text-sm text-muted">{t('trust.body')}</p>
        <p className="mt-2 truncate rounded border border-line bg-canvas px-2 py-1 font-mono text-xs text-muted" title={root}>
          {root}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-md border border-line px-3 py-1.5 text-sm text-ink hover:bg-ink/5"
            onClick={() => onDecide(false)}
          >
            {t('trust.decline')}
          </button>
          <button
            ref={acceptRef}
            type="button"
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
            onClick={() => onDecide(true)}
          >
            {t('trust.accept')}
          </button>
        </div>
      </div>
    </div>
  )
}

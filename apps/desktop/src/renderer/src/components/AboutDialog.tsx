import { useEffect, useRef, useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppInfo } from '@gitreedesk/shared'
import { api } from '../api'
import iconUrl from '../../../../../../brand/svg/gitreedesk-icon.svg'

const HOMEPAGE = 'https://github.com/GitTreeX/GitTreeDesk'
const DOWNLOADS = `${HOMEPAGE}/releases`

export function AboutDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const { t } = useTranslation()
  const [info, setInfo] = useState<AppInfo | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  useEffect(() => {
    let live = true
    void api.invoke('app:info').then(
      (value) => {
        if (live) setInfo(value)
      },
      (error: unknown) => {
        console.error('[about] loading app info failed', error)
      }
    )
    return () => {
      live = false
    }
  }, [])

  const rows: { label: string; value: string }[] = [
    { label: t('about.electron'), value: info?.versions.electron ?? '' },
    { label: t('about.chromium'), value: info?.versions.chrome ?? '' },
    { label: t('about.node'), value: info?.versions.node ?? '' },
    {
      label: t('about.git'),
      value:
        info === null
          ? ''
          : info.gitVersion === null
            ? t('statusbar.gitMissing')
            : info.gitVersion.raw.replace(/^git version /, '')
    }
  ]

  return (
    <div className="fixed inset-0 z-40 flex justify-center bg-black/40 pt-32" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('about.title')}
        className="h-fit w-full max-w-sm overflow-hidden rounded-lg border border-line bg-panel p-4 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose()
        }}
      >
        <div className="flex items-center gap-3">
          <img src={iconUrl} alt="" className="size-12 shrink-0 rounded-lg" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-ink">GitTreeDesk</h2>
            <p className="text-xs text-muted">
              {info === null ? '\u00a0' : t('about.version', { version: info.version })}
            </p>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted">{t('welcome.tagline')}</p>

        <dl className="mt-4 space-y-1 border-t border-line pt-3">
          {rows.map((row) => (
            <div key={row.label} className="flex items-baseline justify-between gap-3 text-xs">
              <dt className="shrink-0 text-muted">{row.label}</dt>
              <dd className="truncate font-mono text-ink">{row.value === '' ? '—' : row.value}</dd>
            </div>
          ))}
        </dl>

        <p className="mt-4 border-t border-line pt-3 text-xs text-muted">
          {t('about.license')} · {t('about.copyright')}
        </p>

        <div className="mt-4 flex items-center justify-between gap-2">
          <div className="flex min-w-0 gap-3">
            <a
              href={HOMEPAGE}
              target="_blank"
              rel="noreferrer"
              className="truncate text-xs text-accent hover:underline"
            >
              {t('about.homepage')}
            </a>
            <a
              href={DOWNLOADS}
              target="_blank"
              rel="noreferrer"
              className="truncate text-xs text-accent hover:underline"
            >
              {t('about.download')}
            </a>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="rounded bg-accent px-3 py-1 text-sm text-white hover:opacity-90"
            onClick={onClose}
          >
            {t('dialogs.close')}
          </button>
        </div>
      </div>
    </div>
  )
}

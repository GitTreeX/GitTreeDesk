import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { useUpdate } from '../contexts/update'
import { ArrowUpCircleIcon, XIcon } from './icons'

export function UpdateNotice(): JSX.Element | null {
  const { t } = useTranslation()
  const update = useUpdate()
  const version = update.snapshot?.version ?? null

  if (!update.noticeVisible || update.snapshot?.status !== 'available' || version === null) {
    return null
  }

  return (
    <div
      role="status"
      className="fixed right-3 bottom-8 z-30 flex w-80 items-start gap-2 rounded-md border border-line bg-panel px-3 py-2 shadow-lg"
    >
      <ArrowUpCircleIcon className="mt-0.5 size-4 shrink-0 text-accent" />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-ink">{t('update.noticeTitle', { version })}</p>
        <p className="mt-0.5 text-xs text-muted">{t('update.noticeBody')}</p>
        <div className="mt-2 flex justify-end gap-3 text-xs">
          <button type="button" className="text-muted hover:text-ink hover:underline" onClick={update.dismissNotice}>
            {t('update.later')}
          </button>
          <button type="button" className="text-accent hover:underline" onClick={update.startUpdate}>
            {t('update.update')}
          </button>
        </div>
      </div>
      <button
        type="button"
        className="rounded p-0.5 text-muted hover:bg-ink/5 hover:text-ink"
        title={t('update.close')}
        aria-label={t('update.close')}
        onClick={update.dismissNotice}
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  )
}

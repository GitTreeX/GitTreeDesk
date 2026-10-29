import { useEffect, useMemo, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { useUpdate } from '../contexts/update'

interface NoteLine {
  kind: 'heading' | 'item' | 'text'
  text: string
}

function cleanLine(value: string): string {
  return value
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .trim()
}

function parseNotes(raw: string | null): NoteLine[] {
  if (raw === null) return []
  return raw
    .split(/\r?\n/)
    .map((line): NoteLine | null => {
      const trimmed = line.trim()
      if (trimmed.length === 0) return null
      if (trimmed.startsWith('### ')) return { kind: 'heading', text: cleanLine(trimmed.slice(4)) }
      if (trimmed.startsWith('## ')) return { kind: 'heading', text: cleanLine(trimmed.slice(3)) }
      if (trimmed.startsWith('# ')) return { kind: 'heading', text: cleanLine(trimmed.slice(2)) }
      if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        return { kind: 'item', text: cleanLine(trimmed.slice(2)) }
      }
      return { kind: 'text', text: cleanLine(trimmed) }
    })
    .filter((line): line is NoteLine => line !== null)
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let size = value
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${size >= 10 || unit === 0 ? Math.round(size) : size.toFixed(1)} ${units[unit]}`
}

const SECONDARY_BUTTON =
  'rounded border border-line px-3 py-1 text-sm text-ink hover:bg-ink/5'
const PRIMARY_BUTTON = 'rounded bg-accent px-3 py-1 text-sm text-white hover:opacity-90'
const LINK_BUTTON = 'text-xs text-accent hover:underline'

export function UpdateDialog(): JSX.Element | null {
  const { t } = useTranslation()
  const update = useUpdate()
  const snapshot = update.snapshot
  const status = snapshot?.status ?? 'idle'
  const currentVersion = snapshot?.currentVersion ?? ''
  const latestVersion = snapshot?.version ?? null
  const showVersions = latestVersion !== null || status === 'not-available'
  const percent = Math.round((snapshot?.progress ?? 0) * 100)
  const busy = status === 'checking' || status === 'downloading'
  const notes = useMemo(() => parseNotes(snapshot?.releaseNotes ?? null), [snapshot?.releaseNotes])

  useEffect(() => {
    if (!update.dialogOpen) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') update.closeDialog()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [update.dialogOpen, update.closeDialog])

  if (!update.dialogOpen) return null

  const transferred = snapshot?.transferred ?? null
  const total = snapshot?.total ?? null
  const bytesPerSecond = snapshot?.bytesPerSecond ?? null
  const error = snapshot?.error ?? null
  const transfer =
    transferred !== null && total !== null
      ? `${formatBytes(transferred)} / ${formatBytes(total)}${
          bytesPerSecond === null ? '' : ` · ${formatBytes(bytesPerSecond)}/s`
        }`
      : ''

  const message =
    status === 'checking'
      ? t('update.checking')
      : status === 'not-available'
        ? t('update.upToDate')
        : status === 'available'
          ? t('update.available')
          : status === 'downloading'
            ? t('update.downloading')
            : status === 'downloaded'
              ? t('update.downloaded')
              : status === 'error'
                ? latestVersion === null
                  ? t('update.checkFailed')
                  : t('update.downloadFailed')
                : status === 'unsupported'
                  ? snapshot?.reason === 'development'
                    ? t('update.development')
                    : t('update.unsupported')
                  : t('update.checking')

  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-black/40 pt-32" onMouseDown={update.closeDialog}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('update.title')}
        className="h-fit w-full max-w-md overflow-hidden rounded-lg border border-line bg-panel p-4 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-sm font-semibold text-ink">{t('update.title')}</h2>
          <button type="button" className={LINK_BUTTON} onClick={update.openReleases}>
            {t('update.openReleases')}
          </button>
        </div>

        {showVersions && (
          <div className="mt-3 flex gap-6 border-t border-line pt-3 text-xs">
            <div>
              <div className="text-muted">{t('update.currentVersion')}</div>
              <div className="mt-0.5 font-mono text-ink">{currentVersion || '—'}</div>
            </div>
            {latestVersion !== null && (
              <div>
                <div className="text-muted">{t('update.latestVersion')}</div>
                <div className="mt-0.5 font-mono text-ink">{latestVersion}</div>
              </div>
            )}
          </div>
        )}

        <div
          className={`mt-3 flex items-center gap-2 text-sm ${
            status === 'error' ? 'text-danger' : 'text-ink'
          }`}
          aria-live="polite"
        >
          {busy && (
            <span className="size-4 shrink-0 animate-spin rounded-full border-2 border-line border-t-accent" />
          )}
          <p>{message}</p>
        </div>

        {status === 'error' && error !== null && (
          <p className="mt-2 max-h-28 overflow-auto rounded border border-line bg-canvas px-2 py-1.5 font-mono text-xs break-words whitespace-pre-wrap text-muted">
            {error}
          </p>
        )}

        {status === 'downloading' && (
          <div className="mt-3">
            <div className="h-1.5 overflow-hidden rounded-full bg-ink/10">
              <div
                className="h-full rounded-full bg-accent transition-[width]"
                style={{ width: `${percent}%` }}
              />
            </div>
            <div className="mt-1 flex justify-between text-xs text-muted">
              <span>{percent}%</span>
              {transfer !== '' && <span>{transfer}</span>}
            </div>
          </div>
        )}

        {latestVersion !== null && notes.length > 0 && (
          <section className="mt-3 border-t border-line pt-3">
            <h3 className="text-xs font-semibold text-ink">{t('update.releaseNotes')}</h3>
            <div className="mt-1.5 max-h-52 space-y-1 overflow-auto text-xs text-muted">
              {notes.map((line, index) => (
                <p
                  key={index}
                  className={
                    line.kind === 'heading'
                      ? 'pt-1 font-semibold text-ink'
                      : line.kind === 'item'
                        ? 'pl-3 before:mr-1 before:content-["·"]'
                        : ''
                  }
                >
                  {line.text}
                </p>
              ))}
            </div>
          </section>
        )}

        {latestVersion !== null && notes.length === 0 && status === 'available' && (
          <p className="mt-3 border-t border-line pt-3 text-xs text-muted">
            {t('update.noReleaseNotes')}
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2 border-t border-line pt-3">
          {status === 'available' && (
            <>
              <button type="button" className={SECONDARY_BUTTON} onClick={update.closeDialog}>
                {t('update.later')}
              </button>
              <button type="button" className={PRIMARY_BUTTON} onClick={update.download}>
                {t('update.download')}
              </button>
            </>
          )}
          {status === 'downloaded' && (
            <>
              <button type="button" className={SECONDARY_BUTTON} onClick={update.closeDialog}>
                {t('update.later')}
              </button>
              <button type="button" className={PRIMARY_BUTTON} onClick={update.install}>
                {t('update.restart')}
              </button>
            </>
          )}
          {status === 'error' && (
            <>
              <button type="button" className={SECONDARY_BUTTON} onClick={update.closeDialog}>
                {t('update.close')}
              </button>
              <button
                type="button"
                className={PRIMARY_BUTTON}
                onClick={latestVersion === null ? update.check : update.download}
              >
                {t('update.retry')}
              </button>
            </>
          )}
          {(status === 'idle' ||
            status === 'checking' ||
            status === 'downloading' ||
            status === 'not-available' ||
            status === 'unsupported') && (
            <button type="button" className={SECONDARY_BUTTON} onClick={update.closeDialog}>
              {t('update.close')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

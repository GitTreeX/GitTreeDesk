import { useCallback, useEffect, useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { BackupEntry, RepoRecord } from '@gitreedesk/shared'
import { api } from '../api'
import { useSettings } from '../contexts/settings'
import { errorText } from '../lib/reporting'
import { relativeTime } from '../lib/relative-time'
import { notify } from '../notify'
import { ConfirmDialog } from './ConfirmDialog'
import { RestoreIcon, XIcon } from './icons'

/** Lists the safety backups taken before destructive operations and restores one. */
export function BackupsDialog({
  record,
  onClose
}: {
  record: RepoRecord
  onClose: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const settings = useSettings()
  const [entries, setEntries] = useState<readonly BackupEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [restoreAsk, setRestoreAsk] = useState<BackupEntry | null>(null)

  const load = useCallback(async (): Promise<void> => {
    try {
      const { entries: loaded } = await api.invoke('git:backups', { gitDir: record.gitDir })
      setEntries(loaded)
    } catch (failure) {
      setError(errorText(failure, t))
    }
  }, [record.gitDir, t])

  useEffect(() => {
    void load()
  }, [load])

  const opLabel = (op: string): string => {
    const translated = t(`backup.ops.${op}`)
    return translated === `backup.ops.${op}` ? op : translated
  }

  const restore = useCallback(
    (entry: BackupEntry): void => {
      setRestoreAsk(null)
      void (async () => {
        setBusy(entry.ref)
        setError(null)
        try {
          await api.invoke('git:restoreBackup', { gitDir: record.gitDir, ref: entry.ref })
          notify({ message: t('backup.restored', { op: opLabel(entry.op) }) })
          await load()
        } catch (failure) {
          setError(errorText(failure, t))
        } finally {
          setBusy(null)
        }
      })()
    },
    [load, record.gitDir, t]
  )

  return (
    <div
      className="fixed inset-0 z-40 flex justify-center bg-black/40 pt-16"
      onMouseDown={() => {
        if (restoreAsk === null) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('backup.title', { name: record.name })}
        className="h-fit w-full max-w-xl overflow-hidden rounded-lg border border-line bg-panel shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && restoreAsk === null) onClose()
        }}
      >
        <header className="flex items-center gap-2 border-b border-line px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
            {t('backup.title', { name: record.name })}
          </span>
          <button
            type="button"
            aria-label={t('dialogs.close')}
            className="shrink-0 rounded p-0.5 text-muted hover:bg-ink/5 hover:text-ink"
            onClick={onClose}
          >
            <XIcon className="size-3.5" />
          </button>
        </header>

        <div className="max-h-96 overflow-y-auto py-1">
          {entries !== null && entries.length === 0 && (
            <p className="px-3 py-4 text-center text-sm text-muted">{t('backup.empty')}</p>
          )}
          {entries?.map((entry) => (
            <div key={entry.ref} className="group flex h-8 items-center gap-2 px-3 hover:bg-ink/5">
              <span className="shrink-0 rounded bg-ink/5 px-1 text-[10px] text-muted">
                {opLabel(entry.op)}
              </span>
              {entry.target !== null && (
                <span className="min-w-0 truncate text-xs text-muted">
                  {t('backup.targetLabel', { target: entry.target })}
                </span>
              )}
              <span className="min-w-0 flex-1" />
              <span className="shrink-0 font-mono text-xs text-muted">{entry.sha.slice(0, 7)}</span>
              <span className="shrink-0 text-xs text-muted">
                {relativeTime(entry.createdAt, settings.locale)}
              </span>
              <button
                type="button"
                title={t('backup.restore')}
                aria-label={t('backup.restore')}
                className="hidden shrink-0 rounded p-0.5 text-muted hover:bg-ink/10 hover:text-ink group-hover:block group-focus-within:block"
                disabled={busy === entry.ref}
                onClick={() => setRestoreAsk(entry)}
              >
                <RestoreIcon className="size-3.5" />
              </button>
            </div>
          ))}
        </div>

        {error !== null && (
          <p className="border-t border-line px-3 py-1.5 text-xs break-words text-danger">{error}</p>
        )}
      </div>

      {restoreAsk !== null && (
        <ConfirmDialog
          title={t('backup.confirmTitle')}
          body={t('backup.confirmBody', {
            op: opLabel(restoreAsk.op),
            time: relativeTime(restoreAsk.createdAt, settings.locale)
          })}
          confirmLabel={t('backup.restore')}
          danger
          onConfirm={() => restore(restoreAsk)}
          onClose={() => setRestoreAsk(null)}
        />
      )}
    </div>
  )
}

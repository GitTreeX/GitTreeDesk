import { useEffect, useRef, useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'

export interface PushDialogProps {
  branch: string
  remotes: readonly string[]
  /** Preselected remote; the first entry is used when it is missing. */
  defaultRemote: string | null
  /** The branch has no upstream yet, so publishing is offered. */
  publish: boolean
  onConfirm: (selection: { remotes: string[]; publish: boolean }) => void
  onClose: () => void
}

export function PushDialog({
  branch,
  remotes,
  defaultRemote,
  publish,
  onConfirm,
  onClose
}: PushDialogProps): JSX.Element {
  const { t } = useTranslation()
  const confirmRef = useRef<HTMLButtonElement | null>(null)
  const preselected = defaultRemote !== null && remotes.includes(defaultRemote) ? defaultRemote : remotes[0]
  const [selected, setSelected] = useState<readonly string[]>(
    preselected === undefined ? [] : [preselected]
  )
  const [publishUpstream, setPublishUpstream] = useState(publish)

  useEffect(() => {
    confirmRef.current?.focus()
  }, [])

  const toggle = (name: string): void => {
    setSelected((current) =>
      current.includes(name) ? current.filter((entry) => entry !== name) : [...current, name]
    )
  }

  const upstreamTarget = remotes.find((remote) => selected.includes(remote)) ?? ''

  return (
    <div className="fixed inset-0 z-40 flex justify-center bg-black/40 pt-32" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('sync.pushTitle')}
        className="h-fit w-full max-w-sm overflow-hidden rounded-lg border border-line bg-panel p-4 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose()
        }}
      >
        <h2 className="text-sm font-semibold text-ink">{t('sync.pushTitle')}</h2>
        <p className="mt-1 font-mono text-xs text-muted">{branch}</p>
        <p className="mt-3 text-xs font-semibold tracking-wide text-muted uppercase">
          {t('sync.pushRemotes')}
        </p>
        <div className="mt-1.5 flex flex-col gap-1">
          {remotes.map((remote) => (
            <label key={remote} className="flex items-center gap-2 rounded px-1 py-0.5 text-xs text-ink">
              <input
                type="checkbox"
                checked={selected.includes(remote)}
                className="accent-accent"
                onChange={() => toggle(remote)}
              />
              <span className="font-mono">{remote}</span>
            </label>
          ))}
        </div>
        {publish && upstreamTarget !== '' && (
          <>
            <label className="mt-3 flex items-center gap-2 text-xs text-ink">
              <input
                type="checkbox"
                checked={publishUpstream}
                className="accent-accent"
                onChange={() => setPublishUpstream((current) => !current)}
              />
              {t('sync.publishToggle')}
            </label>
            {publishUpstream && (
              <p className="mt-1 text-xs text-muted">
                {t('sync.publishHint', { branch, remote: upstreamTarget })}
              </p>
            )}
          </>
        )}
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
            disabled={selected.length === 0}
            className="rounded bg-accent px-3 py-1 text-sm text-white hover:opacity-90 disabled:opacity-60"
            onClick={() =>
              onConfirm({
                remotes: remotes.filter((remote) => selected.includes(remote)),
                publish: publishUpstream
              })
            }
          >
            {t('sync.pushAction')}
          </button>
        </div>
      </div>
    </div>
  )
}

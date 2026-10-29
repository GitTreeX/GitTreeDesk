import { useCallback, useEffect, useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { RecentWorkspace } from '@gitreedesk/shared'
import { api } from '../api'
import { useWorkspace } from '../contexts/workspace'
import { ContextMenu } from './ContextMenu'
import { FolderOpenIcon, XIcon } from './icons'

function formatLastOpened(timestamp: number | null, locale: string): string {
  if (timestamp === null) return ''
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(timestamp))
  } catch {
    return new Date(timestamp).toLocaleDateString()
  }
}

export function WelcomeView(): JSX.Element {
  const { t, i18n } = useTranslation()
  const workspace = useWorkspace()
  const [recents, setRecents] = useState<RecentWorkspace[] | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; root: string } | null>(null)

  const reloadRecents = useCallback(async () => {
    try {
      const { workspaces } = await api.invoke('workspace:recent')
      setRecents(workspaces)
    } catch {
      setRecents([])
    }
  }, [])

  useEffect(() => {
    void reloadRecents()
  }, [reloadRecents])

  const pickAndOpen = useCallback(async () => {
    try {
      const { path } = await api.invoke('workspace:pick')
      if (path !== null) await workspace.open(path)
    } catch (error) {
      console.error('[welcome] open folder failed', error)
    }
  }, [workspace])

  const removeRecent = useCallback(
    async (root: string) => {
      try {
        await api.invoke('workspace:removeRecent', { root })
      } catch (error) {
        console.error('[welcome] removing a recent workspace failed', error)
      }
      await reloadRecents()
    },
    [reloadRecents]
  )

  // A missing folder stays in the list only until the next attempt: the service
  // drops it from the store, so re-read the list whether or not the open worked.
  const openRecent = useCallback(
    async (root: string) => {
      await workspace.open(root)
      await reloadRecents()
    },
    [workspace.open, reloadRecents]
  )

  const busy = workspace.opening

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-canvas px-6 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">GitTreeDesk</h1>
          <p className="mt-1 text-sm text-muted">{t('welcome.tagline')}</p>
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={() => void pickAndOpen()}
          className="flex w-full items-center justify-center gap-2 rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
        >
          <FolderOpenIcon className="size-4" />
          {busy ? t('welcome.opening') : t('welcome.openFolder')}
        </button>
        <p className="mt-2 text-center text-xs text-muted">{t('welcome.dropHint')}</p>

        <div className="mt-8">
          <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">
            {t('welcome.recents')}
          </h2>
          {recents === null ? null : recents.length === 0 ? (
            <p className="rounded-md border border-line bg-panel px-3 py-4 text-sm text-muted">
              {t('welcome.noRecents')}
            </p>
          ) : (
            <ul className="overflow-hidden rounded-md border border-line bg-panel">
              {recents.map((entry) => (
                <li
                  key={entry.root}
                  className="group/recent relative border-b border-line last:border-b-0"
                >
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void openRecent(entry.root)}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      setMenu({ x: event.clientX, y: event.clientY, root: entry.root })
                    }}
                    className="block w-full px-3 py-2 pr-10 text-left hover:bg-ink/5 disabled:opacity-60"
                  >
                    <span className="block truncate text-sm text-ink">
                      {entry.name ?? entry.root.split('/').pop()}
                    </span>
                    <span className="mt-0.5 flex items-baseline justify-between gap-3">
                      <span className="truncate font-mono text-xs text-muted" title={entry.root}>
                        {entry.root}
                      </span>
                      <span className="shrink-0 text-xs text-muted">
                        {formatLastOpened(entry.lastOpenedAt, i18n.language)}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    title={t('welcome.removeFromList')}
                    aria-label={t('welcome.removeFromList')}
                    onClick={() => void removeRecent(entry.root)}
                    className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-1 text-muted opacity-50 transition-opacity group-hover/recent:opacity-100 hover:bg-ink/10 hover:text-ink focus-visible:opacity-100 disabled:opacity-30"
                  >
                    <XIcon className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {menu !== null && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={[{ label: t('welcome.removeFromList'), onSelect: () => void removeRecent(menu.root) }]}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}

import { useEffect, useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { useWorkspace } from '../contexts/workspace'
import { AlertTriangleIcon, XIcon } from './icons'

function Stat({ label, value }: { label: string; value: number }): JSX.Element {
  return (
    <div className="rounded-md border border-line bg-panel px-3 py-2.5">
      <div className="text-lg font-semibold text-ink">{value}</div>
      <div className="mt-0.5 text-xs text-muted">{label}</div>
    </div>
  )
}

export function WorkspaceOverview(): JSX.Element {
  const { t } = useTranslation()
  const { descriptor, degraded, rescan, setTrusted, refreshing } = useWorkspace()
  const budgetExceeded = descriptor?.stats.budgetExceeded ?? false
  const [budgetDismissed, setBudgetDismissed] = useState(false)

  useEffect(() => {
    if (!budgetExceeded) setBudgetDismissed(false)
  }, [budgetExceeded])

  if (descriptor === null) return <div className="min-h-0 flex-1" />

  const repositories = descriptor.records.filter((record) => record.kind !== 'worktree').length
  const worktrees = descriptor.records.length - repositories
  const submodules = descriptor.records.filter((record) => record.hasSubmodules).length

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-canvas px-6 py-5">
      <h1 className="text-lg font-semibold text-ink">{t('overview.title')}</h1>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="shrink-0 text-xs text-muted">{t('overview.folder')}</span>
        <span className="truncate font-mono text-xs text-muted" title={descriptor.root}>
          {descriptor.root}
        </span>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={t('overview.repositories')} value={repositories} />
        <Stat label={t('overview.worktrees')} value={worktrees} />
        <Stat label={t('overview.submodules')} value={submodules} />
        <Stat label={t('overview.foldersScanned')} value={descriptor.stats.dirsScanned} />
      </div>

      <div className="mt-5 flex flex-col gap-2">
        {!descriptor.trusted && (
          <Notice
            action={{
              label: t('notices.trust'),
              onClick: () => void setTrusted(true)
            }}
          >
            {t('notices.untrusted')}
          </Notice>
        )}

        {descriptor.stats.budgetExceeded && !budgetDismissed && (
          <Notice
            action={{
              label: t('notices.raise'),
              busy: refreshing,
              onClick: () => void rescan({ raiseBudget: true })
            }}
            onDismiss={() => setBudgetDismissed(true)}
          >
            {t('notices.budget')}
          </Notice>
        )}

        {descriptor.stats.maxDepthReached && <Notice>{t('notices.depth')}</Notice>}

        {degraded.map((entry) => (
          <Notice key={`${entry.kind}\u0000${entry.dir}`}>
            {t('notices.degraded', { dir: entry.dir })}
          </Notice>
        ))}

        {descriptor.issues.length > 0 && (
          <section className="rounded-md border border-line bg-panel px-3 py-2.5">
            <h2 className="text-xs font-semibold tracking-wide text-muted uppercase">
              {t('notices.issues')}
            </h2>
            <ul className="mt-1.5 space-y-0.5">
              {descriptor.issues.map((issue, index) => (
                <li key={index} className="truncate font-mono text-xs text-muted" title={issue}>
                  {issue}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}

function Notice({
  children,
  action,
  onDismiss
}: {
  children: string
  action?: { label: string; busy?: boolean; onClick: () => void }
  onDismiss?: () => void
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-warn/40 bg-warn/10 px-3 py-2.5">
      <span className="flex items-start gap-2 text-sm text-ink">
        <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-warn" />
        {children}
      </span>
      {(action !== undefined || onDismiss !== undefined) && (
        <div className="flex shrink-0 items-center gap-1.5">
          {action !== undefined && (
            <button
              type="button"
              disabled={action.busy === true}
              onClick={action.onClick}
              className="shrink-0 rounded border border-line bg-panel px-2 py-1 text-xs text-ink hover:bg-ink/5 disabled:opacity-60"
            >
              {action.label}
            </button>
          )}
          {onDismiss !== undefined && (
            <button
              type="button"
              aria-label={t('dialogs.close')}
              onClick={onDismiss}
              className="rounded p-0.5 text-muted hover:bg-ink/5 hover:text-ink"
            >
              <XIcon className="size-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

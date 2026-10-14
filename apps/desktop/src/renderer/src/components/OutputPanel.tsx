import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { useOperations } from '../contexts/operations-context'
import type { OutputLine } from '../contexts/operations-context'
import { AlertTriangleIcon, XIcon } from './icons'

const STATE_TEXT: Record<OutputLine['state'], string> = {
  running: 'output.running',
  updated: 'sync.updated',
  uptodate: 'sync.upToDate',
  failed: 'output.failed'
}

const STATE_CLASS: Record<OutputLine['state'], string> = {
  running: 'text-muted animate-pulse',
  updated: 'text-success',
  uptodate: 'text-muted',
  failed: 'text-danger'
}

export function OutputPanel(): JSX.Element | null {
  const { t } = useTranslation()
  const operations = useOperations()

  if (!operations.outputOpen) return null

  return (
    <section
      aria-label={t('output.title')}
      className="flex h-44 shrink-0 flex-col border-t border-line bg-panel"
    >
      <header className="flex h-8 shrink-0 items-center gap-2 border-b border-line px-2">
        <span className="text-xs font-semibold tracking-wide text-muted uppercase">
          {t('output.title')}
        </span>
        {operations.output.some((entry) => !entry.done) && (
          <span className="animate-pulse text-xs text-muted">…</span>
        )}
        <span className="min-w-0 flex-1" />
        <button
          type="button"
          className="rounded px-1.5 py-0.5 text-xs text-muted hover:bg-ink/5 hover:text-ink"
          onClick={operations.clearOutput}
        >
          {t('output.clear')}
        </button>
        <button
          type="button"
          aria-label={t('dialogs.close')}
          className="rounded p-0.5 text-muted hover:bg-ink/5 hover:text-ink"
          onClick={() => operations.setOutputOpen(false)}
        >
          <XIcon className="size-3.5" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {operations.output.length === 0 && (
          <p className="px-3 py-2 text-xs text-muted">{t('output.empty')}</p>
        )}
        {operations.output.map((entry) => (
          <div key={entry.id} className="border-b border-line/60">
            <p className="px-3 pt-1.5 pb-0.5 text-xs font-semibold text-ink">{entry.title}</p>
            {entry.lines.map((line) => (
              <div key={line.key} className="px-5 py-0.5">
                <div className="flex items-baseline gap-2 text-xs">
                  <span className="min-w-0 max-w-[40%] shrink-0 truncate font-mono text-ink">
                    {line.name}
                  </span>
                  <span className={`shrink-0 ${STATE_CLASS[line.state]}`}>
                    {line.error ?? t(STATE_TEXT[line.state])}
                  </span>
                </div>
                {line.stash?.stashConflict === true && (
                  <p className="flex items-center gap-1 text-xs text-warn">
                    <AlertTriangleIcon className="size-3 shrink-0" />
                    {t('sync.stashConflict')}
                  </p>
                )}
                {line.output.length > 0 && (
                  <details>
                    <summary className="cursor-pointer text-xs text-muted hover:text-ink">
                      {t('output.showOutput')}
                    </summary>
                    <pre className="mt-0.5 max-h-40 overflow-auto px-2 py-1 font-mono text-[11px] whitespace-pre-wrap text-muted">
                      {line.output}
                    </pre>
                  </details>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  )
}

import { useEffect, useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { PerfStats } from '@gitreedesk/shared'
import { api } from '../api'

const POLL_MS = 1000

function formatMs(ms: number): string {
  return ms < 1000 ? `${String(Math.round(ms))} ms` : `${(ms / 1000).toFixed(2)} s`
}

function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-muted">{label}</span>
      <span className="font-mono text-ink">{value}</span>
    </div>
  )
}

export function PerfOverlay(): JSX.Element {
  const { t } = useTranslation()
  const [stats, setStats] = useState<PerfStats | null>(null)

  useEffect(() => {
    let disposed = false
    const tick = async (): Promise<void> => {
      try {
        const next = await api.invoke('app:perfStats')
        if (!disposed) setStats(next)
      } catch {
        // diagnostics-only surface; a failed poll just keeps the previous snapshot
      }
    }
    void tick()
    const timer = setInterval(() => void tick(), POLL_MS)
    return () => {
      disposed = true
      clearInterval(timer)
    }
  }, [])

  const scan = stats?.scan ?? null
  const status = stats?.status ?? null
  const warm = stats?.warm ?? null
  const watchers = stats?.watchers ?? null
  const ops = [...(stats?.ops ?? [])].reverse()

  return (
    <section
      aria-label={t('perf.title')}
      className="pointer-events-none fixed right-3 bottom-8 z-40 w-72 rounded-md border border-line bg-panel/95 p-3 text-xs shadow-lg backdrop-blur"
    >
      <h2 className="mb-2 font-semibold text-ink">{t('perf.title')}</h2>
      <div className="flex flex-col gap-1">
        <Row
          label={t('perf.scan')}
          value={
            scan !== null && scan.lastMs !== null
              ? t('perf.scanValue', { ms: Math.round(scan.lastMs), repos: scan.lastRepos })
              : '—'
          }
        />
        <Row
          label={t('perf.status')}
          value={
            status !== null && status.p50 !== null && status.p95 !== null
              ? t('perf.statusValue', { p50: status.p50, p95: status.p95, samples: status.samples })
              : '—'
          }
        />
        {status !== null && status.lastMs !== null && (
          <div className="text-right font-mono text-muted">{t('perf.statusLast', { ms: Math.round(status.lastMs) })}</div>
        )}
        {status !== null && status.skips.count > 0 && (
          <div className="text-right font-mono text-muted">
            {t('perf.skips', { count: status.skips.count, avg: status.skips.avgMs ?? 0 })}
          </div>
        )}
        <Row
          label={t('perf.warm')}
          value={warm !== null ? formatMs(warm.ms) : t('perf.warmPending')}
        />
        <Row
          label={t('perf.watchers')}
          value={
            watchers !== null
              ? t('perf.watchersValue', {
                  scopes: watchers.scopes,
                  subscribed: watchers.subscribed,
                  degraded: watchers.degraded
                })
              : '—'
          }
        />
      </div>
      <h3 className="mt-3 mb-1 font-semibold text-ink">{t('perf.ops')}</h3>
      {ops.length === 0 ? (
        <p className="text-muted">{t('perf.opsEmpty')}</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {ops.slice(0, 8).map((op, index) => (
            <li key={`${op.channel}-${String(op.at)}-${String(index)}`} className="flex items-baseline justify-between gap-4 font-mono">
              <span className="truncate text-muted" title={op.channel}>
                {op.channel}
              </span>
              <span className={op.ok ? 'text-ink' : 'text-danger'}>
                {formatMs(op.ms)}
                {op.ok ? '' : ` · ${t('perf.opFailed')}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

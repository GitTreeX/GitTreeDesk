import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useTranslation } from 'react-i18next'
import {
  GRAPH_DENSITY_VALUES,
  type GitActivityEntry,
  type GraphDensityValue,
  type RepoRecord
} from '@gitreedesk/shared'
import { ACTIVITY_WINDOW_VALUES, useGraph } from '../contexts/graph'
import { useSettings } from '../contexts/settings'
import { useTreeUi } from '../contexts/tree'
import { useWorkspace } from '../contexts/workspace'
import { relativeTime } from '../lib/relative-time'
import { normalizeGraphDensity, rowHeightForGraph } from '../theme'
import { useSettingValue } from '../use-setting-value'
import { checkoutKey } from '../tree/repos-model'
import { AlertTriangleIcon, SearchIcon } from './icons'

const HEADER_HEIGHT = 22
const NO_RECORDS: readonly RepoRecord[] = []

type TimelineLine =
  | { type: 'day'; key: string; label: string }
  | { type: 'commit'; key: string; entry: GitActivityEntry; repo: string }

function dayKey(iso: string, locale: string): string {
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return ''
  return parsed.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: '2-digit' })
}

/** Flips the Graph pane between one repository's lanes and the workspace timeline. */
export function GraphModeSwitch(): JSX.Element {
  const { t } = useTranslation()
  const graph = useGraph()
  return (
    <div
      role="group"
      aria-label={t('graph.activity.mode.label')}
      className="flex shrink-0 items-center overflow-hidden rounded border border-line"
    >
      {(['repo', 'workspace'] as const).map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={graph.mode === value}
          title={t('graph.activity.mode.hint')}
          className={`h-6 px-2 text-xs ${
            graph.mode === value ? 'bg-ink/10 text-ink' : 'bg-canvas text-muted hover:bg-ink/5'
          }`}
          onClick={() => graph.setMode(value)}
        >
          {t(`graph.activity.mode.${value}`)}
        </button>
      ))}
    </div>
  )
}

/**
 * Recent commits of every checked repository folded into one timeline. The
 * scope follows the Repos view checkboxes, and a row hands the commit over to
 * that repository's graph.
 */
export function WorkspaceActivityView(): JSX.Element {
  const { t } = useTranslation()
  const { locale } = useSettings()
  const graph = useGraph()
  const workspace = useWorkspace()
  const tree = useTreeUi()
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [rowDensity, setRowDensity] = useSettingValue<GraphDensityValue>(
    ['appearance', 'graphDensity'],
    'normal',
    normalizeGraphDensity
  )
  const rowHeight = rowHeightForGraph(rowDensity)
  const [draft, setDraft] = useState({ author: graph.activityFilters.author, grep: graph.activityFilters.grep })

  const records = workspace.descriptor?.records ?? NO_RECORDS
  const scope = useMemo(() => {
    const list = records.filter((record) => record.gitDir.length > 0)
    return (tree.scmOnlySelected ? list.filter((record) => tree.isScmSelected(checkoutKey(record))) : list).map(
      (record) => record.gitDir
    )
  }, [records, tree])
  const scopeKey = scope.join('\n')
  const recordByDir = useMemo(() => new Map(records.map((record) => [record.gitDir, record])), [records])

  const activity = graph.activity
  const lines = useMemo<TimelineLine[]>(() => {
    const out: TimelineLine[] = []
    let day = ''
    for (const entry of activity.entries) {
      const label = dayKey(entry.commit.author.date, locale)
      if (label !== day) {
        day = label
        out.push({ type: 'day', key: `day:${label}`, label })
      }
      out.push({
        type: 'commit',
        key: `${entry.gitDir}:${entry.commit.sha}`,
        entry,
        repo: entry.repoName
      })
    }
    return out
  }, [activity.entries, locale])

  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (lines[index]?.type === 'day' ? HEADER_HEIGHT : rowHeight),
    overscan: 16
  })

  // The timeline reads itself once per scope and refreshes when a HEAD in that
  // scope moves; the short delay coalesces the statuses arriving at open.
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const headDigest = useMemo(() => {
    let text = ''
    for (const gitDir of scope) text += workspace.statuses.get(gitDir)?.status.head.sha ?? ''
    return text
  }, [scope, workspace.statuses])
  const lastRead = useRef('')
  // Only the scope and the heads re-schedule a read; the context value is a new
  // object on every status tick and must not cancel the pending one.
  const loadActivityRef = useRef(graph.loadActivity)
  loadActivityRef.current = graph.loadActivity
  useEffect(() => {
    const signature = `${scopeKey}\u0000${headDigest}`
    if (signature === lastRead.current) return
    lastRead.current = signature
    const timer = setTimeout(() => loadActivityRef.current(scopeRef.current), 300)
    return () => clearTimeout(timer)
  }, [scopeKey, headDigest])

  const setActivityFiltersRef = useRef(graph.setActivityFilters)
  setActivityFiltersRef.current = graph.setActivityFilters
  const filtersRef = useRef(graph.activityFilters)
  filtersRef.current = graph.activityFilters
  useEffect(() => {
    const timer = setTimeout(() => {
      if (draft.author !== filtersRef.current.author || draft.grep !== filtersRef.current.grep)
        setActivityFiltersRef.current({ author: draft.author, grep: draft.grep })
    }, 400)
    return () => clearTimeout(timer)
  }, [draft])

  const reveal = useCallback(
    (entry: GitActivityEntry): void => {
      const record = recordByDir.get(entry.gitDir)
      if (record === undefined) return
      graph.openGraph(record)
      graph.revealCommit(record.gitDir, entry.commit.sha)
    },
    [graph, recordByDir]
  )

  const inputClass =
    'h-6 min-w-0 rounded border border-line bg-canvas px-2 text-xs text-ink outline-none focus:border-accent'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line bg-panel px-2 py-1.5 text-xs">
        <GraphModeSwitch />

        <label className="flex items-center gap-1 text-muted">
          <span>{t('graph.activity.window')}</span>
          <select
            value={graph.activityFilters.days}
            aria-label={t('graph.activity.window')}
            className={inputClass}
            onChange={(event) => graph.setActivityFilters({ days: Number(event.target.value) })}
          >
            {ACTIVITY_WINDOW_VALUES.map((days) => (
              <option key={days} value={days}>
                {t('graph.activity.windowDays', { count: days })}
              </option>
            ))}
          </select>
        </label>

        <div className="relative flex min-w-40 flex-1 items-center">
          <SearchIcon className="pointer-events-none absolute left-2 size-3.5 shrink-0 text-muted" />
          <input
            value={draft.grep}
            placeholder={t('graph.activity.search')}
            aria-label={t('graph.activity.search')}
            className={`${inputClass} w-full pl-7`}
            onChange={(event) => setDraft((current) => ({ ...current, grep: event.target.value }))}
          />
        </div>
        <input
          value={draft.author}
          placeholder={t('graph.activity.author')}
          aria-label={t('graph.activity.author')}
          className={`${inputClass} w-32 shrink-0`}
          onChange={(event) => setDraft((current) => ({ ...current, author: event.target.value }))}
        />

        <span
          className="shrink-0 text-muted"
          title={t('graph.activity.scopeHint')}
        >
          {scope.length === 1 ? t('graph.activity.scopeOne') : t('graph.activity.scope', { count: scope.length })}
        </span>

        <button
          type="button"
          className="shrink-0 rounded border border-line bg-canvas px-2 py-0.5 text-muted hover:bg-ink/5 hover:text-ink"
          onClick={() => graph.loadActivity(scope)}
        >
          {t('graph.activity.refresh')}
        </button>

        <label className="flex items-center gap-1 text-muted">
          <span>{t('graph.density.label')}</span>
          <select
            value={rowDensity}
            aria-label={t('graph.density.label')}
            className={inputClass}
            onChange={(event) => setRowDensity(event.target.value as GraphDensityValue)}
          >
            {GRAPH_DENSITY_VALUES.map((value) => (
              <option key={value} value={value}>
                {t(`settings.options.graphDensity.${value}`)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {activity.error !== null && (
        <div className="flex shrink-0 items-center gap-2 border-b border-line bg-panel px-3 py-1.5 text-xs">
          <span className="min-w-0 flex-1 truncate text-danger" title={activity.error}>
            {activity.error}
          </span>
          <button
            type="button"
            className="shrink-0 rounded px-2 py-0.5 text-muted hover:bg-ink/5 hover:text-ink"
            onClick={() => graph.loadActivity(scope)}
          >
            {t('graph.retry')}
          </button>
        </div>
      )}

      {activity.failures.length > 0 && (
        <div
          className="flex shrink-0 items-center gap-1.5 border-b border-line bg-warn/10 px-3 py-1.5 text-xs text-warn"
          title={activity.failures
            .map((failure) => recordByDir.get(failure.gitDir)?.name ?? failure.gitDir)
            .join(', ')}
        >
          <AlertTriangleIcon className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            {t('graph.activity.failures', { count: activity.failures.length })}
          </span>
        </div>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {activity.loading && lines.length === 0 && (
          <p className="px-3 py-2 text-xs text-muted">{t('graph.activity.loading')}</p>
        )}
        {!activity.loading && activity.error === null && lines.length === 0 && (
          <p className="px-3 py-2 text-xs text-muted">
            {scope.length === 0 ? t('graph.activity.emptyScope') : t('graph.activity.empty')}
          </p>
        )}
        {lines.length > 0 && (
          <div style={{ height: virtualizer.getTotalSize() }} className="relative">
            {virtualizer.getVirtualItems().map((item) => {
              const line = lines[item.index]
              if (line === undefined) return null
              return (
                <div
                  key={line.key}
                  data-index={item.index}
                  ref={virtualizer.measureElement}
                  style={{ position: 'absolute', top: item.start, left: 0, right: 0 }}
                >
                  {line.type === 'day' ? (
                    <div
                      style={{ height: HEADER_HEIGHT }}
                      className="flex items-center border-b border-line/60 bg-canvas px-3 text-[11px] font-medium text-muted"
                    >
                      {line.label}
                    </div>
                  ) : (
                    <button
                      type="button"
                      title={t('graph.activity.open')}
                      style={{ height: rowHeight }}
                      className="flex w-full items-center gap-2 border-b border-line/40 px-3 text-left text-xs hover:bg-ink/5"
                      onClick={() => reveal(line.entry)}
                    >
                      <span className="w-16 shrink-0 tabular-nums text-muted">
                        {relativeTime(line.entry.commit.author.date, locale)}
                      </span>
                      <span className="max-w-40 shrink-0 truncate rounded bg-ink/5 px-1.5 py-0.5 text-[11px] text-ink">
                        {line.repo}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-ink">
                        {line.entry.commit.subject}
                      </span>
                      <span className="w-28 shrink-0 truncate text-right text-muted">
                        {line.entry.commit.author.name}
                      </span>
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
        {activity.truncated.length > 0 && (
          <p className="px-3 py-2 text-[11px] text-muted">{t('graph.activity.truncated')}</p>
        )}
      </div>
    </div>
  )
}

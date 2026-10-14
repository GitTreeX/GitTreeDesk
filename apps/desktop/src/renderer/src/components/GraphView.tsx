import { useCallback, useRef, type JSX } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useTranslation } from 'react-i18next'
import type { CommitInfo } from '@gitreedesk/shared'
import { useGraph } from '../contexts/graph'
import type { GraphTab } from '../contexts/editor'
import { useSettings } from '../contexts/settings'
import { relativeTime } from '../lib/relative-time'

const ROW_HEIGHT = 36
const NO_COMMITS: readonly CommitInfo[] = []

export function GraphView({ tab }: { tab: GraphTab }): JSX.Element | null {
  const { t } = useTranslation()
  const { locale } = useSettings()
  const graph = useGraph()
  const gitDir = tab.repo.gitDir
  const slice = graph.slices.get(gitDir)
  const commits = slice?.commits ?? NO_COMMITS

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const virtualizer = useVirtualizer({
    count: commits.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12
  })

  const onScroll = useCallback((): void => {
    const element = scrollRef.current
    if (element === null) return
    if (element.scrollHeight - element.scrollTop - element.clientHeight < ROW_HEIGHT * 20) {
      graph.loadMore(gitDir)
    }
  }, [graph, gitDir])

  if (slice === undefined) return null

  if (slice.loading && commits.length === 0) {
    return <Centered text={t('graph.loading')} />
  }

  if (slice.error !== null && commits.length === 0) {
    return (
      <Centered text={slice.error}>
        <button
          type="button"
          className="rounded border border-line px-3 py-1 text-xs text-ink hover:bg-ink/5"
          onClick={() => graph.reload(gitDir)}
        >
          {t('graph.retry')}
        </button>
      </Centered>
    )
  }

  if (commits.length === 0) {
    return <Centered text={t('graph.empty')} />
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {slice.error !== null && (
        <div className="flex shrink-0 items-center gap-2 border-b border-line bg-panel px-3 py-1.5 text-xs">
          <span className="min-w-0 flex-1 truncate text-danger" title={slice.error}>
            {slice.error}
          </span>
          <button
            type="button"
            className="shrink-0 rounded px-2 py-0.5 text-muted hover:bg-ink/5 hover:text-ink"
            onClick={() => graph.reload(gitDir)}
          >
            {t('graph.retry')}
          </button>
        </div>
      )}
      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-auto">
        <div style={{ height: virtualizer.getTotalSize() }} className="relative">
          {virtualizer.getVirtualItems().map((item) => {
            const commit = commits[item.index]
            if (commit === undefined) return null
            return (
              <div
                key={commit.sha}
                style={{ height: item.size, transform: `translateY(${String(item.start)}px)` }}
                className="absolute inset-x-0 flex items-center gap-3 px-3 text-xs"
              >
                <span className="w-16 shrink-0 font-mono text-muted">{commit.sha.slice(0, 7)}</span>
                <span className="min-w-0 flex-1 truncate text-ink">{commit.subject}</span>
                <span className="w-32 shrink-0 truncate text-right text-muted">
                  {commit.author.name}
                </span>
                <span className="w-24 shrink-0 text-right text-muted">
                  {relativeTime(commit.author.date, locale)}
                </span>
              </div>
            )
          })}
        </div>
      </div>
      <footer className="flex h-7 shrink-0 items-center justify-between border-t border-line bg-panel px-3 text-xs text-muted">
        <span>{slice.loadingMore ? t('graph.loadingMore') : ''}</span>
        <span>{t('graph.loaded', { count: commits.length })}</span>
      </footer>
    </div>
  )
}

function Centered({ text, children }: { text: string; children?: JSX.Element }): JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6">
      <p className="max-w-md text-center text-sm break-words text-muted">{text}</p>
      {children}
    </div>
  )
}

import { useEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import { useEditor } from '../contexts/editor'
import { useWorkspace } from '../contexts/workspace'
import { SearchIcon } from './icons'

const MAX_RESULTS = 50

interface Match {
  path: string
  positions: number[]
  score: number
}

/** Subsequence match over a lowercased haystack; prefers contiguous runs and segment starts. */
function matchPath(path: string, needle: string): Match | null {
  const lower = path.toLowerCase()
  const basenameStart = lower.lastIndexOf('/') + 1
  const positions: number[] = []
  let score = 0
  let cursor = 0
  let previous = -2
  for (const char of needle) {
    const index = lower.indexOf(char, cursor)
    if (index === -1) return null
    if (index === previous + 1) score += 8
    if (index === 0 || lower[index - 1] === '/') score += 10
    if (index >= basenameStart) score += 4
    positions.push(index)
    previous = index
    cursor = index + 1
  }
  return { path, positions, score: score - lower.length * 0.01 }
}

function rankFiles(files: readonly string[], query: string): Match[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') {
    return files.slice(0, MAX_RESULTS).map((path) => ({ path, positions: [], score: 0 }))
  }
  const matches: Match[] = []
  for (const path of files) {
    const match = matchPath(path, needle)
    if (match !== null) matches.push(match)
  }
  matches.sort((a, b) => b.score - a.score)
  return matches.slice(0, MAX_RESULTS)
}

function Highlighted({ match }: { match: Match }): JSX.Element {
  if (match.positions.length === 0) return <>{match.path}</>
  const parts: JSX.Element[] = []
  let cursor = 0
  for (const [order, index] of match.positions.entries()) {
    if (index > cursor) parts.push(<span key={`plain-${order}`}>{match.path.slice(cursor, index)}</span>)
    parts.push(
      <span key={`hit-${order}`} className="text-accent">
        {match.path.slice(index, index + 1)}
      </span>
    )
    cursor = index + 1
  }
  if (cursor < match.path.length) parts.push(<span key="tail">{match.path.slice(cursor)}</span>)
  return <>{parts}</>
}

export function QuickOpen(): JSX.Element {
  const { t } = useTranslation()
  const editor = useEditor()
  const { descriptor } = useWorkspace()
  const [query, setQuery] = useState('')
  const [allFiles, setAllFiles] = useState<string[] | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLUListElement | null>(null)

  const root = descriptor?.root ?? null

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (root === null) return
    let live = true
    void api.invoke('workspace:listFiles', {}).then(
      (response) => {
        if (!live) return
        setAllFiles(response.files)
        setTruncated(response.truncated)
      },
      (error: unknown) => {
        if (!live) return
        console.error('[quick-open] listing files failed', error)
        setAllFiles([])
      }
    )
    return () => {
      live = false
    }
  }, [root])

  const matches = useMemo(
    () => (allFiles === null ? null : rankFiles(allFiles, query)),
    [allFiles, query]
  )

  useEffect(() => {
    setSelected(0)
  }, [query])

  useEffect(() => {
    const row = listRef.current?.children[selected]
    if (row instanceof HTMLElement) row.scrollIntoView({ block: 'nearest' })
  }, [selected, matches])

  const choose = (match: Match | undefined): void => {
    if (match === undefined || root === null) return
    editor.openFile(`${root}/${match.path}`, { preview: true })
    editor.closeQuickOpen()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSelected((current) => Math.min(current + 1, (matches?.length ?? 1) - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelected((current) => Math.max(current - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      choose(matches?.[selected])
    } else if (event.key === 'Escape') {
      event.preventDefault()
      editor.closeQuickOpen()
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex justify-center bg-black/40 pt-24"
      onMouseDown={editor.closeQuickOpen}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="h-fit w-full max-w-lg overflow-hidden rounded-lg border border-line bg-panel shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-line px-3 py-2">
          <SearchIcon className="size-4 shrink-0 text-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t('quickOpen.placeholder')}
            aria-label={t('quickOpen.placeholder')}
            className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-muted"
          />
        </div>
        {matches === null ? (
          <p className="px-3 py-6 text-center text-sm text-muted">{t('quickOpen.loading')}</p>
        ) : matches.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted">{t('quickOpen.noResults')}</p>
        ) : (
          <>
            <ul ref={listRef} role="listbox" className="max-h-80 overflow-y-auto py-1">
              {matches.map((match, index) => (
                <li key={match.path} role="option" aria-selected={index === selected}>
                  <button
                    type="button"
                    onMouseMove={() => setSelected(index)}
                    onClick={() => choose(match)}
                    className={`block w-full truncate px-3 py-1 text-left font-mono text-xs ${
                      index === selected ? 'bg-ink/5 text-ink' : 'text-muted'
                    }`}
                    title={match.path}
                  >
                    <Highlighted match={match} />
                  </button>
                </li>
              ))}
            </ul>
            {truncated && (
              <p className="border-t border-line px-3 py-1.5 text-xs text-muted">
                {t('quickOpen.truncated')}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}

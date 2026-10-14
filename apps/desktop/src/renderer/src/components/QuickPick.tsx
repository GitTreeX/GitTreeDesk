import { useEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { RepoRecord } from '@gitreedesk/shared'
import { useReposUi } from '../contexts/repos'
import { useTreeUi } from '../contexts/tree'
import { useWorkspace } from '../contexts/workspace'
import { branchLabel } from './RepoBadges'
import { SearchIcon } from './icons'

const MAX_RESULTS = 40

export function QuickPick(): JSX.Element {
  const { t } = useTranslation()
  const { descriptor, statuses } = useWorkspace()
  const tree = useTreeUi()
  const repoUi = useReposUi()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLUListElement | null>(null)

  const records = descriptor?.records ?? []
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const list =
      needle === ''
        ? records
        : records.filter(
            (record) =>
              record.name.toLowerCase().includes(needle) || record.relPath.toLowerCase().includes(needle)
          )
    return list.slice(0, MAX_RESULTS)
  }, [records, query])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    setSelected(0)
  }, [query])

  useEffect(() => {
    const row = listRef.current?.children[selected]
    if (row instanceof HTMLElement) row.scrollIntoView({ block: 'nearest' })
  }, [selected, matches])

  const choose = (record: RepoRecord | undefined): void => {
    if (record === undefined) return
    if (record.gitDir.length > 0) repoUi.setActiveKey(record.gitDir)
    tree.requestRepoFocus(record.path)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSelected((current) => Math.min(current + 1, matches.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelected((current) => Math.max(current - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      choose(matches[selected])
    } else if (event.key === 'Escape') {
      event.preventDefault()
      tree.closeQuickPick()
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-center bg-black/40 pt-24" onMouseDown={tree.closeQuickPick}>
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
            placeholder={t('quickPick.placeholder')}
            aria-label={t('quickPick.placeholder')}
            className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-muted"
          />
        </div>
        {matches.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted">{t('quickPick.noResults')}</p>
        ) : (
          <ul ref={listRef} role="listbox" className="max-h-80 overflow-y-auto py-1">
            {matches.map((record, index) => {
              const status = statuses.get(record.gitDir)?.status ?? null
              const label = branchLabel(record, status)
              return (
                <li key={record.path} role="option" aria-selected={index === selected}>
                  <button
                    type="button"
                    onMouseMove={() => setSelected(index)}
                    onClick={() => choose(record)}
                    className={`flex w-full items-baseline gap-3 px-3 py-1.5 text-left text-sm ${
                      index === selected ? 'bg-ink/5 text-ink' : 'text-ink'
                    }`}
                  >
                    <span className="shrink-0 font-medium">{record.name}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted">
                      {record.relPath === '' ? '.' : record.relPath}
                    </span>
                    {label !== '' && (
                      <span className="max-w-[30%] shrink-0 truncate font-mono text-xs text-muted">{label}</span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

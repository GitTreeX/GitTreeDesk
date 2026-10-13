import { useEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { filterCommands, type CommandRegistry, type PaletteItem } from '../commands/registry'
import type { KeyBindingService } from '../commands/defaults'
import { SearchIcon } from './icons'

interface PaletteRow extends PaletteItem {
  enabled: boolean
  shortcut: string | null
}

export function CommandPalette({
  registry,
  keybindings,
  onClose
}: {
  registry: CommandRegistry
  keybindings: KeyBindingService
  onClose: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLUListElement | null>(null)

  const rows = useMemo<PaletteRow[]>(() => {
    const items = registry
      .list()
      .filter((definition) => definition.hiddenInPalette !== true)
      .map((definition) => ({
        id: definition.id,
        title: t(definition.titleKey),
        category: t(definition.categoryKey),
        enabled: definition.enabled?.() !== false,
        shortcut: keybindings.formatFor(definition.id)
      }))
    const filtered = filterCommands(items, query)
    filtered.sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title))
    return filtered
  }, [registry, keybindings, query, t])

  useEffect(() => {
    setSelected(0)
  }, [query])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const list = listRef.current
    const row = list?.children[selected]
    if (row instanceof HTMLElement) row.scrollIntoView({ block: 'nearest' })
  }, [selected, rows])

  const run = (row: PaletteRow | undefined): void => {
    if (row === undefined || !row.enabled) return
    onClose()
    void registry.execute(row.id).catch((error: unknown) => {
      console.error(`[commands] ${row.id} failed`, error)
    })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSelected((current) => Math.min(current + 1, rows.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelected((current) => Math.max(current - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      run(rows[selected])
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-center bg-black/40 pt-24" onMouseDown={onClose}>
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
            placeholder={t('palette.placeholder')}
            aria-label={t('palette.placeholder')}
            className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-muted"
          />
        </div>
        {rows.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted">{t('palette.noResults')}</p>
        ) : (
          <ul ref={listRef} role="listbox" className="max-h-80 overflow-y-auto py-1">
            {rows.map((row, index) => (
              <li key={row.id} role="option" aria-selected={index === selected}>
                <button
                  type="button"
                  disabled={!row.enabled}
                  onMouseMove={() => setSelected(index)}
                  onClick={() => run(row)}
                  className={`flex w-full items-baseline gap-3 px-3 py-1.5 text-left text-sm disabled:opacity-40 ${
                    index === selected ? 'bg-ink/5 text-ink' : 'text-ink'
                  }`}
                >
                  <span className="w-20 shrink-0 truncate text-xs text-muted">{row.category}</span>
                  <span className="min-w-0 flex-1 truncate">{row.title}</span>
                  {row.shortcut !== null && (
                    <span className="shrink-0 font-mono text-xs text-muted">{row.shortcut}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

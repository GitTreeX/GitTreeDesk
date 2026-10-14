import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import { DEFAULT_BINDINGS } from '../commands/defaults'
import { acceleratorFromEvent, formatAccelerator, parseAccelerator } from '../commands/keybinding'
import { useCommands } from '../contexts/commands'
import { notifyError } from '../notify'

interface ShortcutRow {
  command: string
  title: string
  defaultKeys: string | null
  currentKeys: string | null
  /** True when a user override defines the effective binding, bound or not. */
  overridden: boolean
  /** True when the override text cannot be read as an accelerator. */
  invalid: boolean
}

interface PendingEdit {
  command: string
  keys: string
  /** Command whose binding would also fire, when the captured keys are taken. */
  conflict: string | null
}

function keyDisplay(keys: string | null, platform: string): string | null {
  if (keys === null) return null
  const parsed = parseAccelerator(keys)
  return parsed === null ? keys : formatAccelerator(parsed, platform)
}

const CHIP = 'rounded border px-1.5 py-0.5 font-mono text-[11px]'
const SMALL_BUTTON = 'rounded border border-line px-1.5 py-0.5 text-[11px] text-muted hover:bg-ink/5 hover:text-ink'

export function KeyboardShortcutsView(): JSX.Element {
  const { t } = useTranslation()
  const { registry, keybindings, overrides } = useCommands()
  const [query, setQuery] = useState('')
  const [recording, setRecording] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingEdit | null>(null)

  const commandTitle = useCallback(
    (command: string): string => {
      const definition = registry.get(command)
      if (definition === undefined) return command
      if (definition.title !== undefined) return definition.title
      if (definition.titleKey !== undefined) return t(definition.titleKey)
      return command
    },
    [registry, t]
  )

  // While recording, keys are captured before anything else sees them. Escape
  // leaves the recording; a press that is only modifiers waits for the real key.
  useEffect(() => {
    if (recording === null) return
    const onKeyDown = (event: KeyboardEvent): void => {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') {
        setRecording(null)
        return
      }
      const keys = acceleratorFromEvent(event, api.platform)
      if (keys === null) return
      const conflict = keybindings.findConflict(event, recording)
      setPending({ command: recording, keys, conflict: conflict === null ? null : conflict.command })
      setRecording(null)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [keybindings, recording])

  const rows = useMemo<ShortcutRow[]>(() => {
    const defaults = new Map(DEFAULT_BINDINGS.map((binding) => [binding.command, binding.keys]))
    const order = new Map(DEFAULT_BINDINGS.map((binding, index) => [binding.command, index]))
    const commands = new Set<string>([...defaults.keys(), ...Object.keys(overrides)])
    return [...commands]
      .map((command) => {
        const override = overrides[command]
        const defaultKeys = defaults.get(command) ?? null
        return {
          command,
          title: commandTitle(command),
          defaultKeys,
          currentKeys: override !== undefined ? override : defaultKeys,
          overridden: override !== undefined,
          invalid: override !== undefined && override !== null && parseAccelerator(override) === null
        }
      })
      .sort((a, b) => {
        const ai = order.get(a.command) ?? Number.MAX_SAFE_INTEGER
        const bi = order.get(b.command) ?? Number.MAX_SAFE_INTEGER
        if (ai !== bi) return ai - bi
        return a.command.localeCompare(b.command)
      })
  }, [commandTitle, overrides])

  const tokens = useMemo(
    () => query.trim().toLowerCase().split(/\s+/).filter((token) => token.length > 0),
    [query]
  )

  const visible = useMemo(() => {
    if (tokens.length === 0) return rows
    return rows.filter((row) => {
      const haystack = `${row.title}\n${row.command}`.toLowerCase()
      return tokens.every((token) => haystack.includes(token))
    })
  }, [rows, tokens])

  const beginRecord = useCallback((command: string): void => {
    setPending(null)
    setRecording((current) => (current === command ? null : command))
  }, [])

  const savePending = useCallback(async (): Promise<void> => {
    const edit = pending
    if (edit === null) return
    setPending(null)
    try {
      await api.invoke('keybindings:set', { command: edit.command, keys: edit.keys })
    } catch (error) {
      notifyError(error instanceof Error ? error.message : String(error))
    }
  }, [pending])

  const resetRow = useCallback(async (command: string): Promise<void> => {
    setPending(null)
    try {
      await api.invoke('keybindings:reset', { command })
    } catch (error) {
      notifyError(error instanceof Error ? error.message : String(error))
    }
  }, [])

  const contextRows: readonly (readonly [string, string])[] = [
    ['Space', t('keyboard.contextSpace')],
    ['Enter', t('keyboard.contextEnter')]
  ]

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-canvas">
      <div className="mx-auto flex max-w-3xl flex-col px-6 py-5">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-lg font-semibold text-ink">{t('keyboard.title')}</h1>
          <input
            type="text"
            value={query}
            placeholder={t('keyboard.searchPlaceholder')}
            onChange={(event) => setQuery(event.target.value)}
            className="h-7 w-56 rounded border border-line bg-canvas px-2 text-xs text-ink outline-none focus:border-accent"
          />
        </div>

        {visible.length === 0 ? (
          <p className="mt-6 text-sm text-muted">{t('keyboard.noResults')}</p>
        ) : (
          <section className="mt-4">
            <h2 className="text-xs font-semibold tracking-wide text-muted uppercase">
              {t('keyboard.commandsTitle')}
            </h2>
            <div className="mt-1.5 divide-y divide-line/60 rounded-lg border border-line bg-panel">
              {visible.map((row) => {
                const isPending = pending !== null && pending.command === row.command
                const isRecording = recording === row.command
                const defaultText = keyDisplay(row.defaultKeys, api.platform)
                const currentText = keyDisplay(row.currentKeys, api.platform)
                return (
                  <div
                    key={row.command}
                    data-command={row.command}
                    className="flex items-start gap-3 px-3 py-2.5 hover:bg-ink/[0.03]"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-ink">{row.title}</div>
                      <div
                        className="mt-0.5 truncate font-mono text-[11px] text-muted"
                        title={row.command}
                      >
                        {row.command}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5 pt-0.5">
                      {isPending ? (
                        <>
                          <span className={`${CHIP} border-accent/60 bg-accent/10 text-ink`}>
                            {pending === null ? '' : (keyDisplay(pending.keys, api.platform) ?? pending.keys)}
                          </span>
                          {pending !== null && pending.conflict !== null && (
                            <p className="text-[11px] text-warn">
                              {t('keyboard.conflict', { command: commandTitle(pending.conflict) })}
                            </p>
                          )}
                          <div className="flex items-center gap-1.5 text-[11px]">
                            <button
                              type="button"
                              className="rounded bg-accent px-1.5 py-0.5 text-[11px] text-white hover:opacity-90"
                              onClick={() => void savePending()}
                            >
                              {t('keyboard.pendingSave')}
                            </button>
                            <button
                              type="button"
                              className={SMALL_BUTTON}
                              onClick={() => setPending(null)}
                            >
                              {t('keyboard.pendingCancel')}
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="flex items-center gap-1.5">
                            <span className={`${CHIP} border-line text-muted`}>
                              {defaultText ?? '—'}
                            </span>
                            {currentText === null ? (
                              <span className={`${CHIP} border-dashed border-line text-muted italic`}>
                                {t('keyboard.unassigned')}
                              </span>
                            ) : (
                              <span
                                className={`${CHIP} ${
                                  row.overridden ? 'border-accent/60 bg-accent/10 text-ink' : 'border-line text-ink'
                                }`}
                              >
                                {currentText}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 text-[11px]">
                            {row.overridden && (
                              <span className="rounded bg-accent/10 px-1.5 py-0.5 text-accent">
                                {t('keyboard.custom')}
                              </span>
                            )}
                            {row.invalid && (
                              <span className="rounded bg-danger/10 px-1.5 py-0.5 text-danger">
                                {t('keyboard.invalid')}
                              </span>
                            )}
                            <button
                              type="button"
                              className={`rounded border px-1.5 py-0.5 text-[11px] ${
                                isRecording
                                  ? 'border-accent/60 bg-accent/15 text-ink'
                                  : 'border-line text-muted hover:bg-ink/5 hover:text-ink'
                              }`}
                              onClick={() => beginRecord(row.command)}
                            >
                              {isRecording ? t('keyboard.recording') : t('keyboard.record')}
                            </button>
                            {row.overridden && (
                              <button
                                type="button"
                                className={SMALL_BUTTON}
                                onClick={() => void resetRow(row.command)}
                              >
                                {t('keyboard.reset')}
                              </button>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        <section className="mt-5">
          <h2 className="text-xs font-semibold tracking-wide text-muted uppercase">
            {t('keyboard.contextTitle')}
          </h2>
          <div className="mt-1.5 rounded-lg border border-line bg-panel">
            <div className="divide-y divide-line/60">
              {contextRows.map(([key, action]) => (
                <div key={key} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <span className="min-w-0 text-sm text-ink">{action}</span>
                  <span className={`${CHIP} shrink-0 border-line text-muted`}>{key}</span>
                </div>
              ))}
            </div>
            <p className="border-t border-line/60 px-3 py-2 text-xs text-muted">
              {t('keyboard.contextNote')}
            </p>
          </div>
        </section>
      </div>
    </div>
  )
}

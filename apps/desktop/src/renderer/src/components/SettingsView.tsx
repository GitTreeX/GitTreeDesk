import { useCallback, useEffect, useMemo, useState, type JSX, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  SETTINGS_SURFACE,
  sanitizeSettingValue,
  type EnumSettingDescriptor,
  type NumberSettingDescriptor,
  type SettingDescriptor,
  type SettingGroupId,
  type StringSettingDescriptor
} from '@gitreedesk/shared'
import { api } from '../api'
import { notify, notifyError } from '../notify'

const GROUPS: readonly SettingGroupId[] = [
  'appearance',
  'editor',
  'git',
  'terminal',
  'commitMessage',
  'advanced'
]

const LABEL_KEYS: Record<string, string> = {
  'appearance.theme': 'settings.items.theme',
  'appearance.density': 'settings.items.density',
  'appearance.graphDensity': 'settings.items.graphDensity',
  'appearance.graphCurve': 'settings.items.graphCurve',
  'appearance.accent': 'settings.items.accent',
  locale: 'settings.items.locale',
  'editor.fontSize': 'settings.items.editorFontSize',
  'editor.fontFamily': 'settings.items.editorFontFamily',
  'editor.tabSize': 'settings.items.editorTabSize',
  'editor.insertSpaces': 'settings.items.editorInsertSpaces',
  'editor.wordWrap': 'settings.items.editorWordWrap',
  'editor.minimap': 'settings.items.editorMinimap',
  'editor.command': 'settings.items.editorCommand',
  'git.path': 'settings.items.gitPath',
  'git.concurrency': 'settings.items.gitConcurrency',
  'git.pollIntervalSec': 'settings.items.gitPollInterval',
  'git.defaultPullStrategy': 'settings.items.gitPullStrategy',
  'git.untrackedStrategy': 'settings.items.gitUntrackedStrategy',
  'git.worktreeRoot': 'settings.items.gitWorktreeRoot',
  'merge.toolCommand': 'settings.items.mergeToolCommand',
  'terminal.defaultProfile': 'settings.items.terminalProfile',
  'terminal.scrollback': 'settings.items.terminalScrollback',
  'commitMessage.provider': 'settings.items.commitProvider',
  'commitMessage.baseUrl': 'settings.items.commitBaseUrl',
  'commitMessage.model': 'settings.items.commitModel',
  'commitMessage.temperature': 'settings.items.commitTemperature',
  'advanced.logLevel': 'settings.items.logLevel'
}

const HINT_KEYS: Record<string, string> = {
  'appearance.theme': 'settings.hints.theme',
  'editor.fontFamily': 'settings.hints.editorFontFamily',
  'editor.insertSpaces': 'settings.hints.editorInsertSpaces',
  'editor.command': 'settings.hints.editorCommand',
  'merge.toolCommand': 'settings.hints.mergeToolCommand',
  'git.path': 'settings.hints.gitPath',
  'git.pollIntervalSec': 'settings.hints.gitPollInterval',
  'git.untrackedStrategy': 'settings.hints.gitUntrackedStrategy',
  'git.worktreeRoot': 'settings.hints.gitWorktreeRoot',
  'terminal.defaultProfile': 'settings.hints.terminalProfile',
  'commitMessage.temperature': 'settings.hints.commitTemperature',
  'advanced.logLevel': 'settings.hints.logLevel'
}

/** Leaf key segment to the option-labels i18n subtree. */
const OPTION_GROUP: Record<string, string> = {
  theme: 'theme',
  density: 'density',
  accent: 'accent',
  locale: 'locale',
  defaultPullStrategy: 'pullStrategy',
  untrackedStrategy: 'untrackedStrategy',
  provider: 'provider',
  logLevel: 'logLevel'
}

function keyOf(descriptor: SettingDescriptor): string {
  return descriptor.keyPath.join('.')
}

function optionLabelKey(descriptor: SettingDescriptor, option: string): string {
  const leaf = descriptor.keyPath[descriptor.keyPath.length - 1] ?? ''
  return `settings.options.${OPTION_GROUP[leaf] ?? leaf}.${option}`
}

function readKeyPath(doc: unknown, keyPath: readonly string[]): unknown {
  let current: unknown = doc
  for (const segment of keyPath) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

interface SettingRow {
  descriptor: SettingDescriptor
  /** Effective value, sanitized; invalid values fall back to the default. */
  value: unknown
  /** Set when the workspace file defines the key. */
  workspaceValue: unknown
  /** Set when the user file defines the key. */
  userValue: unknown
}

function buildRow(descriptor: SettingDescriptor, user: unknown, workspace: unknown): SettingRow {
  const userValue = readKeyPath(user, descriptor.keyPath)
  const workspaceValue = readKeyPath(workspace, descriptor.keyPath)
  const raw = workspaceValue !== undefined ? workspaceValue : userValue
  const sanitized = sanitizeSettingValue(descriptor, raw)
  return {
    descriptor,
    value: sanitized === undefined ? descriptor.default : sanitized,
    workspaceValue,
    userValue
  }
}

function inputClasses(width: string): string {
  return `h-7 ${width} rounded border border-line bg-canvas px-1.5 text-xs text-ink outline-none focus:border-accent`
}

function EnumControl({
  descriptor,
  value,
  onCommit
}: {
  descriptor: EnumSettingDescriptor
  value: unknown
  onCommit: (raw: unknown) => void
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <select
      value={String(value)}
      onChange={(event) => onCommit(event.target.value)}
      className={inputClasses('min-w-32')}
    >
      {descriptor.options.map((option) => (
        <option key={option} value={option}>
          {t(optionLabelKey(descriptor, option))}
        </option>
      ))}
    </select>
  )
}

function NumberControl({
  descriptor,
  value,
  onCommit
}: {
  descriptor: NumberSettingDescriptor
  value: unknown
  onCommit: (raw: unknown) => void
}): JSX.Element {
  const text = typeof value === 'number' ? String(value) : ''
  const [draft, setDraft] = useState(text)
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    if (!editing) setDraft(text)
  }, [text, editing])

  const commit = (): void => {
    setEditing(false)
    const parsed = Number(draft.trim())
    if (draft.trim() === '' || !Number.isFinite(parsed)) {
      setDraft(text)
      return
    }
    onCommit(parsed)
  }

  return (
    <input
      type="number"
      value={draft}
      min={descriptor.min}
      max={descriptor.max}
      step={descriptor.integer === true ? 1 : 'any'}
      onChange={(event) => {
        setEditing(true)
        setDraft(event.target.value)
      }}
      onBlur={commit}
      onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          commit()
        }
      }}
      className={inputClasses('w-24')}
    />
  )
}

function BooleanControl({
  value,
  onCommit
}: {
  value: unknown
  onCommit: (raw: unknown) => void
}): JSX.Element {
  return (
    <input
      type="checkbox"
      checked={value === true}
      onChange={(event) => onCommit(event.target.checked)}
      className="size-4 accent-accent"
    />
  )
}

function TextControl({
  descriptor,
  value,
  onCommit
}: {
  descriptor: StringSettingDescriptor
  value: unknown
  onCommit: (raw: unknown) => void
}): JSX.Element {
  const { t } = useTranslation()
  const text = typeof value === 'string' ? value : ''
  const [draft, setDraft] = useState(text)
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    if (!editing) setDraft(text)
  }, [text, editing])

  const commit = (): void => {
    setEditing(false)
    onCommit(draft.trim())
  }

  return (
    <input
      type="text"
      value={draft}
      placeholder={descriptor.default === null ? t('settings.auto') : descriptor.default}
      onChange={(event) => {
        setEditing(true)
        setDraft(event.target.value)
      }}
      onBlur={commit}
      onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          commit()
        }
      }}
      className={inputClasses('w-52')}
    />
  )
}

function SettingControl({
  row,
  onCommit
}: {
  row: SettingRow
  onCommit: (raw: unknown) => void
}): JSX.Element {
  const descriptor = row.descriptor
  switch (descriptor.type) {
    case 'enum':
      return <EnumControl descriptor={descriptor} value={row.value} onCommit={onCommit} />
    case 'number':
      return <NumberControl descriptor={descriptor} value={row.value} onCommit={onCommit} />
    case 'boolean':
      return <BooleanControl value={row.value} onCommit={onCommit} />
    case 'string':
      return <TextControl descriptor={descriptor} value={row.value} onCommit={onCommit} />
  }
}

function SettingRowView({
  row,
  onCommit,
  onCopyToWorkspace,
  onResetToUser
}: {
  row: SettingRow
  onCommit: (raw: unknown) => void
  onCopyToWorkspace: () => void
  onResetToUser: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const key = keyOf(row.descriptor)
  const label = t(LABEL_KEYS[key] ?? key)
  const hintKey = HINT_KEYS[key]
  const scope = row.workspaceValue !== undefined ? 'workspace' : row.userValue !== undefined ? 'user' : null

  return (
    <div className="flex items-start gap-3 px-3 py-2.5 hover:bg-ink/[0.03]">
      <div className="min-w-0 flex-1">
        <div className="text-sm text-ink">{label}</div>
        <div className="mt-0.5 truncate font-mono text-[11px] text-muted" title={key}>
          {key}
        </div>
        {hintKey !== undefined && <p className="mt-1 max-w-xl text-xs text-muted">{t(hintKey)}</p>}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5 pt-0.5">
        <SettingControl row={row} onCommit={onCommit} />
        <div className="flex items-center gap-1.5 text-[11px]">
          {scope === 'workspace' && (
            <span className="rounded bg-accent/10 px-1.5 py-0.5 text-accent">
              {t('settings.scopeWorkspace')}
            </span>
          )}
          {scope === 'user' && (
            <span className="rounded bg-ink/5 px-1.5 py-0.5 text-muted">{t('settings.scopeUser')}</span>
          )}
          {scope === 'workspace' ? (
            <button
              type="button"
              className="rounded px-1 py-0.5 text-muted hover:bg-ink/5 hover:text-ink"
              onClick={onResetToUser}
            >
              {t('settings.resetToUser')}
            </button>
          ) : (
            <button
              type="button"
              className="rounded px-1 py-0.5 text-muted hover:bg-ink/5 hover:text-ink"
              onClick={onCopyToWorkspace}
            >
              {t('settings.copyToWorkspace')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function ApiKeyRow(): JSX.Element {
  const { t } = useTranslation()
  const [status, setStatus] = useState<{ stored: boolean; encrypted: boolean } | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    try {
      setStatus(await api.invoke('commitmsg:keyStatus'))
    } catch {
      setStatus(null)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const save = useCallback(async () => {
    const key = draft.trim()
    if (key.length === 0 || busy) return
    setBusy(true)
    try {
      setStatus(await api.invoke('commitmsg:setKey', { key }))
      setDraft('')
      notify({ message: t('settings.apiKey.saved') })
    } catch (error) {
      notifyError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }, [busy, draft, t])

  const remove = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      setStatus(await api.invoke('commitmsg:removeKey'))
      notify({ message: t('settings.apiKey.removed') })
    } catch (error) {
      notifyError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }, [busy, t])

  return (
    <div className="flex items-start gap-3 px-3 py-2.5 hover:bg-ink/[0.03]">
      <div className="min-w-0 flex-1">
        <div className="text-sm text-ink">{t('settings.apiKey.label')}</div>
        <p className="mt-1 max-w-xl text-xs text-muted">{t('settings.apiKey.hint')}</p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5 pt-0.5">
        <div className="flex items-center gap-1.5">
          <input
            type="password"
            value={draft}
            placeholder={status?.stored === true ? t('settings.apiKey.stored') : t('settings.apiKey.placeholder')}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void save()
              }
            }}
            className={inputClasses('w-52')}
          />
          <button
            type="button"
            disabled={busy || draft.trim().length === 0}
            className="h-7 rounded border border-line px-2 text-xs text-ink hover:bg-ink/5 disabled:opacity-50"
            onClick={() => void save()}
          >
            {t('settings.apiKey.save')}
          </button>
          {status?.stored === true && (
            <button
              type="button"
              disabled={busy}
              className="h-7 rounded border border-line px-2 text-xs text-muted hover:bg-ink/5 hover:text-ink disabled:opacity-50"
              onClick={() => void remove()}
            >
              {t('settings.apiKey.remove')}
            </button>
          )}
        </div>
        {status?.stored === true && (
          <span className="text-[11px] text-muted">
            {status.encrypted ? t('settings.apiKey.stored') : t('settings.apiKey.sessionOnly')}
          </span>
        )}
      </div>
    </div>
  )
}

export function SettingsView(): JSX.Element {
  const { t } = useTranslation()
  const [docs, setDocs] = useState<{ user: unknown; workspace: unknown } | null>(null)
  const [query, setQuery] = useState('')

  const reload = useCallback(async () => {
    try {
      const [user, workspace] = await Promise.all([
        api.invoke('settings:getAll', { scope: 'user' }),
        api.invoke('settings:getAll', { scope: 'workspace' })
      ])
      setDocs({ user: user.value, workspace: workspace.value })
    } catch (error) {
      notifyError(error instanceof Error ? error.message : String(error))
    }
  }, [])

  useEffect(() => {
    void reload()
    return api.on('settings:changed', () => void reload())
  }, [reload])

  const rows = useMemo(
    () => (docs === null ? [] : SETTINGS_SURFACE.map((descriptor) => buildRow(descriptor, docs.user, docs.workspace))),
    [docs]
  )

  const tokens = useMemo(
    () => query.trim().toLowerCase().split(/\s+/).filter((token) => token.length > 0),
    [query]
  )

  const visible = useMemo(() => {
    if (tokens.length === 0) return rows
    return rows.filter((row) => {
      const key = keyOf(row.descriptor)
      const haystack = `${t(LABEL_KEYS[key] ?? key)}\n${key}\n${t(`settings.groups.${row.descriptor.group}`)}`.toLowerCase()
      return tokens.every((token) => haystack.includes(token))
    })
  }, [rows, tokens, t])

  const apiKeyMatches = useMemo(() => {
    const haystack =
      `api key\n${t('settings.apiKey.label')}\n${t('settings.apiKey.hint')}\n${t('settings.groups.commitMessage')}`.toLowerCase()
    return tokens.every((token) => haystack.includes(token))
  }, [tokens, t])

  const commit = useCallback(
    async (row: SettingRow, raw: unknown): Promise<void> => {
      const descriptor = row.descriptor
      const sanitized = sanitizeSettingValue(descriptor, raw)
      if (sanitized === undefined) return
      const scope = row.workspaceValue !== undefined ? 'workspace' : 'user'
      try {
        if (sanitized === null) {
          await api.invoke('settings:remove', { scope, keyPath: [...descriptor.keyPath] })
        } else {
          await api.invoke('settings:set', { scope, keyPath: [...descriptor.keyPath], value: sanitized })
        }
      } catch (error) {
        notifyError(error instanceof Error ? error.message : String(error))
        return
      }
      await reload()
    },
    [reload]
  )

  const copyToWorkspace = useCallback(
    async (row: SettingRow): Promise<void> => {
      try {
        await api.invoke('settings:set', {
          scope: 'workspace',
          keyPath: [...row.descriptor.keyPath],
          value: row.value
        })
      } catch (error) {
        notifyError(error instanceof Error ? error.message : String(error))
        return
      }
      await reload()
    },
    [reload]
  )

  const resetToUser = useCallback(
    async (row: SettingRow): Promise<void> => {
      try {
        await api.invoke('settings:remove', {
          scope: 'workspace',
          keyPath: [...row.descriptor.keyPath]
        })
      } catch (error) {
        notifyError(error instanceof Error ? error.message : String(error))
        return
      }
      await reload()
    },
    [reload]
  )

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-canvas">
      <div className="mx-auto flex max-w-3xl flex-col px-6 py-5">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-lg font-semibold text-ink">{t('settings.title')}</h1>
          <input
            type="text"
            value={query}
            placeholder={t('settings.searchPlaceholder')}
            onChange={(event) => setQuery(event.target.value)}
            className="h-7 w-56 rounded border border-line bg-canvas px-2 text-xs text-ink outline-none focus:border-accent"
          />
        </div>

        {docs === null ? (
          <p className="mt-6 text-sm text-muted">{t('editor.loading')}</p>
        ) : visible.length === 0 && !apiKeyMatches ? (
          <p className="mt-6 text-sm text-muted">{t('settings.noResults')}</p>
        ) : (
          GROUPS.map((group) => {
            const groupRows = visible.filter((row) => row.descriptor.group === group)
            const showApiKey = group === 'commitMessage' && apiKeyMatches
            if (groupRows.length === 0 && !showApiKey) return null
            return (
              <section key={group} className="mt-5 first:mt-4">
                <h2 className="text-xs font-semibold tracking-wide text-muted uppercase">
                  {t(`settings.groups.${group}`)}
                </h2>
                <div className="mt-1.5 divide-y divide-line/60 rounded-lg border border-line bg-panel">
                  {groupRows.map((row) => (
                    <SettingRowView
                      key={keyOf(row.descriptor)}
                      row={row}
                      onCommit={(raw) => void commit(row, raw)}
                      onCopyToWorkspace={() => void copyToWorkspace(row)}
                      onResetToUser={() => void resetToUser(row)}
                    />
                  ))}
                  {showApiKey && <ApiKeyRow />}
                </div>
              </section>
            )
          })
        )}
      </div>
    </div>
  )
}

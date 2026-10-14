import { useCallback, useEffect, useState, type JSX, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { RebaseAction, RepoRecord } from '@gitreedesk/shared'
import { api } from '../api'
import { useOperations } from '../contexts/operations-context'
import { useWorkspace } from '../contexts/workspace'
import { errorText, isOperationBlocked, notifyUndoable } from '../lib/reporting'
import { notify } from '../notify'
import { ContextMenu } from './ContextMenu'
import { ChevronRightIcon, XIcon } from './icons'

const ACTIONS: readonly RebaseAction[] = ['pick', 'reword', 'edit', 'squash', 'fixup', 'drop']

interface PlanRow {
  sha: string
  subject: string
  action: RebaseAction
  /** Replacement message of a `reword`; prefilled with the subject. */
  message: string
}

/** Plans a scripted interactive rebase: reorder rows and choose an action per commit. */
export function InteractiveRebaseDialog({
  record,
  base,
  onClose
}: {
  record: RepoRecord
  /** Revision whose descendants are replayed. */
  base: string
  onClose: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const operations = useOperations()
  const { statuses } = useWorkspace()
  const [rows, setRows] = useState<readonly PlanRow[] | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; index: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const current = statuses.get(record.gitDir)?.status.head.ref ?? 'HEAD'

  useEffect(() => {
    let live = true
    void api.invoke('git:rebasePlan', { gitDir: record.gitDir, base }).then(
      ({ commits }) => {
        if (!live) return
        setRows(
          commits.map((commit) => ({
            sha: commit.sha,
            subject: commit.subject,
            action: 'pick',
            message: commit.subject
          }))
        )
      },
      (failure: unknown) => {
        if (live) setError(errorText(failure, t))
      }
    )
    return () => {
      live = false
    }
  }, [base, record.gitDir, t])

  const setAction = useCallback((index: number, action: RebaseAction): void => {
    setRows(
      (current) => current?.map((row, rowIndex) => (rowIndex === index ? { ...row, action } : row)) ?? null
    )
  }, [])

  const setMessage = useCallback((index: number, message: string): void => {
    setRows(
      (current) =>
        current?.map((row, rowIndex) => (rowIndex === index ? { ...row, message } : row)) ?? null
    )
  }, [])

  const move = useCallback((index: number, delta: -1 | 1): void => {
    setRows((current) => {
      if (current === null) return null
      const target = index + delta
      if (target < 0 || target >= current.length) return current
      const next = [...current]
      const a = next[index]
      const b = next[target]
      if (a === undefined || b === undefined) return current
      next[index] = b
      next[target] = a
      return next
    })
  }, [])

  const openMenu = (event: MouseEvent<HTMLButtonElement>, index: number): void => {
    event.preventDefault()
    setMenu({ x: event.clientX, y: event.clientY, index })
  }

  const firstActive = rows?.findIndex((row) => row.action !== 'drop') ?? -1
  const invalidFirst =
    rows !== null &&
    firstActive !== -1 &&
    (rows[firstActive]?.action === 'squash' || rows[firstActive]?.action === 'fixup')
  const rewordMissing = rows !== null && rows.some((row) => row.action === 'reword' && row.message.trim() === '')
  const empty = rows !== null && rows.length === 0
  const canRun = rows !== null && !empty && !invalidFirst && !rewordMissing && !busy

  const run = (): void => {
    if (rows === null || !canRun) return
    void (async () => {
      setBusy(true)
      setError(null)
      try {
        const result = await api.invoke('git:rebaseInteractive', {
          gitDir: record.gitDir,
          base,
          steps: rows.map((row) => ({
            sha: row.sha,
            action: row.action,
            ...(row.action === 'reword' ? { message: row.message.trim() } : {})
          }))
        })
        if (result.stopped) {
          notify({ message: t('rebase.stopped'), tone: 'error' })
        } else {
          notifyUndoable(t, record.gitDir, t('rebase.done', { current, onto: base }), result.undo)
        }
        onClose()
      } catch (failure) {
        if (isOperationBlocked(failure)) {
          onClose()
          operations.openBlockedOperation(record)
          return
        }
        setError(errorText(failure, t))
        setBusy(false)
      }
    })()
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-center bg-black/40 pt-16" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('rebase.interactiveTitle', { name: record.name })}
        className="flex max-h-[70vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-line bg-panel shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && menu === null) onClose()
        }}
      >
        <header className="flex items-center gap-2 border-b border-line px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
            {t('rebase.interactiveTitle', { name: record.name })}
          </span>
          <button
            type="button"
            aria-label={t('dialogs.close')}
            className="shrink-0 rounded p-0.5 text-muted hover:bg-ink/5 hover:text-ink"
            onClick={onClose}
          >
            <XIcon className="size-3.5" />
          </button>
        </header>

        <p className="border-b border-line/60 px-3 py-1 text-xs text-muted">
          {t('rebase.interactiveBase', { base })}
        </p>

        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {rows === null && <p className="px-3 py-4 text-center text-sm text-muted">…</p>}
          {empty && <p className="px-3 py-4 text-center text-sm text-muted">{t('rebase.empty')}</p>}
          {rows?.map((row, index) => (
            <div key={row.sha} className="px-2">
              <div className="flex items-center gap-1.5 rounded px-1 py-1 hover:bg-ink/5">
                <span className="w-4 shrink-0 text-right font-mono text-xs text-muted">
                  {index + 1}
                </span>
                <span className="flex shrink-0 flex-col">
                  <button
                    type="button"
                    title={t('rebase.moveUp')}
                    aria-label={t('rebase.moveUp')}
                    disabled={index === 0}
                    className="rounded p-0.5 text-muted hover:bg-ink/10 hover:text-ink disabled:opacity-30"
                    onClick={() => move(index, -1)}
                  >
                    <ChevronRightIcon className="size-3 -rotate-90" />
                  </button>
                  <button
                    type="button"
                    title={t('rebase.moveDown')}
                    aria-label={t('rebase.moveDown')}
                    disabled={rows.length - 1 === index}
                    className="rounded p-0.5 text-muted hover:bg-ink/10 hover:text-ink disabled:opacity-30"
                    onClick={() => move(index, 1)}
                  >
                    <ChevronRightIcon className="size-3 rotate-90" />
                  </button>
                </span>
                <button
                  type="button"
                  className={`w-20 shrink-0 rounded border px-1 py-0.5 text-xs hover:bg-ink/5 ${
                    row.action === 'drop'
                      ? 'border-line text-muted'
                      : row.action === 'pick'
                        ? 'border-line text-ink'
                        : 'border-accent/40 text-accent'
                  }`}
                  onClick={(event) => openMenu(event, index)}
                >
                  {t(`rebase.actions.${row.action}`)}
                </button>
                <span className="shrink-0 font-mono text-xs text-muted">{row.sha.slice(0, 7)}</span>
                <span
                  className={`min-w-0 flex-1 truncate text-sm ${
                    row.action === 'drop' ? 'text-muted line-through' : 'text-ink'
                  }`}
                  title={row.subject}
                >
                  {row.subject}
                </span>
              </div>
              {row.action === 'reword' && (
                <textarea
                  value={row.message}
                  rows={2}
                  aria-label={t('rebase.messageLabel')}
                  placeholder={row.subject}
                  className="mb-1 ml-12 w-[calc(100%-3.5rem)] resize-y rounded border border-line bg-canvas px-2 py-1 font-mono text-xs text-ink outline-none focus:border-accent"
                  onChange={(event) => setMessage(index, event.target.value)}
                />
              )}
            </div>
          ))}
        </div>

        {(invalidFirst || rewordMissing) && (
          <p className="border-t border-line px-3 py-1 text-xs text-warn">
            {invalidFirst ? t('rebase.firstStepHint') : t('rebase.invalidRequest')}
          </p>
        )}
        {error !== null && (
          <p className="border-t border-line px-3 py-1 text-xs break-words text-danger">{error}</p>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-line px-3 py-2">
          <button
            type="button"
            className="rounded px-3 py-1 text-sm text-muted hover:bg-ink/5 hover:text-ink"
            onClick={onClose}
          >
            {t('dialogs.cancel')}
          </button>
          <button
            type="button"
            disabled={!canRun}
            className="rounded bg-accent px-3 py-1 text-sm text-white hover:opacity-90 disabled:opacity-50"
            onClick={run}
          >
            {rows === null || empty
              ? t('rebase.run')
              : t('rebase.runCount', { count: rows.length })}
          </button>
        </div>
      </div>

      {menu !== null && rows !== null && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={ACTIONS.map((action) => ({
            label: `${t(`rebase.actions.${action}`)} — ${t(`rebase.actionHints.${action}`)}`,
            onSelect: () => setAction(menu.index, action)
          }))}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}

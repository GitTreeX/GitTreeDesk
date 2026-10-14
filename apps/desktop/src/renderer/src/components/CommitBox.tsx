import { useCallback, useEffect, useRef, useState, type JSX, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { HeadCommit, RepoRecord, RepoStatus } from '@gitreedesk/shared'
import { api } from '../api'
import { useOperations } from '../contexts/operations-context'
import { notify } from '../notify'
import { ConfirmDialog } from './ConfirmDialog'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'
import { ChevronRightIcon } from './icons'

const OUTPUT_LIMIT = 40_000

type AmendVariant = 'keep' | 'edit' | 'include'

type PushedAsk = { kind: 'variant'; variant: AmendVariant; head: HeadCommit } | { kind: 'primary' }

export function CommitBox({
  record,
  status,
  trusted
}: {
  record: RepoRecord
  status: RepoStatus | null
  trusted: boolean
}): JSX.Element | null {
  const { t } = useTranslation()
  const operations = useOperations()
  const [message, setMessage] = useState('')
  const [signOff, setSignOff] = useState(false)
  const [amendSha, setAmendSha] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [output, setOutput] = useState<readonly string[]>([])
  const [outputOpen, setOutputOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [pushedAsk, setPushedAsk] = useState<PushedAsk | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const runningRef = useRef(false)

  const gitDir = record.gitDir

  useEffect(() => {
    return api.on('git:commitOutput', (event) => {
      if (event.gitDir !== gitDir) return
      setOutput((current) => {
        const next = [...current, event.chunk]
        let total = next.reduce((sum, part) => sum + part.length, 0)
        while (next.length > 1 && total > OUTPUT_LIMIT) {
          const removed = next.shift()
          total -= removed?.length ?? 0
        }
        return next
      })
    })
  }, [gitDir])

  useEffect(() => {
    const element = textareaRef.current
    if (element === null) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, 160)}px`
  }, [message])

  const run = useCallback(
    async (input: { message: string; amend: boolean; stageAll: boolean; push?: boolean }): Promise<void> => {
      if (runningRef.current) return
      runningRef.current = true
      setRunning(true)
      setError(null)
      setOutput([])
      setOutputOpen(true)
      try {
        const { sha } = await api.invoke('git:commit', {
          gitDir,
          message: input.message,
          ...(signOff ? { signOff: true } : {}),
          ...(input.amend ? { amend: true } : {}),
          ...(input.stageAll ? { stageAll: true } : {})
        })
        if (input.message.trim().length > 0) setMessage('')
        setAmendSha(null)
        setOutputOpen(false)
        setOutput([])
        notify({ message: t('commit.done', { sha: sha.slice(0, 7) }) })
        if (input.push === true && status !== null && status.head.ref !== null) {
          operations.pushBranch(record, status.head.ref, { hasUpstream: status.upstream !== null })
        }
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : String(failure))
        setOutputOpen(true)
      } finally {
        runningRef.current = false
        setRunning(false)
      }
    },
    [gitDir, operations, record, signOff, status, t]
  )

  const applyAmend = useCallback(
    (variant: AmendVariant, head: HeadCommit): void => {
      if (variant === 'edit') {
        setMessage(head.message)
        setAmendSha(head.sha)
        return
      }
      void run({ message: '', amend: true, stageAll: variant === 'include' })
    },
    [run]
  )

  const beginAmend = useCallback(
    async (variant: AmendVariant): Promise<void> => {
      if (runningRef.current) return
      try {
        const info = await api.invoke('git:headCommit', { gitDir })
        if (info.commit === null) return
        if (info.pushed) {
          setPushedAsk({ kind: 'variant', variant, head: info.commit })
          return
        }
        applyAmend(variant, info.commit)
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : String(failure))
      }
    },
    [applyAmend, gitDir]
  )

  const primary = useCallback(async (): Promise<void> => {
    if (runningRef.current || message.trim().length === 0) return
    if (amendSha !== null) {
      try {
        const info = await api.invoke('git:headCommit', { gitDir })
        if (info.pushed) {
          setPushedAsk({ kind: 'primary' })
          return
        }
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : String(failure))
        return
      }
      void run({ message, amend: true, stageAll: false })
      return
    }
    if ((status?.staged.length ?? 0) === 0) {
      notify({ message: t('commit.nothingStaged') })
      return
    }
    void run({ message, amend: false, stageAll: false })
  }, [amendSha, gitDir, message, run, status, t])

  const confirmPushed = useCallback((): void => {
    const ask = pushedAsk
    setPushedAsk(null)
    if (ask === null) return
    if (ask.kind === 'primary') void run({ message, amend: true, stageAll: false })
    else applyAmend(ask.variant, ask.head)
  }, [applyAmend, message, pushedAsk, run])

  if (record.kind === 'bare') return null

  const conflicted = (status?.conflicted.length ?? 0) > 0
  const operating = status !== null && status.operation !== 'none'
  const blocked = conflicted || operating
  const unborn = status?.head.unborn === true
  const canRun = !blocked && !running
  const canPrimary = canRun && message.trim().length > 0

  const menuItems: ContextMenuItem[] = [
    { label: t('commit.menuCommit'), disabled: !canPrimary, onSelect: () => void primary() },
    {
      label: t('commit.commitAndPush'),
      disabled: !canPrimary || amendSha !== null || (status?.staged.length ?? 0) === 0,
      onSelect: () => void run({ message, amend: false, stageAll: false, push: true })
    },
    {
      label: t('commit.stageAllCommit'),
      disabled: !canPrimary,
      onSelect: () => void run({ message, amend: false, stageAll: true })
    },
    {
      label: t('commit.amendKeep'),
      disabled: !canRun || unborn,
      onSelect: () => void beginAmend('keep')
    },
    {
      label: t('commit.amendEdit'),
      disabled: !canRun || unborn,
      onSelect: () => void beginAmend('edit')
    },
    {
      label: t('commit.amendInclude'),
      disabled: !canRun || unborn,
      onSelect: () => void beginAmend('include')
    }
  ]

  return (
    <div className="shrink-0 border-t border-line/60 bg-panel px-2 py-1.5">
      <textarea
        ref={textareaRef}
        rows={2}
        value={message}
        disabled={!canRun}
        aria-label={t('commit.messagePlaceholder')}
        placeholder={t('commit.messagePlaceholder')}
        className="max-h-40 w-full resize-none rounded border border-line bg-canvas px-2 py-1 text-sm text-ink placeholder:text-muted focus:border-accent/60 focus:outline-none disabled:opacity-60"
        onChange={(event) => setMessage(event.target.value)}
        onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault()
            void primary()
          }
        }}
      />
      <div className="mt-1 flex items-center gap-1">
        <button
          type="button"
          aria-pressed={signOff}
          title={t('commit.signOffTitle')}
          disabled={!canRun}
          className={`whitespace-nowrap rounded border px-1.5 py-0.5 text-xs ${
            signOff
              ? 'border-accent/60 bg-accent/15 text-ink'
              : 'border-line text-muted hover:bg-ink/5 hover:text-ink'
          } disabled:opacity-60`}
          onClick={() => setSignOff((current) => !current)}
        >
          {t('commit.signOff')}
        </button>
        {amendSha !== null && (
          <span className="flex min-w-0 items-center gap-1 rounded border border-accent/60 bg-accent/15 px-1.5 py-0.5 text-xs text-ink">
            <span className="min-w-0 truncate">
              {t('commit.amending', { sha: amendSha.slice(0, 7) })}
            </span>
            <button
              type="button"
              title={t('commit.cancelAmend')}
              aria-label={t('commit.cancelAmend')}
              className="shrink-0 rounded px-0.5 text-muted hover:text-ink"
              onClick={() => setAmendSha(null)}
            >
              ✕
            </button>
          </span>
        )}
        <span className="min-w-0 flex-1" />
        <div className="flex shrink-0">
          <button
            type="button"
            disabled={!canPrimary}
            className="rounded-l bg-accent px-2.5 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
            onClick={() => void primary()}
          >
            {amendSha !== null ? t('commit.amendAction') : t('commit.action')}
          </button>
          <button
            type="button"
            aria-label={t('commit.menu')}
            aria-haspopup="menu"
            disabled={!canRun}
            className="rounded-r border-l border-white/25 bg-accent px-1 py-1 text-white hover:opacity-90 disabled:opacity-50"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect()
              setMenu({ x: rect.right, y: rect.bottom + 4 })
            }}
          >
            <ChevronRightIcon className="size-3.5 rotate-90" />
          </button>
        </div>
      </div>

      {!trusted && (
        <p className="mt-1 flex items-center gap-1 text-xs text-warn" title={t('commit.hooksDisabledTitle')}>
          <span aria-hidden="true">⚠</span>
          <span className="min-w-0 truncate">{t('commit.hooksDisabled')}</span>
        </p>
      )}
      {blocked && (
        <p className="mt-1 text-xs text-warn">
          {conflicted
            ? t('commit.conflictHint')
            : t('commit.operationHint', {
                operation: status?.operation !== undefined && status.operation !== 'none' ? t(`scm.operation.${status.operation}`) : ''
              })}
        </p>
      )}
      {error !== null && <p className="mt-1 text-xs break-words text-danger">{error}</p>}

      {outputOpen && (
        <div className="mt-1 rounded border border-line bg-canvas">
          <div className="flex items-center gap-1 border-b border-line/60 px-2 py-0.5">
            <span className="text-xs font-semibold text-muted">{t('commit.outputTitle')}</span>
            <span className="min-w-0 flex-1" />
            <button
              type="button"
              aria-label={t('dialogs.close')}
              className="rounded px-1 text-xs text-muted hover:text-ink"
              onClick={() => setOutputOpen(false)}
            >
              ✕
            </button>
          </div>
          <pre className="max-h-40 overflow-auto px-2 py-1 font-mono text-[11px] whitespace-pre-wrap text-muted">
            {output.join('')}
          </pre>
        </div>
      )}

      {menu !== null && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />
      )}
      {pushedAsk !== null && (
        <ConfirmDialog
          title={t('commit.amendPushedTitle')}
          body={t('commit.amendPushedBody')}
          confirmLabel={t('commit.amendPushedConfirm')}
          danger
          onConfirm={confirmPushed}
          onClose={() => setPushedAsk(null)}
        />
      )}
    </div>
  )
}

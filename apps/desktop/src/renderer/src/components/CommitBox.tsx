import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { CommitDraftVariant, HeadCommit, RepoRecord, RepoStatus } from '@gitreedesk/shared'
import { api } from '../api'
import { useCommands } from '../contexts/commands'
import { useOperations } from '../contexts/operations-context'
import { useTreeUi, type CommitActions } from '../contexts/tree'
import { errorText } from '../lib/reporting'
import { notify } from '../notify'
import { ConfirmDialog } from './ConfirmDialog'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'
import { ChevronRightIcon } from './icons'

const OUTPUT_LIMIT = 40_000

type AmendVariant = 'keep' | 'edit' | 'include'

type GeneratePhase = 'idle' | 'preparing' | 'streaming'

type PushedAsk = { kind: 'variant'; variant: AmendVariant; head: HeadCommit } | { kind: 'primary' }

interface DraftState {
  variants: readonly CommitDraftVariant[]
  active: number
}

interface StreamState {
  generationId: string
  buffer: string
  edited: boolean
}

function firstLine(text: string): string {
  const [line = ''] = text.split('\n')
  return line
}

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
  const tree = useTreeUi()
  const { keybindings } = useCommands()
  const [message, setMessage] = useState('')
  const [signOff, setSignOff] = useState(false)
  const [amendSha, setAmendSha] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [output, setOutput] = useState<readonly string[]>([])
  const [outputOpen, setOutputOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [pushedAsk, setPushedAsk] = useState<PushedAsk | null>(null)
  const [genPhase, setGenPhase] = useState<GeneratePhase>('idle')
  const [drafts, setDrafts] = useState<DraftState | null>(null)
  const [hostAsk, setHostAsk] = useState<string | null>(null)
  const [replaceAsk, setReplaceAsk] = useState<{ run: () => void } | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const runningRef = useRef(false)
  /** The box content the generator wrote; anything else counts as typed by the user. */
  const ownedRef = useRef('')
  const streamRef = useRef<StreamState | null>(null)
  const messageRef = useRef('')
  messageRef.current = message

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

  const applyText = useCallback((text: string): void => {
    ownedRef.current = text
    setMessage(text)
  }, [])

  /** Shows the variants; `keepText` leaves text the user touched untouched. */
  const applyVariants = useCallback(
    (variants: readonly CommitDraftVariant[], keepText: boolean): void => {
      const first = variants[0]
      if (first === undefined) {
        setDrafts(null)
        return
      }
      const found = variants.findIndex((variant) => variant.primary)
      const active = found >= 0 ? found : 0
      setDrafts({ variants, active })
      if (!keepText) applyText(variants[active]?.message ?? first.message)
    },
    [applyText]
  )

  const beginGenerate = useCallback(async (): Promise<void> => {
    if (runningRef.current || streamRef.current !== null) return
    setGenPhase('preparing')
    setError(null)
    try {
      const response = await api.invoke('commitmsg:generate', { gitDir })
      const current = messageRef.current
      const edited = current.trim().length > 0 && current !== ownedRef.current
      if (response.source === 'llm' && response.generationId !== null) {
        if (!edited) {
          ownedRef.current = ''
          setMessage('')
        }
        setDrafts(null)
        streamRef.current = { generationId: response.generationId, buffer: '', edited }
        setGenPhase('streaming')
        return
      }
      applyVariants(response.drafts, edited)
      setGenPhase('idle')
      if (response.llm !== null && !response.llm.approved) setHostAsk(response.llm.host)
    } catch (failure) {
      setGenPhase('idle')
      setError(errorText(failure, t))
    }
  }, [applyVariants, gitDir, t])

  useEffect(() => {
    const offOutput = api.on('commitmsg:output', (event) => {
      const stream = streamRef.current
      if (event.gitDir !== gitDir || stream === null || event.generationId !== stream.generationId) {
        return
      }
      stream.buffer += event.chunk
      if (stream.edited) return
      ownedRef.current = stream.buffer
      setMessage(stream.buffer)
    })
    const offDone = api.on('commitmsg:done', (event) => {
      const stream = streamRef.current
      if (event.gitDir !== gitDir || stream === null || event.generationId !== stream.generationId) {
        return
      }
      streamRef.current = null
      setGenPhase('idle')
      if (event.status === 'complete') {
        if (!stream.edited && event.message !== undefined) applyText(event.message)
        return
      }
      if (event.status === 'fallback') {
        applyVariants(event.drafts ?? [], stream.edited)
        notify({
          message:
            event.reason === 'timeout'
              ? t('commit.generate.timeoutFallback')
              : t('commit.generate.networkFallback')
        })
        return
      }
      if (event.status === 'failed') setError(event.error ?? t('commit.generate.failed'))
    })
    return () => {
      offOutput()
      offDone()
    }
  }, [applyText, applyVariants, gitDir, t])

  const selectVariant = useCallback(
    (index: number): void => {
      if (drafts === null) return
      const variant = drafts.variants[index]
      if (variant === undefined) return
      const apply = (): void => {
        applyText(variant.message)
        setDrafts({ variants: drafts.variants, active: index })
      }
      if (message.trim().length > 0 && message !== ownedRef.current) setReplaceAsk({ run: apply })
      else apply()
    },
    [applyText, drafts, message]
  )

  const onGenerateClick = useCallback((): void => {
    if (genPhase === 'streaming') {
      const stream = streamRef.current
      if (stream !== null) void api.invoke('commitmsg:cancel', { generationId: stream.generationId })
      return
    }
    if (genPhase !== 'idle' || runningRef.current) return
    if (message.trim().length > 0 && message !== ownedRef.current) {
      setReplaceAsk({ run: () => void beginGenerate() })
      return
    }
    void beginGenerate()
  }, [beginGenerate, genPhase, message])

  const approveHost = useCallback((): void => {
    const host = hostAsk
    setHostAsk(null)
    if (host === null) return
    void (async () => {
      try {
        await api.invoke('commitmsg:approveHost', { host })
        await beginGenerate()
      } catch (failure) {
        setError(errorText(failure, t))
      }
    })()
  }, [beginGenerate, hostAsk, t])

  const confirmReplace = useCallback((): void => {
    const ask = replaceAsk
    setReplaceAsk(null)
    ask?.run()
  }, [replaceAsk])

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
        ownedRef.current = ''
        setDrafts(null)
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
        ownedRef.current = ''
        setDrafts(null)
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
    if (runningRef.current || genPhase !== 'idle' || message.trim().length === 0) return
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
  }, [amendSha, genPhase, gitDir, message, run, status, t])

  // While the message box is focused it serves the commit command from the keyboard.
  const primaryRef = useRef(primary)
  const canPrimaryRef = useRef(false)
  const commitActions = useMemo<CommitActions>(
    () => ({
      canCommit: () => canPrimaryRef.current,
      commit: () => void primaryRef.current()
    }),
    []
  )

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
  const streaming = genPhase === 'streaming'
  const generating = genPhase !== 'idle'
  const stagedCount = status?.staged.length ?? 0
  const canEdit = !blocked && !running
  const canRun = canEdit && !generating
  const canPrimary = canRun && message.trim().length > 0
  const commitShortcut = keybindings.formatFor('commit.commitStaged')
  primaryRef.current = primary
  canPrimaryRef.current = canPrimary
  const generateDisabled =
    running || genPhase === 'preparing' || (genPhase === 'idle' && (blocked || stagedCount === 0))

  const menuItems: ContextMenuItem[] = [
    { label: t('commit.menuCommit'), disabled: !canPrimary, onSelect: () => void primary() },
    {
      label: t('commit.commitAndPush'),
      disabled: !canPrimary || amendSha !== null || stagedCount === 0,
      onSelect: () => void run({ message, amend: false, stageAll: false, push: true })
    },
    {
      label: t('commit.stageAllCommit'),
      disabled: !canPrimary,
      onSelect: () => void run({ message, amend: false, stageAll: true })
    },
    {
      label: t('commit.amendKeep'),
      divider: true,
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
        disabled={!canEdit}
        aria-label={t('commit.messagePlaceholderPlain')}
        placeholder={
          commitShortcut === null
            ? t('commit.messagePlaceholderPlain')
            : t('commit.messagePlaceholder', { shortcut: commitShortcut })
        }
        className="max-h-40 w-full resize-none rounded border border-line bg-canvas px-2 py-1 text-sm text-ink placeholder:text-muted focus:border-accent/60 focus:outline-none disabled:opacity-60"
        onChange={(event) => {
          if (streamRef.current !== null) streamRef.current.edited = true
          setMessage(event.target.value)
        }}
        onFocus={() => {
          tree.commitActions.current = commitActions
        }}
        onBlur={() => {
          if (tree.commitActions.current === commitActions) tree.commitActions.current = null
        }}
      />
      {drafts !== null && drafts.variants.length > 1 && genPhase === 'idle' && (
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <span className="shrink-0 text-xs text-muted">{t('commit.generate.variants')}</span>
          {drafts.variants.map((variant, index) => (
            <button
              key={`${index}:${variant.message}`}
              type="button"
              title={variant.message}
              disabled={running || blocked}
              className={`max-w-56 truncate rounded border px-1.5 py-0.5 text-xs disabled:opacity-60 ${
                index === drafts.active
                  ? 'border-accent/60 bg-accent/15 text-ink'
                  : 'border-line text-muted hover:bg-ink/5 hover:text-ink'
              }`}
              onClick={() => selectVariant(index)}
            >
              {firstLine(variant.message)}
            </button>
          ))}
        </div>
      )}
      <div className="mt-1 flex items-center gap-1">
        <button
          type="button"
          title={streaming ? t('commit.generate.cancel') : t('commit.generate.action')}
          aria-label={streaming ? t('commit.generate.cancel') : t('commit.generate.action')}
          disabled={generateDisabled}
          className={`whitespace-nowrap rounded border px-1.5 py-0.5 text-xs ${
            generating
              ? 'border-accent/60 bg-accent/15 text-ink'
              : 'border-line text-muted hover:bg-ink/5 hover:text-ink'
          } disabled:opacity-60`}
          onClick={onGenerateClick}
        >
          {streaming ? '■' : genPhase === 'preparing' ? '⋯' : '✨'}
        </button>
        <button
          type="button"
          aria-pressed={signOff}
          title={t('commit.signOffTitle')}
          disabled={!canEdit}
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
      {replaceAsk !== null && (
        <ConfirmDialog
          title={t('commit.generate.replaceTitle')}
          body={t('commit.generate.replaceBody')}
          confirmLabel={t('commit.generate.replaceConfirm')}
          danger
          onConfirm={confirmReplace}
          onClose={() => setReplaceAsk(null)}
        />
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
      {hostAsk !== null && (
        <ConfirmDialog
          title={t('commit.generate.hostTitle', { host: hostAsk })}
          body={t('commit.generate.hostBody', { host: hostAsk })}
          confirmLabel={t('commit.generate.hostConfirm')}
          onConfirm={approveHost}
          onClose={() => setHostAsk(null)}
        />
      )}
    </div>
  )
}

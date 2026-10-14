import { useCallback, useMemo, useRef, useState, type JSX, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { GitBatchResult, RepoRecord } from '@gitreedesk/shared'
import { BranchPicker } from '../components/BranchPicker'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { CreateBranchDialog } from '../components/CreateBranchDialog'
import { RemotesDialog } from '../components/RemotesDialog'
import { TagsDialog } from '../components/TagsDialog'
import { api } from '../api'
import { errorText, isRejectedPush, notifyServiceError, stashNotice } from '../lib/reporting'
import { notify } from '../notify'
import { useUiState } from '../use-ui-state'
import {
  OperationsContext,
  type FetchOptions,
  type OperationsValue,
  type OutputEntry
} from './operations-context'

type DialogState =
  | { kind: 'branches'; record: RepoRecord }
  | { kind: 'createBranch'; record: RepoRecord; startPoint?: string; initialName?: string }
  | { kind: 'remotes'; record: RepoRecord }
  | { kind: 'tags'; record: RepoRecord }

interface PushAsk {
  /** `publish` sets the upstream; `force1`/`force2` are the two force confirmations. */
  phase: 'publish' | 'force1' | 'force2'
  record: RepoRecord
  branch: string
  remote: string
}

interface PushRunOptions {
  remote: string
  setUpstream: boolean
  forceWithLease: boolean
}

function sanitizeBoolean(stored: unknown): boolean | null {
  return typeof stored === 'boolean' ? stored : null
}

/** One entry per repository; worktrees of the same repository share their refs. */
function dedupeRepositories(records: readonly RepoRecord[]): RepoRecord[] {
  const seen = new Map<string, RepoRecord>()
  for (const record of records) {
    if (record.gitDir.length === 0) continue
    const current = seen.get(record.id)
    if (current === undefined || (current.kind === 'worktree' && record.kind !== 'worktree')) {
      seen.set(record.id, record)
    }
  }
  return [...seen.values()]
}

function dedupeCheckouts(records: readonly RepoRecord[]): RepoRecord[] {
  const seen = new Set<string>()
  const unique: RepoRecord[] = []
  for (const record of records) {
    if (record.gitDir.length === 0 || seen.has(record.gitDir)) continue
    seen.add(record.gitDir)
    unique.push(record)
  }
  return unique
}

/**
 * Owns the Git operation dialogs, the fetch/pull batch summaries and the push
 * confirmation flow. Every surface (palette, menus, status bar, SCM) reaches
 * these operations through here so the behavior stays identical everywhere.
 */
export function OperationsProvider({ children }: { children: ReactNode }): JSX.Element {
  const { t } = useTranslation()
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [pushAsk, setPushAsk] = useState<PushAsk | null>(null)
  const [output, setOutput] = useState<readonly OutputEntry[]>([])
  const [outputOpen, setOutputOpen] = useUiState<boolean>('output.open', false, sanitizeBoolean)
  const [prune, setPrune] = useUiState<boolean>('fetch.prune', true, sanitizeBoolean)
  const [followTags, setFollowTags] = useUiState<boolean>('fetch.followTags', false, sanitizeBoolean)
  const nextEntryId = useRef(1)
  const pushRef = useRef(false)

  const fetchOptions = useMemo<FetchOptions>(() => ({ prune, followTags }), [prune, followTags])

  const setFetchOptions = useCallback(
    (next: FetchOptions) => {
      setPrune(next.prune)
      setFollowTags(next.followTags)
    },
    [setPrune, setFollowTags]
  )

  const openBranches = useCallback((record: RepoRecord) => setDialog({ kind: 'branches', record }), [])
  const openRemotes = useCallback((record: RepoRecord) => setDialog({ kind: 'remotes', record }), [])
  const openTags = useCallback((record: RepoRecord) => setDialog({ kind: 'tags', record }), [])
  const openCreateBranch = useCallback(
    (record: RepoRecord, options?: { startPoint?: string; initialName?: string }) =>
      setDialog({ kind: 'createBranch', record, ...options }),
    []
  )
  const closeDialog = useCallback(() => setDialog(null), [])
  const clearOutput = useCallback(() => setOutput([]), [])

  const startEntry = useCallback(
    (title: string, records: readonly RepoRecord[]): number => {
      const id = nextEntryId.current
      nextEntryId.current += 1
      const entry: OutputEntry = {
        id,
        title,
        done: false,
        lines: records.map((record) => ({
          key: record.gitDir,
          name: record.name,
          state: 'running',
          error: null,
          output: '',
          stash: null
        }))
      }
      setOutput((current) => [entry, ...current])
      setOutputOpen(true)
      return id
    },
    [setOutputOpen]
  )

  const applyResults = useCallback((id: number, results: readonly GitBatchResult[]): void => {
    setOutput((current) =>
      current.map((entry) => {
        if (entry.id !== id) return entry
        return {
          ...entry,
          done: true,
          lines: entry.lines.map((line) => {
            const result = results.find((candidate) => candidate.gitDir === line.key)
            if (result === undefined) return line
            return result.ok
              ? { ...line, state: result.updated ? 'updated' : 'uptodate', output: result.output, stash: result.stash }
              : { ...line, state: 'failed', error: result.error, output: result.output, stash: result.stash }
          })
        }
      })
    )
  }, [])

  const failEntry = useCallback(
    (id: number, failure: unknown): void => {
      const message = errorText(failure, t)
      setOutput((current) =>
        current.map((entry) =>
          entry.id === id
            ? {
                ...entry,
                done: true,
                lines: entry.lines.map((line) => ({ ...line, state: 'failed', error: message }))
              }
            : entry
        )
      )
    },
    [t]
  )

  const fetchRepos = useCallback(
    (records: readonly RepoRecord[]) => {
      const targets = dedupeRepositories(records)
      const first = targets[0]
      if (first === undefined) return
      const request = {
        ...(prune ? { prune: true } : {}),
        ...(followTags ? { followTags: true } : {})
      }
      if (targets.length === 1) {
        void (async () => {
          try {
            const result = await api.invoke('git:fetch', { gitDir: first.gitDir, ...request })
            notify({
              message: `${first.name}: ${t('remotes.fetchedFrom', { remote: result.remote })} · ${
                result.updated ? t('sync.updated') : t('sync.upToDate')
              }`
            })
          } catch (failure) {
            notifyServiceError(failure, t)
          }
        })()
        return
      }
      const id = startEntry(t('output.fetchTitle', { count: targets.length }), targets)
      void (async () => {
        try {
          const { results } = await api.invoke('git:fetchMany', {
            gitDirs: targets.map((record) => record.gitDir),
            ...request
          })
          applyResults(id, results)
        } catch (failure) {
          failEntry(id, failure)
        }
      })()
    },
    [applyResults, failEntry, followTags, prune, startEntry, t]
  )

  const pullRepos = useCallback(
    (records: readonly RepoRecord[]) => {
      const targets = dedupeCheckouts(records)
      const first = targets[0]
      if (first === undefined) return
      if (targets.length === 1) {
        void (async () => {
          try {
            const result = await api.invoke('git:pull', { gitDir: first.gitDir })
            notify({
              message: result.updated
                ? t('sync.pulled', { name: first.name })
                : t('sync.alreadyUpToDate', { name: first.name })
            })
            const notice = stashNotice(result.stash, t)
            if (notice !== null) {
              notify({ message: notice, tone: result.stash.stashConflict ? 'error' : 'info' })
            }
          } catch (failure) {
            notifyServiceError(failure, t)
          }
        })()
        return
      }
      const id = startEntry(t('output.pullTitle', { count: targets.length }), targets)
      void (async () => {
        try {
          const { results } = await api.invoke('git:pullMany', {
            gitDirs: targets.map((record) => record.gitDir)
          })
          applyResults(id, results)
        } catch (failure) {
          failEntry(id, failure)
        }
      })()
    },
    [applyResults, failEntry, startEntry, t]
  )

  const runPush = useCallback(
    async (record: RepoRecord, branch: string, options: PushRunOptions): Promise<void> => {
      if (pushRef.current) return
      pushRef.current = true
      try {
        await api.invoke('git:push', {
          gitDir: record.gitDir,
          branch,
          remote: options.remote,
          ...(options.setUpstream ? { setUpstream: true } : {}),
          ...(options.forceWithLease ? { forceWithLease: true } : {})
        })
        notify({
          message: options.forceWithLease
            ? t('sync.forcePushed', { branch, remote: options.remote })
            : options.setUpstream
              ? t('sync.published', { branch, remote: options.remote })
              : t('sync.pushed', { branch, remote: options.remote })
        })
      } catch (failure) {
        if (!options.forceWithLease && isRejectedPush(failure)) {
          setPushAsk({ phase: 'force1', record, branch, remote: options.remote })
          return
        }
        notifyServiceError(failure, t)
      } finally {
        pushRef.current = false
      }
    },
    [t]
  )

  const pushBranch = useCallback(
    (record: RepoRecord, branch: string, options?: { hasUpstream?: boolean }) => {
      void (async () => {
        try {
          const { defaultRemote } = await api.invoke('git:remotes', { gitDir: record.gitDir })
          if (defaultRemote === null) {
            notify({ message: t('sync.noRemote'), tone: 'error' })
            return
          }
          if (options?.hasUpstream === false) {
            setPushAsk({ phase: 'publish', record, branch, remote: defaultRemote })
            return
          }
          await runPush(record, branch, {
            remote: defaultRemote,
            setUpstream: false,
            forceWithLease: false
          })
        } catch (failure) {
          notifyServiceError(failure, t)
        }
      })()
    },
    [runPush, t]
  )

  const value = useMemo<OperationsValue>(
    () => ({
      openBranches,
      openCreateBranch,
      openRemotes,
      openTags,
      closeDialog,
      fetchRepos,
      pullRepos,
      pushBranch,
      fetchOptions,
      setFetchOptions,
      output,
      outputOpen,
      setOutputOpen,
      clearOutput
    }),
    [
      openBranches,
      openCreateBranch,
      openRemotes,
      openTags,
      closeDialog,
      fetchRepos,
      pullRepos,
      pushBranch,
      fetchOptions,
      setFetchOptions,
      output,
      outputOpen,
      setOutputOpen,
      clearOutput
    ]
  )

  return (
    <OperationsContext.Provider value={value}>
      {children}

      {dialog?.kind === 'branches' && (
        <BranchPicker record={dialog.record} onClose={closeDialog} />
      )}
      {dialog?.kind === 'createBranch' && (
        <CreateBranchDialog
          record={dialog.record}
          {...(dialog.startPoint !== undefined ? { initialStartPoint: dialog.startPoint } : {})}
          {...(dialog.initialName !== undefined ? { initialName: dialog.initialName } : {})}
          onClose={closeDialog}
          onCreated={closeDialog}
        />
      )}
      {dialog?.kind === 'remotes' && <RemotesDialog record={dialog.record} onClose={closeDialog} />}
      {dialog?.kind === 'tags' && <TagsDialog record={dialog.record} onClose={closeDialog} />}

      {pushAsk?.phase === 'publish' && (
        <ConfirmDialog
          title={t('sync.publishTitle', { branch: pushAsk.branch })}
          body={t('sync.publishBody', { branch: pushAsk.branch, remote: pushAsk.remote })}
          confirmLabel={t('sync.publishAction')}
          onConfirm={() => {
            const ask = pushAsk
            setPushAsk(null)
            void runPush(ask.record, ask.branch, {
              remote: ask.remote,
              setUpstream: true,
              forceWithLease: false
            })
          }}
          onClose={() => setPushAsk(null)}
        />
      )}
      {pushAsk?.phase === 'force1' && (
        <ConfirmDialog
          title={t('sync.forceTitle', { branch: pushAsk.branch })}
          body={t('sync.forceBody', { branch: pushAsk.branch, remote: pushAsk.remote })}
          confirmLabel={t('sync.forceContinue')}
          danger
          onConfirm={() => setPushAsk({ ...pushAsk, phase: 'force2' })}
          onClose={() => setPushAsk(null)}
        />
      )}
      {pushAsk?.phase === 'force2' && (
        <ConfirmDialog
          title={t('sync.forceFinalTitle')}
          body={t('sync.forceFinalBody', { branch: pushAsk.branch, remote: pushAsk.remote })}
          confirmLabel={t('sync.forceAction')}
          danger
          onConfirm={() => {
            const ask = pushAsk
            setPushAsk(null)
            void runPush(ask.record, ask.branch, {
              remote: ask.remote,
              setUpstream: false,
              forceWithLease: true
            })
          }}
          onClose={() => setPushAsk(null)}
        />
      )}
    </OperationsContext.Provider>
  )
}

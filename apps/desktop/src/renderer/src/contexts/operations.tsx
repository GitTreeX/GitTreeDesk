import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  GitBatchResult,
  GitPushResult,
  GitSubmoduleUpdateResult,
  RepoOperationKind,
  RepoRecord,
  SubmoduleInfo,
  SubmoduleOutputEvent
} from '@gitreedesk/shared'
import { BackupsDialog } from '../components/BackupsDialog'
import { BranchPicker } from '../components/BranchPicker'
import { CommitApplyDialog } from '../components/CommitApplyDialog'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { CreateBranchDialog } from '../components/CreateBranchDialog'
import { CreateTagDialog } from '../components/CreateTagDialog'
import { CreateWorktreeDialog } from '../components/CreateWorktreeDialog'
import { EditCommitsDialog } from '../components/EditCommitsDialog'
import { InteractiveRebaseDialog } from '../components/InteractiveRebaseDialog'
import { MergeDialog } from '../components/MergeDialog'
import { MoveWorktreeDialog } from '../components/MoveWorktreeDialog'
import { PushDialog } from '../components/PushDialog'
import { RemotesDialog } from '../components/RemotesDialog'
import { ResetDialog } from '../components/ResetDialog'
import { StashCreateDialog } from '../components/StashCreateDialog'
import { StashesDialog } from '../components/StashesDialog'
import { SubmoduleAddDialog } from '../components/SubmoduleAddDialog'
import { TagsDialog } from '../components/TagsDialog'
import { api } from '../api'
import {
  errorText,
  isOperationBlocked,
  isRejectedPushText,
  isSubmoduleDirtyRefusal,
  isWorktreeDirtyRefusal,
  notifyServiceError,
  notifyUndoable,
  stashNotice
} from '../lib/reporting'
import { notify, notifyError } from '../notify'
import { useUiState } from '../use-ui-state'
import { useTreeUi } from './tree'
import { useSubmodules } from './submodules'
import { useWorkspace } from './workspace'
import {
  OperationsContext,
  type CommitTarget,
  type FetchOptions,
  type OperationsValue,
  type OutputEntry
} from './operations-context'

type DialogState =
  | { kind: 'branches'; record: RepoRecord }
  | { kind: 'createBranch'; record: RepoRecord; startPoint?: string; initialName?: string }
  | { kind: 'remotes'; record: RepoRecord }
  | { kind: 'tags'; record: RepoRecord }
  | { kind: 'createTag'; record: RepoRecord; target?: string }
  | { kind: 'merge'; record: RepoRecord; branch: string }
  | { kind: 'interactiveRebase'; record: RepoRecord; base: string }
  | { kind: 'cherryPick'; record: RepoRecord; targets: readonly CommitTarget[] }
  | { kind: 'revert'; record: RepoRecord; targets: readonly CommitTarget[] }
  | { kind: 'reset'; record: RepoRecord; target: CommitTarget }
  | { kind: 'editCommits'; record: RepoRecord; targets: readonly CommitTarget[]; pushed: boolean }
  | { kind: 'stashCreate'; record: RepoRecord; paths?: readonly string[] }
  | { kind: 'stashes'; record: RepoRecord }
  | { kind: 'backups'; record: RepoRecord }
  | { kind: 'worktreeCreate'; record: RepoRecord }
  | { kind: 'worktreeMove'; record: RepoRecord }
  | { kind: 'submoduleAdd'; record: RepoRecord }

interface OpAsk {
  /** `abort` confirms aborting; `unresolved` lists conflicts; `blocked` explains a refusal. */
  kind: 'abort' | 'unresolved' | 'blocked'
  record: RepoRecord
  operation: RepoOperationKind
  /** Conflicted paths of the unresolved ask. */
  paths?: readonly string[]
}

interface RebaseAsk {
  record: RepoRecord
  onto: string
}

interface PushAsk {
  /** `select` shows the remote list; `force1`/`force2` are the two force confirmations. */
  phase: 'select' | 'force1' | 'force2'
  record: RepoRecord
  branch: string
  remotes: readonly string[]
  /** The branch had no upstream when the dialog opened, so publishing is offered. */
  publish: boolean
  /** The remote that receives the upstream (`-u`); `null` when tracking is left alone. */
  upstreamRemote: string | null
  /** Preselected remote of the select dialog; `null` when none is configured. */
  defaultRemote: string | null
}

interface PushRunOptions {
  remotes: readonly string[]
  upstreamRemote: string | null
  forceWithLease: boolean
  /** Carried through so a rejected push can offer the force confirmations again. */
  publish: boolean
}

interface WorktreeAsk {
  /** `confirm` removes a clean worktree; `dirty` asks to force-remove one with changes. */
  phase: 'confirm' | 'dirty'
  record: RepoRecord
}

interface SubmoduleAsk {
  /** `confirm` deinits a submodule left alone by its own repository; `dirty` warns about its files. */
  phase: 'confirm' | 'dirty'
  /** The superproject. */
  record: RepoRecord
  /** Repo-relative path of the submodule. */
  path: string
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

/** Output line key of one submodule: its checkout key plus the path inside the repository. */
function submoduleLineKey(gitDir: string, path: string): string {
  return `${gitDir}\u0000${path}`
}

function appendSubmoduleChunk(
  entries: readonly OutputEntry[],
  event: SubmoduleOutputEvent
): readonly OutputEntry[] {
  const key = submoduleLineKey(event.gitDir, event.path)
  let changed = false
  const next = entries.map((entry) => {
    if (entry.done) return entry
    const index = entry.lines.findIndex((line) => line.key === key && line.state === 'running')
    if (index === -1) return entry
    const line = entry.lines[index]
    if (line === undefined) return entry
    const lines = [...entry.lines]
    lines[index] = { ...line, output: line.output + event.chunk }
    changed = true
    return { ...entry, lines }
  })
  return changed ? next : entries
}

/**
 * Owns the Git operation dialogs, the stop/continue banner flows, the fetch/pull
 * batch summaries and the push confirmation flow. Every surface (palette, menus,
 * status bar, SCM) reaches these operations through here so the behavior stays
 * identical everywhere.
 */
export function OperationsProvider({ children }: { children: ReactNode }): JSX.Element {
  const { t } = useTranslation()
  const { descriptor, statuses } = useWorkspace()
  const tree = useTreeUi()
  const { submodulesFor, refresh: refreshSubmodules } = useSubmodules()
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [opAsk, setOpAsk] = useState<OpAsk | null>(null)
  const [rebaseAsk, setRebaseAsk] = useState<RebaseAsk | null>(null)
  const [pushAsk, setPushAsk] = useState<PushAsk | null>(null)
  const [worktreeAsk, setWorktreeAsk] = useState<WorktreeAsk | null>(null)
  const [worktreeFocus, setWorktreeFocus] = useState<string | null>(null)
  const [submoduleAsk, setSubmoduleAsk] = useState<SubmoduleAsk | null>(null)
  const [output, setOutput] = useState<readonly OutputEntry[]>([])
  const [outputOpen, setOutputOpen] = useUiState<boolean>('output.open', false, sanitizeBoolean)
  const [prune, setPrune] = useUiState<boolean>('fetch.prune', true, sanitizeBoolean)
  const [followTags, setFollowTags] = useUiState<boolean>('fetch.followTags', false, sanitizeBoolean)
  const nextEntryId = useRef(1)
  const pushRef = useRef(false)
  const busyOps = useRef<Set<string>>(new Set())

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
  const openCreateTag = useCallback(
    (record: RepoRecord, options?: { target?: string }) =>
      setDialog({ kind: 'createTag', record, ...options }),
    []
  )
  const openCreateBranch = useCallback(
    (record: RepoRecord, options?: { startPoint?: string; initialName?: string }) =>
      setDialog({ kind: 'createBranch', record, ...options }),
    []
  )
  const beginMerge = useCallback(
    (record: RepoRecord, branch: string) => setDialog({ kind: 'merge', record, branch }),
    []
  )
  const beginInteractiveRebase = useCallback(
    (record: RepoRecord, base: string) => setDialog({ kind: 'interactiveRebase', record, base }),
    []
  )
  const openCherryPick = useCallback(
    (record: RepoRecord, targets: readonly CommitTarget[]) =>
      setDialog({ kind: 'cherryPick', record, targets }),
    []
  )
  const openRevert = useCallback(
    (record: RepoRecord, targets: readonly CommitTarget[]) =>
      setDialog({ kind: 'revert', record, targets }),
    []
  )
  const openReset = useCallback(
    (record: RepoRecord, target: CommitTarget) => setDialog({ kind: 'reset', record, target }),
    []
  )
  const openEditCommits = useCallback(
    (record: RepoRecord, targets: readonly CommitTarget[], options?: { pushed?: boolean }) =>
      setDialog({ kind: 'editCommits', record, targets, pushed: options?.pushed === true }),
    []
  )
  const openStashCreate = useCallback(
    (record: RepoRecord, options?: { paths?: readonly string[] }) =>
      setDialog({
        kind: 'stashCreate',
        record,
        ...(options?.paths !== undefined ? { paths: options.paths } : {})
      }),
    []
  )
  const openStashes = useCallback((record: RepoRecord) => setDialog({ kind: 'stashes', record }), [])
  const openBackupRestore = useCallback(
    (record: RepoRecord) => setDialog({ kind: 'backups', record }),
    []
  )
  const openCreateWorktree = useCallback(
    (record: RepoRecord) => setDialog({ kind: 'worktreeCreate', record }),
    []
  )
  const moveWorktree = useCallback((record: RepoRecord) => setDialog({ kind: 'worktreeMove', record }), [])
  const openAddSubmodule = useCallback(
    (record: RepoRecord) => setDialog({ kind: 'submoduleAdd', record }),
    []
  )
  const closeDialog = useCallback(() => setDialog(null), [])
  const clearOutput = useCallback(() => setOutput([]), [])

  const branchOf = useCallback(
    (record: RepoRecord): string => statuses.get(record.gitDir)?.status.head.ref ?? 'HEAD',
    [statuses]
  )
  const operationOf = useCallback(
    (record: RepoRecord): RepoOperationKind =>
      statuses.get(record.gitDir)?.status.operation ?? 'none',
    [statuses]
  )

  /** Serializes write actions per checkout so a double click cannot race git. */
  const acquire = (record: RepoRecord): boolean => {
    if (busyOps.current.has(record.gitDir)) return false
    busyOps.current.add(record.gitDir)
    return true
  }
  const release = (record: RepoRecord): void => {
    busyOps.current.delete(record.gitDir)
  }

  const openBlockedOperation = useCallback(
    (record: RepoRecord) => {
      const operation = operationOf(record)
      if (operation === 'none') {
        notify({ message: t('errors.operationInProgress'), tone: 'error' })
        return
      }
      setOpAsk({ kind: 'blocked', record, operation })
    },
    [operationOf, t]
  )

  const runContinue = useCallback(
    (record: RepoRecord): void => {
      if (!acquire(record)) return
      void (async () => {
        try {
          const result = await api.invoke('git:opContinue', { gitDir: record.gitDir })
          if (result.stopped) {
            notify({ message: t('operation.stoppedAgain'), tone: 'error' })
          } else {
            notifyUndoable(t, record.gitDir, t('operation.finished'), result.undo)
          }
        } catch (failure) {
          notifyServiceError(failure, t)
        } finally {
          release(record)
        }
      })()
    },
    [t]
  )

  const continueOperation = useCallback(
    (record: RepoRecord): void => {
      const conflicted = statuses.get(record.gitDir)?.status.conflicted ?? []
      if (conflicted.length > 0) {
        setOpAsk({
          kind: 'unresolved',
          record,
          operation: operationOf(record),
          paths: conflicted.map((entry) => entry.path)
        })
        return
      }
      runContinue(record)
    },
    [operationOf, runContinue, statuses]
  )

  const skipOperation = useCallback(
    (record: RepoRecord): void => {
      if (!acquire(record)) return
      void (async () => {
        try {
          const result = await api.invoke('git:opSkip', { gitDir: record.gitDir })
          notify({
            message: result.stopped ? t('operation.stoppedAgain') : t('operation.skipped'),
            ...(result.stopped ? { tone: 'error' as const } : {})
          })
        } catch (failure) {
          notifyServiceError(failure, t)
        } finally {
          release(record)
        }
      })()
    },
    [t]
  )

  const abortOperation = useCallback(
    (record: RepoRecord) => {
      setOpAsk({ kind: 'abort', record, operation: operationOf(record) })
    },
    [operationOf]
  )

  const abortNow = useCallback(
    (record: RepoRecord): void => {
      setOpAsk(null)
      if (!acquire(record)) return
      void (async () => {
        try {
          await api.invoke('git:opAbort', { gitDir: record.gitDir })
          notify({ message: t('operation.aborted') })
        } catch (failure) {
          notifyServiceError(failure, t)
        } finally {
          release(record)
        }
      })()
    },
    [t]
  )

  const rebaseOnto = useCallback((record: RepoRecord, onto: string) => {
    setRebaseAsk({ record, onto })
  }, [])

  const runWorktreeRemove = useCallback(
    (record: RepoRecord, force: boolean): void => {
      if (!acquire(record)) return
      void (async () => {
        try {
          const result = await api.invoke('git:worktreeRemove', {
            gitDir: record.gitDir,
            path: record.path,
            ...(force ? { force: true } : {})
          })
          notifyUndoable(t, record.gitDir, t('worktree.removed', { name: record.name }), result.undo)
        } catch (failure) {
          if (!force && isWorktreeDirtyRefusal(failure)) {
            setWorktreeAsk({ phase: 'dirty', record })
          } else {
            notifyServiceError(failure, t)
          }
        } finally {
          release(record)
        }
      })()
    },
    [t]
  )

  const removeWorktree = useCallback(
    (record: RepoRecord) => setWorktreeAsk({ phase: 'confirm', record }),
    []
  )

  const pruneWorktrees = useCallback(
    (record: RepoRecord): void => {
      if (!acquire(record)) return
      void (async () => {
        try {
          await api.invoke('git:worktreePrune', { gitDir: record.gitDir })
          notify({ message: t('worktree.pruned') })
        } catch (failure) {
          notifyServiceError(failure, t)
        } finally {
          release(record)
        }
      })()
    },
    [t]
  )

  const setWorktreeLock = useCallback(
    (record: RepoRecord, locked: boolean): void => {
      if (!acquire(record)) return
      void (async () => {
        try {
          if (locked) {
            await api.invoke('git:worktreeLock', { gitDir: record.gitDir, path: record.path })
          } else {
            await api.invoke('git:worktreeUnlock', { gitDir: record.gitDir, path: record.path })
          }
          notify({
            message: locked
              ? t('worktree.locked', { name: record.name })
              : t('worktree.unlocked', { name: record.name })
          })
        } catch (failure) {
          notifyServiceError(failure, t)
        } finally {
          release(record)
        }
      })()
    },
    [t]
  )

  const lockWorktree = useCallback(
    (record: RepoRecord) => setWorktreeLock(record, true),
    [setWorktreeLock]
  )
  const unlockWorktree = useCallback(
    (record: RepoRecord) => setWorktreeLock(record, false),
    [setWorktreeLock]
  )

  // A created worktree reaches the registry asynchronously; reveal its row once it arrives.
  const root = descriptor?.root ?? null
  useEffect(() => {
    if (worktreeFocus === null) return
    const records = descriptor?.records ?? []
    if (!records.some((record) => record.path === worktreeFocus)) return
    tree.requestRepoFocus(worktreeFocus)
    setWorktreeFocus(null)
  }, [worktreeFocus, descriptor, tree])

  useEffect(() => {
    setWorktreeFocus(null)
  }, [root])

  const runRebase = useCallback(
    (record: RepoRecord, onto: string): void => {
      if (!acquire(record)) return
      void (async () => {
        try {
          const result = await api.invoke('git:rebase', { gitDir: record.gitDir, onto })
          if (result.stopped) {
            notify({ message: t('rebase.stopped'), tone: 'error' })
          } else {
            notifyUndoable(
              t,
              record.gitDir,
              t('rebase.done', { current: branchOf(record), onto }),
              result.undo
            )
          }
        } catch (failure) {
          if (isOperationBlocked(failure)) {
            openBlockedOperation(record)
          } else {
            notifyServiceError(failure, t)
          }
        } finally {
          release(record)
        }
      })()
    },
    [branchOf, openBlockedOperation, t]
  )

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

  const startSubmoduleEntry = useCallback(
    (title: string, gitDir: string, submodules: readonly SubmoduleInfo[]): number => {
      const id = nextEntryId.current
      nextEntryId.current += 1
      const entry: OutputEntry = {
        id,
        title,
        done: false,
        lines: submodules.map((submodule) => ({
          key: submoduleLineKey(gitDir, submodule.path),
          name: submodule.path,
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

  const applySubmoduleResults = useCallback(
    (id: number, gitDir: string, results: readonly GitSubmoduleUpdateResult[]): void => {
      setOutput((current) =>
        current.map((entry) => {
          if (entry.id !== id) return entry
          return {
            ...entry,
            done: true,
            lines: entry.lines.map((line) => {
              const result = results.find(
                (candidate) => submoduleLineKey(gitDir, candidate.path) === line.key
              )
              if (result === undefined) return line
              return result.ok
                ? { ...line, state: result.updated ? 'updated' : 'uptodate', output: result.output }
                : { ...line, state: 'failed', error: result.error, output: result.output }
            })
          }
        })
      )
    },
    []
  )

  // Submodule updates stream their output into the running Output panel entry.
  useEffect(() => {
    return api.on('git:submoduleOutput', (event) => {
      setOutput((current) => appendSubmoduleChunk(current, event))
    })
  }, [])

  const updateSubmodules = useCallback(
    (record: RepoRecord): void => {
      const listed = submodulesFor(record)
      if (record.gitDir === '' || record.kind === 'bare' || listed === null) return
      if (listed.length === 0) {
        notify({ message: t('submodule.none') })
        return
      }
      if (!acquire(record)) return
      const id = startSubmoduleEntry(
        t('output.submodulesTitle', { name: record.name }),
        record.gitDir,
        listed
      )
      void (async () => {
        try {
          const { results } = await api.invoke('git:submoduleUpdate', {
            gitDir: record.gitDir,
            init: true,
            recursive: true
          })
          applySubmoduleResults(id, record.gitDir, results)
        } catch (failure) {
          failEntry(id, failure)
        } finally {
          release(record)
          void refreshSubmodules(record.gitDir)
        }
      })()
    },
    [applySubmoduleResults, failEntry, refreshSubmodules, startSubmoduleEntry, submodulesFor, t]
  )

  const updateSubmodule = useCallback(
    (record: RepoRecord, path: string, options?: { init?: boolean }): void => {
      if (record.gitDir === '' || record.kind === 'bare') return
      if (!acquire(record)) return
      void (async () => {
        try {
          const { results } = await api.invoke('git:submoduleUpdate', {
            gitDir: record.gitDir,
            paths: [path],
            ...(options?.init === true ? { init: true } : {})
          })
          const result = results[0]
          if (result === undefined) {
            notifyError(t('submodule.notFound', { name: path }))
          } else if (result.ok) {
            const message =
              options?.init === true
                ? t('submodule.initialized', { name: path })
                : result.updated
                  ? t('submodule.updated', { name: path })
                  : t('submodule.alreadyInSync', { name: path })
            notify({ message })
          } else {
            const details = [result.error, result.output]
              .filter((part): part is string => part !== null && part.length > 0)
              .join('\n')
            if (details.length > 0) notifyError(t('submodule.failed', { name: path }), details)
            else notifyError(t('submodule.failed', { name: path }))
          }
        } catch (failure) {
          notifyServiceError(failure, t)
        } finally {
          release(record)
          void refreshSubmodules(record.gitDir)
        }
      })()
    },
    [refreshSubmodules, t]
  )

  const syncSubmoduleUrls = useCallback(
    (record: RepoRecord): void => {
      if (record.gitDir === '' || record.kind === 'bare') return
      if (!acquire(record)) return
      void (async () => {
        try {
          await api.invoke('git:submoduleSync', { gitDir: record.gitDir })
          notify({ message: t('submodule.synced', { name: record.name }) })
        } catch (failure) {
          notifyServiceError(failure, t)
        } finally {
          release(record)
        }
      })()
    },
    [t]
  )

  const runSubmoduleDeinit = useCallback(
    (record: RepoRecord, path: string, force: boolean): void => {
      if (!acquire(record)) return
      void (async () => {
        try {
          await api.invoke('git:submoduleDeinit', {
            gitDir: record.gitDir,
            paths: [path],
            ...(force ? { force: true } : {})
          })
          notify({ message: t('submodule.deinited', { name: path }) })
        } catch (failure) {
          if (!force && isSubmoduleDirtyRefusal(failure)) {
            setSubmoduleAsk({ phase: 'dirty', record, path })
          } else {
            notifyServiceError(failure, t)
          }
        } finally {
          release(record)
          void refreshSubmodules(record.gitDir)
        }
      })()
    },
    [refreshSubmodules, t]
  )

  const deinitSubmodule = useCallback(
    (record: RepoRecord, path: string) => setSubmoduleAsk({ phase: 'confirm', record, path }),
    []
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
        const { results } = await api.invoke('git:push', {
          gitDir: record.gitDir,
          branch,
          remotes: [...options.remotes],
          ...(options.upstreamRemote !== null ? { upstreamRemote: options.upstreamRemote } : {}),
          ...(options.forceWithLease ? { forceWithLease: true } : {})
        })
        const describe = (list: readonly GitPushResult[]): string => {
          const first = list[0]
          if (list.length === 1 && first !== undefined) {
            return options.forceWithLease
              ? t('sync.forcePushed', { branch, remote: first.remote })
              : options.upstreamRemote === first.remote
                ? t('sync.published', { branch, remote: first.remote })
                : t('sync.pushed', { branch, remote: first.remote })
          }
          return t('sync.pushedMany', { branch, count: list.length })
        }
        const pushed = results.filter((result) => result.ok)
        const failed = results.filter((result) => !result.ok)
        if (failed.length === 0) {
          notify({ message: describe(pushed) })
          return
        }
        for (const result of failed) {
          notifyError(
            result.error ?? t('sync.pushFailed', { remote: result.remote }),
            result.output
          )
        }
        if (pushed.length > 0) notify({ message: describe(pushed) })
        if (
          options.forceWithLease !== true &&
          pushed.length === 0 &&
          failed.every((result) => isRejectedPushText(`${result.error ?? ''}\n${result.output}`))
        ) {
          setPushAsk({
            phase: 'force1',
            record,
            branch,
            remotes: options.remotes,
            publish: options.publish,
            upstreamRemote: options.upstreamRemote,
            defaultRemote: null
          })
        }
      } catch (failure) {
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
          const { remotes, defaultRemote } = await api.invoke('git:remotes', {
            gitDir: record.gitDir
          })
          if (remotes.length === 0) {
            notify({ message: t('sync.noRemote'), tone: 'error' })
            return
          }
          setPushAsk({
            phase: 'select',
            record,
            branch,
            remotes: remotes.map((remote) => remote.name),
            publish: options?.hasUpstream === false,
            upstreamRemote: null,
            defaultRemote
          })
        } catch (failure) {
          notifyServiceError(failure, t)
        }
      })()
    },
    [t]
  )

  const value = useMemo<OperationsValue>(
    () => ({
      openBranches,
      openCreateBranch,
      openRemotes,
      openTags,
      openCreateTag,
      beginMerge,
      rebaseOnto,
      beginInteractiveRebase,
      openCherryPick,
      openRevert,
      openReset,
      openEditCommits,
      openStashCreate,
      openStashes,
      openBackupRestore,
      openCreateWorktree,
      moveWorktree,
      removeWorktree,
      pruneWorktrees,
      lockWorktree,
      unlockWorktree,
      updateSubmodules,
      updateSubmodule,
      syncSubmoduleUrls,
      openAddSubmodule,
      deinitSubmodule,
      continueOperation,
      skipOperation,
      abortOperation,
      openBlockedOperation,
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
      openCreateTag,
      beginMerge,
      rebaseOnto,
      beginInteractiveRebase,
      openCherryPick,
      openRevert,
      openReset,
      openEditCommits,
      openStashCreate,
      openStashes,
      openBackupRestore,
      openCreateWorktree,
      moveWorktree,
      removeWorktree,
      pruneWorktrees,
      lockWorktree,
      unlockWorktree,
      updateSubmodules,
      updateSubmodule,
      syncSubmoduleUrls,
      openAddSubmodule,
      deinitSubmodule,
      continueOperation,
      skipOperation,
      abortOperation,
      openBlockedOperation,
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

  const opLabel = (operation: RepoOperationKind): string => t(`operation.kinds.${operation}`)

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
      {dialog?.kind === 'createTag' && (
        <CreateTagDialog
          record={dialog.record}
          {...(dialog.target !== undefined ? { initialTarget: dialog.target } : {})}
          onClose={closeDialog}
        />
      )}
      {dialog?.kind === 'merge' && (
        <MergeDialog record={dialog.record} branch={dialog.branch} onClose={closeDialog} />
      )}
      {dialog?.kind === 'interactiveRebase' && (
        <InteractiveRebaseDialog record={dialog.record} base={dialog.base} onClose={closeDialog} />
      )}
      {dialog?.kind === 'cherryPick' && (
        <CommitApplyDialog
          record={dialog.record}
          mode="cherry-pick"
          targets={dialog.targets}
          onClose={closeDialog}
        />
      )}
      {dialog?.kind === 'revert' && (
        <CommitApplyDialog
          record={dialog.record}
          mode="revert"
          targets={dialog.targets}
          onClose={closeDialog}
        />
      )}
      {dialog?.kind === 'reset' && (
        <ResetDialog record={dialog.record} target={dialog.target} onClose={closeDialog} />
      )}
      {dialog?.kind === 'editCommits' && (
        <EditCommitsDialog
          record={dialog.record}
          targets={dialog.targets}
          pushed={dialog.pushed}
          onClose={closeDialog}
        />
      )}
      {dialog?.kind === 'stashCreate' && (
        <StashCreateDialog
          record={dialog.record}
          {...(dialog.paths !== undefined ? { paths: dialog.paths } : {})}
          onClose={closeDialog}
        />
      )}
      {dialog?.kind === 'stashes' && <StashesDialog record={dialog.record} onClose={closeDialog} />}
      {dialog?.kind === 'backups' && <BackupsDialog record={dialog.record} onClose={closeDialog} />}
      {dialog?.kind === 'worktreeCreate' && (
        <CreateWorktreeDialog
          record={dialog.record}
          onClose={closeDialog}
          onCreated={(path) => setWorktreeFocus(path)}
        />
      )}
      {dialog?.kind === 'worktreeMove' && (
        <MoveWorktreeDialog
          record={dialog.record}
          onClose={closeDialog}
          onMoved={(path) => setWorktreeFocus(path)}
        />
      )}
      {dialog?.kind === 'submoduleAdd' && (
        <SubmoduleAddDialog record={dialog.record} onClose={closeDialog} />
      )}

      {rebaseAsk !== null && (
        <ConfirmDialog
          title={t('rebase.confirmTitle', {
            current: branchOf(rebaseAsk.record),
            onto: rebaseAsk.onto
          })}
          body={t('rebase.confirmBody', { onto: rebaseAsk.onto })}
          confirmLabel={t('rebase.action')}
          onConfirm={() => {
            const ask = rebaseAsk
            setRebaseAsk(null)
            runRebase(ask.record, ask.onto)
          }}
          onClose={() => setRebaseAsk(null)}
        />
      )}

      {opAsk?.kind === 'abort' && (
        <ConfirmDialog
          title={t('operation.abortTitle', { operation: opLabel(opAsk.operation) })}
          body={t('operation.abortBody')}
          confirmLabel={t('operation.abort')}
          danger
          onConfirm={() => abortNow(opAsk.record)}
          onClose={() => setOpAsk(null)}
        />
      )}

      {opAsk?.kind === 'unresolved' && (
        <div
          className="fixed inset-0 z-40 flex justify-center bg-black/40 pt-32"
          onMouseDown={() => setOpAsk(null)}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            className="h-fit w-full max-w-sm overflow-hidden rounded-lg border border-line bg-panel shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setOpAsk(null)
            }}
          >
            <div className="p-4">
              <h2 className="text-sm font-semibold text-ink">{t('operation.continueBlockedTitle')}</h2>
              <p className="mt-2 text-sm text-muted">
                {t('operation.continueBlockedBody', { count: opAsk.paths?.length ?? 0 })}
              </p>
              <div className="mt-2 max-h-40 overflow-y-auto rounded border border-line/60 bg-canvas">
                {opAsk.paths?.map((path) => (
                  <p key={path} className="truncate px-2 py-0.5 font-mono text-xs text-ink" title={path}>
                    {path}
                  </p>
                ))}
              </div>
            </div>
            <div className="flex justify-end border-t border-line px-3 py-2">
              <button
                type="button"
                className="rounded px-3 py-1 text-sm text-muted hover:bg-ink/5 hover:text-ink"
                onClick={() => setOpAsk(null)}
              >
                {t('dialogs.close')}
              </button>
            </div>
          </div>
        </div>
      )}

      {opAsk?.kind === 'blocked' && (
        <div
          className="fixed inset-0 z-40 flex justify-center bg-black/40 pt-32"
          onMouseDown={() => setOpAsk(null)}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            className="h-fit w-full max-w-sm overflow-hidden rounded-lg border border-line bg-panel shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setOpAsk(null)
            }}
          >
            <div className="p-4">
              <h2 className="text-sm font-semibold text-ink">
                {t('operation.blockedTitle', { operation: opLabel(opAsk.operation) })}
              </h2>
              <p className="mt-2 text-sm text-muted">{t('operation.blockedBody')}</p>
            </div>
            <div className="flex justify-end gap-2 border-t border-line px-3 py-2">
              <button
                type="button"
                className="rounded px-3 py-1 text-sm text-muted hover:bg-ink/5 hover:text-ink"
                onClick={() => setOpAsk(null)}
              >
                {t('dialogs.close')}
              </button>
              <button
                type="button"
                className="rounded border border-danger/40 px-3 py-1 text-sm text-danger hover:bg-danger/10"
                onClick={() => setOpAsk({ ...opAsk, kind: 'abort' })}
              >
                {t('operation.abort')}
              </button>
              <button
                type="button"
                className="rounded bg-accent px-3 py-1 text-sm text-white hover:opacity-90"
                onClick={() => {
                  const ask = opAsk
                  setOpAsk(null)
                  continueOperation(ask.record)
                }}
              >
                {t('operation.continue')}
              </button>
            </div>
          </div>
        </div>
      )}

      {pushAsk?.phase === 'select' && (
        <PushDialog
          branch={pushAsk.branch}
          remotes={pushAsk.remotes}
          defaultRemote={pushAsk.defaultRemote}
          publish={pushAsk.publish}
          onConfirm={({ remotes, publish }) => {
            const ask = pushAsk
            setPushAsk(null)
            void runPush(ask.record, ask.branch, {
              remotes,
              upstreamRemote: publish ? (remotes[0] ?? null) : null,
              forceWithLease: false,
              publish: ask.publish
            })
          }}
          onClose={() => setPushAsk(null)}
        />
      )}
      {pushAsk?.phase === 'force1' && (
        <ConfirmDialog
          title={t('sync.forceTitle', { branch: pushAsk.branch })}
          body={t('sync.forceBody', {
            branch: pushAsk.branch,
            remote: pushAsk.remotes.join(', ')
          })}
          confirmLabel={t('sync.forceContinue')}
          danger
          onConfirm={() => setPushAsk({ ...pushAsk, phase: 'force2' })}
          onClose={() => setPushAsk(null)}
        />
      )}
      {pushAsk?.phase === 'force2' && (
        <ConfirmDialog
          title={t('sync.forceFinalTitle')}
          body={t('sync.forceFinalBody', {
            branch: pushAsk.branch,
            remote: pushAsk.remotes.join(', ')
          })}
          confirmLabel={t('sync.forceAction')}
          danger
          onConfirm={() => {
            const ask = pushAsk
            setPushAsk(null)
            void runPush(ask.record, ask.branch, {
              remotes: ask.remotes,
              upstreamRemote: ask.upstreamRemote,
              forceWithLease: true,
              publish: ask.publish
            })
          }}
          onClose={() => setPushAsk(null)}
        />
      )}

      {worktreeAsk?.phase === 'confirm' && (
        <ConfirmDialog
          title={t('worktree.removeTitle', { name: worktreeAsk.record.name })}
          body={t('worktree.removeBody', { path: worktreeAsk.record.path })}
          confirmLabel={t('worktree.removeAction')}
          danger
          onConfirm={() => {
            const ask = worktreeAsk
            setWorktreeAsk(null)
            runWorktreeRemove(ask.record, false)
          }}
          onClose={() => setWorktreeAsk(null)}
        />
      )}
      {worktreeAsk?.phase === 'dirty' && (
        <ConfirmDialog
          title={t('worktree.removeDirtyTitle', { name: worktreeAsk.record.name })}
          body={t('worktree.removeDirtyBody', { path: worktreeAsk.record.path })}
          confirmLabel={t('worktree.forceAction')}
          danger
          onConfirm={() => {
            const ask = worktreeAsk
            setWorktreeAsk(null)
            runWorktreeRemove(ask.record, true)
          }}
          onClose={() => setWorktreeAsk(null)}
        />
      )}
      {submoduleAsk?.phase === 'confirm' && (
        <ConfirmDialog
          title={t('submodule.deinitTitle', { name: submoduleAsk.path })}
          body={t('submodule.deinitBody')}
          confirmLabel={t('submodule.deinitAction')}
          danger
          onConfirm={() => {
            const ask = submoduleAsk
            setSubmoduleAsk(null)
            runSubmoduleDeinit(ask.record, ask.path, false)
          }}
          onClose={() => setSubmoduleAsk(null)}
        />
      )}
      {submoduleAsk?.phase === 'dirty' && (
        <ConfirmDialog
          title={t('submodule.deinitDirtyTitle', { name: submoduleAsk.path })}
          body={t('submodule.deinitDirtyBody')}
          confirmLabel={t('submodule.deinitAction')}
          danger
          onConfirm={() => {
            const ask = submoduleAsk
            setSubmoduleAsk(null)
            runSubmoduleDeinit(ask.record, ask.path, true)
          }}
          onClose={() => setSubmoduleAsk(null)}
        />
      )}
    </OperationsContext.Provider>
  )
}

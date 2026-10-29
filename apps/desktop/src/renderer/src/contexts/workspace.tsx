import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type ReactNode
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  GtdIpcError,
  type RepoRecord,
  type RepoStatusSnapshot,
  type WatchScopeKind,
  type WorkspaceDescriptor
} from '@gitreedesk/shared'
import { api } from '../api'
import { notifyServiceError } from '../lib/reporting'

export interface DegradedEntry {
  kind: WatchScopeKind
  dir: string
}

interface WorkspaceContextValue {
  descriptor: WorkspaceDescriptor | null
  statuses: ReadonlyMap<string, RepoStatusSnapshot>
  degraded: readonly DegradedEntry[]
  opening: boolean
  refreshing: boolean
  lastError: string | null
  open: (root: string) => Promise<void>
  close: () => Promise<void>
  refresh: () => Promise<void>
  rescan: (options?: { raiseBudget?: boolean }) => Promise<void>
  setTrusted: (trusted: boolean) => Promise<void>
  clearError: () => void
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

const EMPTY_STATUSES: ReadonlyMap<string, RepoStatusSnapshot> = new Map()

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Records are keyed by repository identity plus checkout path; worktrees share one identity. */
function recordKey(record: RepoRecord): string {
  return `${record.id}\u0000${record.path}`
}

function mergeRecords(
  current: readonly RepoRecord[],
  event: { added: RepoRecord[]; removed: RepoRecord[]; updated: RepoRecord[] }
): RepoRecord[] {
  const removed = new Set(event.removed.map((record) => recordKey(record)))
  const updated = new Map(event.updated.map((record) => [recordKey(record), record]))
  const records: RepoRecord[] = []
  const present = new Set<string>()
  for (const record of current) {
    const key = recordKey(record)
    if (removed.has(key)) continue
    const next = updated.get(key) ?? record
    records.push(next)
    present.add(key)
  }
  for (const record of event.added) {
    const key = recordKey(record)
    if (present.has(key)) continue
    records.push(record)
    present.add(key)
  }
  records.sort((a, b) => a.relPath.localeCompare(b.relPath))
  return records
}

export function WorkspaceProvider({ children }: { children: ReactNode }): JSX.Element {
  const { t } = useTranslation()
  const [descriptor, setDescriptor] = useState<WorkspaceDescriptor | null>(null)
  const [statuses, setStatuses] = useState<ReadonlyMap<string, RepoStatusSnapshot>>(EMPTY_STATUSES)
  const [degraded, setDegraded] = useState<readonly DegradedEntry[]>([])
  const [opening, setOpening] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [lastError, setLastError] = useState<string | null>(null)
  const rootRef = useRef<string | null>(null)

  const applyDescriptor = useCallback((next: WorkspaceDescriptor) => {
    rootRef.current = next.root
    setDescriptor(next)
    setStatuses(new Map(next.statuses.map((snapshot) => [snapshot.gitDir, snapshot])))
    setDegraded([])
  }, [])

  const open = useCallback(
    async (root: string) => {
      setOpening(true)
      setLastError(null)
      try {
        applyDescriptor(await api.invoke('workspace:open', { root }))
      } catch (error) {
        setLastError(errorMessage(error))
        if (error instanceof GtdIpcError && error.code === 'workspace-missing') {
          notifyServiceError(error, t)
        }
      } finally {
        setOpening(false)
      }
    },
    [applyDescriptor, t]
  )

  const close = useCallback(async () => {
    try {
      await api.invoke('workspace:close')
    } catch (error) {
      setLastError(errorMessage(error))
    }
    rootRef.current = null
    setDescriptor(null)
    setStatuses(EMPTY_STATUSES)
    setDegraded([])
  }, [])

  const refresh = useCallback(async () => {
    const root = rootRef.current
    if (root === null) return
    try {
      applyDescriptor(await api.invoke('workspace:open', { root }))
    } catch (error) {
      setLastError(errorMessage(error))
    }
  }, [applyDescriptor])

  const rescan = useCallback(
    async (options?: { raiseBudget?: boolean }) => {
      if (rootRef.current === null) return
      setRefreshing(true)
      setLastError(null)
      try {
        await api.invoke('workspace:rescan', options?.raiseBudget === true ? { raiseBudget: true } : {})
        await refresh()
      } catch (error) {
        setLastError(errorMessage(error))
      } finally {
        setRefreshing(false)
      }
    },
    [refresh]
  )

  const setTrusted = useCallback(async (trusted: boolean) => {
    try {
      await api.invoke('trust:grant', { trusted })
      setDescriptor((current) => (current === null ? current : { ...current, trusted }))
    } catch (error) {
      setLastError(errorMessage(error))
    }
  }, [])

  const clearError = useCallback(() => setLastError(null), [])

  useEffect(() => {
    const unsubscribes = [
      api.on('git:statusChanged', (event) => {
        if (event.root !== rootRef.current) return
        setStatuses((current) => {
          const next = new Map(current)
          for (const update of event.updates) next.set(update.gitDir, update)
          return next
        })
      }),
      api.on('workspace:reposChanged', (event) => {
        if (event.root !== rootRef.current) return
        setDescriptor((current) => {
          if (current === null) return current
          const records = mergeRecords(current.records, event)
          const stats =
            event.stats === undefined ? { ...current.stats, repos: records.length } : { ...event.stats, repos: records.length }
          return { ...current, records, stats }
        })
      }),
      api.on('workspace:issues', (event) => {
        if (event.root !== rootRef.current) return
        setDescriptor((current) => (current === null ? current : { ...current, issues: event.issues }))
      }),
      api.on('watcher:degraded', (event) => {
        if (event.root !== rootRef.current) return
        setDegraded((current) => {
          const others = current.filter(
            (entry) => !(entry.kind === event.kind && entry.dir === event.dir)
          )
          return event.degraded ? [...others, { kind: event.kind, dir: event.dir }] : others
        })
      })
    ]
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe()
    }
  }, [])

  useEffect(() => {
    const name = descriptor?.config.name ?? descriptor?.root.split('/').pop()
    document.title = name === undefined ? 'GitTreeDesk' : `${name} — GitTreeDesk`
  }, [descriptor])

  const value = useMemo(
    () => ({
      descriptor,
      statuses,
      degraded,
      opening,
      refreshing,
      lastError,
      open,
      close,
      refresh,
      rescan,
      setTrusted,
      clearError
    }),
    [
      descriptor,
      statuses,
      degraded,
      opening,
      refreshing,
      lastError,
      open,
      close,
      refresh,
      rescan,
      setTrusted,
      clearError
    ]
  )

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext)
  if (value === null) throw new Error('useWorkspace requires a WorkspaceProvider')
  return value
}

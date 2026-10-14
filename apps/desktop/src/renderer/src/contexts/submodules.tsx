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
import type { RepoRecord, SubmoduleInfo } from '@gitreedesk/shared'
import { api } from '../api'
import { useWorkspace } from './workspace'

interface SubmodulesContextValue {
  /** Submodule list of a checkout; `null` until it has been read. */
  submodulesFor: (record: RepoRecord) => readonly SubmoduleInfo[] | null
  /** Re-reads the list of one checkout, e.g. right after an update ran. */
  refresh: (gitDir: string) => Promise<void>
}

const SubmodulesContext = createContext<SubmodulesContextValue | null>(null)

const NO_LISTS: ReadonlyMap<string, readonly SubmoduleInfo[]> = new Map()
const NO_RECORDS: readonly RepoRecord[] = []

/** A registered checkout that lives inside `parent` and shares its repository identity tree. */
function isSubmoduleCheckout(child: RepoRecord, parent: RepoRecord): boolean {
  return (
    child.parentId === parent.id &&
    child.id !== parent.id &&
    child.path.startsWith(`${parent.path}/`)
  )
}

/**
 * Keeps `git submodule status` of every checkout containing `.gitmodules` fresh:
 * reads a list when its checkout first appears and again whenever the registered
 * submodule checkouts change paths or HEAD commits (init, deinit, drift).
 */
export function SubmodulesProvider({ children }: { children: ReactNode }): JSX.Element {
  const { descriptor, statuses } = useWorkspace()
  const [lists, setLists] = useState<ReadonlyMap<string, readonly SubmoduleInfo[]>>(NO_LISTS)
  // Fingerprint per checkout: the submodule checkouts under it, with their HEAD shas.
  const fingerprints = useRef(new Map<string, string>())
  const inFlight = useRef(new Set<string>())

  const fetchOne = useCallback(async (gitDir: string): Promise<void> => {
    if (inFlight.current.has(gitDir)) return
    inFlight.current.add(gitDir)
    try {
      const { submodules } = await api.invoke('git:submodules', { gitDir })
      setLists((current) => {
        const next = new Map(current)
        next.set(gitDir, submodules)
        return next
      })
    } catch {
      // Keep the previous list; the next fingerprint change retries.
    } finally {
      inFlight.current.delete(gitDir)
    }
  }, [])

  const refresh = useCallback(
    async (gitDir: string): Promise<void> => {
      await fetchOne(gitDir)
    },
    [fetchOne]
  )

  const records = descriptor?.records ?? NO_RECORDS
  const open = descriptor !== null

  useEffect(() => {
    if (!open) {
      fingerprints.current = new Map()
      setLists((current) => (current.size === 0 ? current : NO_LISTS))
      return
    }

    const next = new Map<string, string>()
    for (const candidate of records) {
      if (candidate.gitDir === '' || candidate.kind === 'bare' || !candidate.hasSubmodules) continue
      const parts: string[] = []
      for (const child of records) {
        if (!isSubmoduleCheckout(child, candidate) || child.gitDir === '') continue
        const sha = statuses.get(child.gitDir)?.status.head.sha
        if (sha === null || sha === undefined) continue
        parts.push(`${child.relPath}\u0000${sha}`)
      }
      parts.sort()
      next.set(candidate.gitDir, parts.join('\n'))
    }

    const stale = [...lists.keys()].filter((gitDir) => !next.has(gitDir))
    if (stale.length > 0) {
      setLists((current) => {
        const updated = new Map(current)
        for (const gitDir of stale) updated.delete(gitDir)
        return updated
      })
    }

    const toFetch: string[] = []
    for (const [gitDir, fingerprint] of next) {
      if (fingerprints.current.get(gitDir) !== fingerprint) toFetch.push(gitDir)
    }
    fingerprints.current = next
    for (const gitDir of toFetch) void fetchOne(gitDir)
  }, [open, records, statuses, lists, fetchOne])

  const submodulesFor = useCallback(
    (record: RepoRecord): readonly SubmoduleInfo[] | null =>
      record.gitDir === '' ? null : (lists.get(record.gitDir) ?? null),
    [lists]
  )

  const value = useMemo(() => ({ submodulesFor, refresh }), [submodulesFor, refresh])

  return <SubmodulesContext.Provider value={value}>{children}</SubmodulesContext.Provider>
}

export function useSubmodules(): SubmodulesContextValue {
  const value = useContext(SubmodulesContext)
  if (value === null) throw new Error('useSubmodules requires a SubmodulesProvider')
  return value
}

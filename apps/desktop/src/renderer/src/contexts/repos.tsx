import { createContext, useContext, useMemo, useState, type JSX, type ReactNode } from 'react'
import type { RepoRecord } from '@gitreedesk/shared'
import { useWorkspace } from './workspace'

interface ReposUiContextValue {
  /** Checkout key (git dir) of the repository the status bar and commands act on. */
  activeKey: string | null
  setActiveKey: (key: string) => void
  /** Resolved active checkout; falls back to the first main checkout of the workspace. */
  activeRecord: RepoRecord | null
}

const ReposUiContext = createContext<ReposUiContextValue | null>(null)

const NO_RECORDS: readonly RepoRecord[] = []

function defaultRecord(records: readonly RepoRecord[]): RepoRecord | null {
  const usable = records.filter((record) => record.gitDir.length > 0 && !record.external)
  return usable.find((record) => record.kind !== 'worktree') ?? usable[0] ?? null
}

/**
 * Tracks which repository the shell is "on": the status bar branch picker and
 * the repository commands act on it. Shared worktrees are distinct checkouts,
 * so the git dir stays the identity even for them.
 */
export function ReposUiProvider({ children }: { children: ReactNode }): JSX.Element {
  const { descriptor } = useWorkspace()
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const records = descriptor?.records ?? NO_RECORDS

  const activeRecord = useMemo(() => {
    const found = records.find((record) => record.gitDir === activeKey)
    return found ?? defaultRecord(records)
  }, [records, activeKey])

  const value = useMemo(
    () => ({ activeKey, setActiveKey, activeRecord }),
    [activeKey, activeRecord]
  )

  return <ReposUiContext.Provider value={value}>{children}</ReposUiContext.Provider>
}

export function useReposUi(): ReposUiContextValue {
  const value = useContext(ReposUiContext)
  if (value === null) throw new Error('useReposUi requires a ReposUiProvider')
  return value
}

import { createContext, useContext } from 'react'
import type { AutoStashReport, RepoRecord } from '@gitreedesk/shared'

export interface FetchOptions {
  /** Deletes stale remote-tracking branches while fetching. */
  prune: boolean
  followTags: boolean
}

export interface OutputLine {
  /** Checkout key the result belongs to. */
  key: string
  name: string
  state: 'running' | 'updated' | 'uptodate' | 'failed'
  error: string | null
  /** Raw git output for the expandable details. */
  output: string
  /** Auto-stash report of a pull; `null` for fetch. */
  stash: AutoStashReport | null
}

export interface OutputEntry {
  id: number
  title: string
  done: boolean
  lines: OutputLine[]
}

export interface OperationsValue {
  openBranches: (record: RepoRecord) => void
  openCreateBranch: (record: RepoRecord, options?: { startPoint?: string; initialName?: string }) => void
  openRemotes: (record: RepoRecord) => void
  openTags: (record: RepoRecord) => void
  closeDialog: () => void
  /** Fetch one repository (toast) or several (output panel summary). */
  fetchRepos: (records: readonly RepoRecord[]) => void
  /** Pull one repository (toast) or several (output panel summary). */
  pullRepos: (records: readonly RepoRecord[]) => void
  /**
   * Pushes a local branch; without an upstream this asks to publish first, and
   * a rejected push leads to the force-with-lease flow behind two confirmations.
   */
  pushBranch: (record: RepoRecord, branch: string, options?: { hasUpstream?: boolean }) => void
  fetchOptions: FetchOptions
  setFetchOptions: (next: FetchOptions) => void
  output: readonly OutputEntry[]
  outputOpen: boolean
  setOutputOpen: (open: boolean) => void
  clearOutput: () => void
}

export const OperationsContext = createContext<OperationsValue | null>(null)

export function useOperations(): OperationsValue {
  const value = useContext(OperationsContext)
  if (value === null) throw new Error('useOperations requires an OperationsProvider')
  return value
}

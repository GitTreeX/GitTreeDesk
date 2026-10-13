import type { RepoRecord, WorkspaceConfig } from '@gitreedesk/shared'
import { matchesSubtree } from './glob'

/** Records are keyed by repository identity plus checkout path; worktrees share one identity. */
export function recordKey(record: RepoRecord): string {
  return `${record.id}\u0000${record.path}`
}

function sameRecord(a: RepoRecord, b: RepoRecord): boolean {
  return (
    a.path === b.path &&
    a.relPath === b.relPath &&
    a.gitDir === b.gitDir &&
    a.commonDir === b.commonDir &&
    a.kind === b.kind &&
    a.parentId === b.parentId &&
    a.name === b.name &&
    a.external === b.external &&
    a.hasSubmodules === b.hasSubmodules
  )
}

export interface RepoDiff {
  added: RepoRecord[]
  removed: RepoRecord[]
  updated: RepoRecord[]
}

export function diffRepos(previous: readonly RepoRecord[], next: readonly RepoRecord[]): RepoDiff {
  const previousByKey = new Map(previous.map((record) => [recordKey(record), record]))
  const added: RepoRecord[] = []
  const updated: RepoRecord[] = []

  for (const record of next) {
    const key = recordKey(record)
    const existing = previousByKey.get(key)
    if (existing === undefined) {
      added.push(record)
      continue
    }
    previousByKey.delete(key)
    if (!sameRecord(existing, record)) updated.push(record)
  }

  return { added, removed: [...previousByKey.values()], updated }
}

export interface RepoGroup {
  name: string
  repos: RepoRecord[]
}

export class WorkspaceRegistry {
  readonly root: string
  #config: WorkspaceConfig
  #records = new Map<string, RepoRecord>()

  constructor(options: { root: string; config: WorkspaceConfig }) {
    this.root = options.root
    this.#config = options.config
  }

  get config(): WorkspaceConfig {
    return this.#config
  }

  setConfig(config: WorkspaceConfig): void {
    this.#config = config
  }

  replace(records: readonly RepoRecord[]): RepoDiff {
    const diff = diffRepos(this.all, records)
    this.#records = new Map(records.map((record) => [recordKey(record), record]))
    return diff
  }

  get all(): RepoRecord[] {
    return [...this.#records.values()].sort((a, b) => a.relPath.localeCompare(b.relPath))
  }

  get size(): number {
    return this.#records.size
  }

  findById(id: string): RepoRecord[] {
    return this.all.filter((record) => record.id === id)
  }

  findByPath(pathPosix: string): RepoRecord | undefined {
    return this.all.find((record) => record.path === pathPosix)
  }

  children(parentId: string): RepoRecord[] {
    return this.all.filter((record) => record.parentId === parentId)
  }

  /** Top-level rows: records whose parent is unknown to this registry. */
  roots(): RepoRecord[] {
    return this.all.filter((record) => !this.#hasKnownParent(record))
  }

  groups(): RepoGroup[] {
    const groups = new Map<string, RepoGroup>()
    for (const record of this.roots()) {
      const name = this.#groupName(record)
      const group = groups.get(name)
      if (group === undefined) groups.set(name, { name, repos: [record] })
      else group.repos.push(record)
    }
    return [...groups.values()]
  }

  #hasKnownParent(record: RepoRecord): boolean {
    if (record.parentId === null) return false
    for (const candidate of this.#records.values()) {
      if (candidate.id === record.parentId) return true
    }
    return false
  }

  #groupName(record: RepoRecord): string {
    const configured = this.#config.groups
    if (configured !== null) {
      for (const group of configured) {
        if (matchesSubtree(group.match, record.relPath)) return group.name
      }
    }
    const firstSegment = record.relPath.split('/')[0] ?? ''
    return firstSegment.length > 0 ? firstSegment : (this.#config.name ?? 'Workspace')
  }
}

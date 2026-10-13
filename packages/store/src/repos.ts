import type { Database } from 'better-sqlite3'
import type { RepoKind, RepoRecord } from '@gitreedesk/shared'

export interface RepoRow {
  id: number
  workspaceId: number
  relPath: string
  gitDir: string
  commonDir: string
  kind: RepoKind
  parentRowId: number | null
  name: string
}

interface RepoDbRow {
  id: number
  workspace_id: number
  rel_path: string
  git_dir: string
  common_dir: string
  kind: RepoKind
  parent_repo_id: number | null
  name: string
}

const toRow = (row: RepoDbRow): RepoRow => ({
  id: row.id,
  workspaceId: row.workspace_id,
  relPath: row.rel_path,
  gitDir: row.git_dir,
  commonDir: row.common_dir,
  kind: row.kind,
  parentRowId: row.parent_repo_id,
  name: row.name
})

/**
 * The parent id shared by a repository's records points at its main checkout;
 * worktrees of the same repository are only a fallback.
 */
function findParentRelPath(records: readonly RepoRecord[], parentId: string): string | null {
  let fallback: string | null = null
  for (const record of records) {
    if (record.id !== parentId) continue
    if (record.kind !== 'worktree') return record.relPath
    fallback ??= record.relPath
  }
  return fallback
}

export class RepoStore {
  readonly #db: Database

  constructor(db: Database) {
    this.#db = db
  }

  /** Reconciles the stored rows with a fresh discovery result; rows keep their ids. */
  sync(workspaceId: number, records: readonly RepoRecord[]): RepoRow[] {
    const upsert = this.#db.prepare<
      [number, string, string, string, RepoKind, string],
      { id: number }
    >(
      `INSERT INTO repos (workspace_id, rel_path, git_dir, common_dir, kind, name)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id, rel_path) DO UPDATE SET
         git_dir = excluded.git_dir,
         common_dir = excluded.common_dir,
         kind = excluded.kind,
         name = excluded.name
       RETURNING id`
    )
    const removeStale = this.#db.prepare<[number, string]>(
      `DELETE FROM repos
       WHERE workspace_id = ? AND rel_path NOT IN (SELECT value FROM json_each(?))`
    )
    const setParent = this.#db.prepare<[number | null, number]>(
      'UPDATE repos SET parent_repo_id = ? WHERE id = ?'
    )

    const run = this.#db.transaction(() => {
      const idByRelPath = new Map<string, number>()
      for (const record of records) {
        const row = upsert.get(
          workspaceId,
          record.relPath,
          record.gitDir,
          record.commonDir,
          record.kind,
          record.name
        )
        if (row === undefined) throw new Error(`Failed to upsert repository: ${record.relPath}`)
        idByRelPath.set(record.relPath, row.id)
      }
      removeStale.run(workspaceId, JSON.stringify(records.map((record) => record.relPath)))

      for (const record of records) {
        const rowId = idByRelPath.get(record.relPath)
        if (rowId === undefined) continue
        const parentRelPath = record.parentId === null ? null : findParentRelPath(records, record.parentId)
        setParent.run(parentRelPath === null ? null : (idByRelPath.get(parentRelPath) ?? null), rowId)
      }
    })
    run()
    return this.list(workspaceId)
  }

  list(workspaceId: number): RepoRow[] {
    const rows = this.#db
      .prepare<[number], RepoDbRow>('SELECT * FROM repos WHERE workspace_id = ? ORDER BY rel_path')
      .all(workspaceId)
    return rows.map(toRow)
  }

  findByRelPath(workspaceId: number, relPath: string): RepoRow | null {
    const row = this.#db
      .prepare<[number, string], RepoDbRow>('SELECT * FROM repos WHERE workspace_id = ? AND rel_path = ?')
      .get(workspaceId, relPath)
    return row === undefined ? null : toRow(row)
  }
}

import type { Database } from 'better-sqlite3'
import { realpathSync } from 'node:fs'

export interface WorkspaceRow {
  id: number
  root: string
  name: string | null
  lastOpenedAt: number | null
  trusted: boolean
}

interface WorkspaceDbRow {
  id: number
  root: string
  name: string | null
  last_opened_at: number | null
  trusted: number
}

const toRow = (row: WorkspaceDbRow): WorkspaceRow => ({
  id: row.id,
  root: row.root,
  name: row.name,
  lastOpenedAt: row.last_opened_at,
  trusted: row.trusted !== 0
})

/**
 * Two spellings of the same directory must land on the same row. The native
 * implementation is required: a session resolves its root with `fs.promises.realpath`,
 * which is native as well and turns a Windows 8.3 short path into its long form,
 * while the plain `realpathSync` keeps the short spelling.
 */
export function normalizeWorkspaceRoot(root: string): string {
  try {
    return realpathSync.native(root).replace(/\\/g, '/')
  } catch {
    return root.replace(/\\/g, '/')
  }
}

export interface UpsertWorkspaceOptions {
  name?: string | null
  /** Epoch milliseconds; defaults to now. */
  at?: number
}

export class WorkspaceStore {
  readonly #db: Database

  constructor(db: Database) {
    this.#db = db
  }

  /** Records a workspace open, refreshing its name and last-opened time. */
  upsert(root: string, options: UpsertWorkspaceOptions = {}): WorkspaceRow {
    const key = normalizeWorkspaceRoot(root)
    const row = this.#db
      .prepare<[string, string | null, number], WorkspaceDbRow>(
        `INSERT INTO workspaces (root, name, last_opened_at, trusted)
         VALUES (?, ?, ?, 0)
         ON CONFLICT(root) DO UPDATE SET
           name = COALESCE(excluded.name, workspaces.name),
           last_opened_at = excluded.last_opened_at
         RETURNING *`
      )
      .get(key, options.name ?? null, options.at ?? Date.now())
    if (row === undefined) throw new Error('Failed to upsert workspace')
    return toRow(row)
  }

  findByRoot(root: string): WorkspaceRow | null {
    const row = this.#db
      .prepare<[string], WorkspaceDbRow>('SELECT * FROM workspaces WHERE root = ?')
      .get(normalizeWorkspaceRoot(root))
    return row === undefined ? null : toRow(row)
  }

  recent(limit = 10): WorkspaceRow[] {
    const rows = this.#db
      .prepare<[number], WorkspaceDbRow>(
        'SELECT * FROM workspaces WHERE last_opened_at IS NOT NULL ORDER BY last_opened_at DESC LIMIT ?'
      )
      .all(limit)
    return rows.map(toRow)
  }

  /** Hides a workspace from the recent list while keeping its trust state. */
  removeFromRecent(root: string): void {
    this.#db.prepare<[string]>('UPDATE workspaces SET last_opened_at = NULL WHERE root = ?').run(
      normalizeWorkspaceRoot(root)
    )
  }

  isTrusted(root: string): boolean {
    const row = this.#db
      .prepare<[string], { trusted: number }>('SELECT trusted FROM workspaces WHERE root = ?')
      .get(normalizeWorkspaceRoot(root))
    return row !== undefined && row.trusted !== 0
  }

  setTrusted(root: string, trusted: boolean): void {
    const key = normalizeWorkspaceRoot(root)
    this.#db
      .prepare<[string, number]>(
        `INSERT INTO workspaces (root, trusted) VALUES (?, ?)
         ON CONFLICT(root) DO UPDATE SET trusted = excluded.trusted`
      )
      .run(key, trusted ? 1 : 0)
  }
}

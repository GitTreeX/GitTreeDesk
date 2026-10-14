import type { Database } from 'better-sqlite3'

export interface OpLogEntry {
  /** Row id of the checkout the operation ran in; `null` for repository-agnostic operations. */
  repoId: number | null
  op: string
  backupRef?: string | null
  /** Epoch milliseconds; defaults to now. */
  at?: number
  undoState?: string | null
}

export interface OperationRow {
  id: number
  repoId: number | null
  op: string
  backupRef: string | null
  at: number
  undoState: string | null
}

interface OpLogDbRow {
  id: number
  repo_id: number | null
  op: string
  backup_ref: string | null
  at: number
  undo_state: string | null
}

const toRow = (row: OpLogDbRow): OperationRow => ({
  id: row.id,
  repoId: row.repo_id,
  op: row.op,
  backupRef: row.backup_ref,
  at: row.at,
  undoState: row.undo_state
})

/** Audit trail of mutating operations, backing the undo affordances. */
export class OpLogStore {
  readonly #db: Database

  constructor(db: Database) {
    this.#db = db
  }

  record(entry: OpLogEntry): number {
    const result = this.#db
      .prepare<[number | null, string, string | null, number, string | null]>(
        'INSERT INTO oplog (repo_id, op, backup_ref, at, undo_state) VALUES (?, ?, ?, ?, ?)'
      )
      .run(entry.repoId, entry.op, entry.backupRef ?? null, entry.at ?? Date.now(), entry.undoState ?? null)
    return Number(result.lastInsertRowid)
  }

  updateUndoState(id: number, undoState: string | null): void {
    this.#db.prepare<[string | null, number]>('UPDATE oplog SET undo_state = ? WHERE id = ?').run(undoState, id)
  }

  get(id: number): OperationRow | null {
    const row = this.#db.prepare<[number], OpLogDbRow>('SELECT * FROM oplog WHERE id = ?').get(id)
    return row === undefined ? null : toRow(row)
  }

  /** Most recent row that took a specific backup ref; backs restore-by-ref. */
  findByBackupRef(backupRef: string): OperationRow | null {
    const row = this.#db
      .prepare<[string], OpLogDbRow>('SELECT * FROM oplog WHERE backup_ref = ? ORDER BY id DESC LIMIT 1')
      .get(backupRef)
    return row === undefined ? null : toRow(row)
  }

  latest(repoId: number | null, options: { op?: string } = {}): OperationRow | null {
    const row =
      options.op === undefined
        ? this.#db
            .prepare<[number | null], OpLogDbRow>(
              'SELECT * FROM oplog WHERE repo_id IS ? ORDER BY at DESC, id DESC LIMIT 1'
            )
            .get(repoId)
        : this.#db
            .prepare<[number | null, string], OpLogDbRow>(
              'SELECT * FROM oplog WHERE repo_id IS ? AND op = ? ORDER BY at DESC, id DESC LIMIT 1'
            )
            .get(repoId, options.op)
    return row === undefined ? null : toRow(row)
  }

  list(options: { repoId?: number | null; limit?: number } = {}): OperationRow[] {
    const rows =
      options.repoId === undefined
        ? this.#db.prepare<[number], OpLogDbRow>('SELECT * FROM oplog ORDER BY at DESC, id DESC LIMIT ?').all(options.limit ?? 50)
        : this.#db
            .prepare<[number | null, number], OpLogDbRow>(
              'SELECT * FROM oplog WHERE repo_id IS ? ORDER BY at DESC, id DESC LIMIT ?'
            )
            .all(options.repoId, options.limit ?? 50)
    return rows.map(toRow)
  }
}

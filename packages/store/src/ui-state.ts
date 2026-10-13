import type { Database } from 'better-sqlite3'

interface UiStateDbRow {
  key: string
  value: string
}

/** Arbitrary JSON key/value state: expanded nodes, recent files, view preferences. */
export class UiStateStore {
  readonly #db: Database

  constructor(db: Database) {
    this.#db = db
  }

  get<T>(key: string): T | null {
    const row = this.#db.prepare<[string], UiStateDbRow>('SELECT key, value FROM ui_state WHERE key = ?').get(key)
    if (row === undefined) return null
    try {
      return JSON.parse(row.value) as T
    } catch {
      return null
    }
  }

  set(key: string, value: unknown): void {
    this.#db
      .prepare<[string, string]>(
        `INSERT INTO ui_state (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(key, JSON.stringify(value))
  }

  delete(key: string): void {
    this.#db.prepare<[string]>('DELETE FROM ui_state WHERE key = ?').run(key)
  }

  keys(prefix?: string): string[] {
    const rows = this.#db.prepare<[], UiStateDbRow>('SELECT key, value FROM ui_state ORDER BY key').all()
    const all = rows.map((row) => row.key)
    return prefix === undefined ? all : all.filter((key) => key.startsWith(prefix))
  }
}

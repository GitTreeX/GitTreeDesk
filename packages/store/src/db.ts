import Database from 'better-sqlite3'
import { rmSync } from 'node:fs'
import { MIGRATIONS, SCHEMA_VERSION } from './schema'

function setup(db: Database.Database): void {
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
}

function migrate(db: Database.Database): void {
  const version = db.pragma('user_version', { simple: true }) as number
  if (version > SCHEMA_VERSION) throw new Error('Database was written by a newer version of GitTreeDesk')
  if (version === SCHEMA_VERSION) return

  db.transaction(() => {
    for (const migration of MIGRATIONS) {
      if (migration.version <= version) continue
      for (const statement of migration.statements) db.exec(statement)
      db.pragma(`user_version = ${String(migration.version)}`)
    }
  })()
}

function wipe(filePath: string): void {
  for (const suffix of ['', '-wal', '-shm']) {
    rmSync(`${filePath}${suffix}`, { force: true })
  }
}

function open(filePath: string): Database.Database {
  const db = new Database(filePath)
  try {
    setup(db)
    migrate(db)
    return db
  } catch (error) {
    db.close()
    throw error
  }
}

/**
 * Opens the cache database, creating it on first use. An unreadable or
 * incompatible file is discarded and rebuilt — this is a cache, never a
 * user-facing error.
 */
export function openCacheDatabase(filePath: string): Database.Database {
  try {
    return open(filePath)
  } catch {
    wipe(filePath)
    return open(filePath)
  }
}

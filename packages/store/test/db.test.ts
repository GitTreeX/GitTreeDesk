import type { Database } from 'better-sqlite3'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openCacheDatabase } from '../src/db'
import { SCHEMA_VERSION } from '../src/schema'

let dirs: string[] = []
let dbs: Database[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'gtd-db-'))
  dirs.push(dir)
  return dir
}

function open(file: string): Database {
  const db = openCacheDatabase(file)
  dbs.push(db)
  return db
}

function tableNames(db: Database): string[] {
  const rows = db.prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").all()
  return rows.map((row) => row.name)
}

afterEach(async () => {
  for (const db of dbs) db.close()
  dbs = []
  for (const dir of dirs) await rm(dir, { recursive: true, force: true })
  dirs = []
})

describe('openCacheDatabase', () => {
  it('creates the schema and records the schema version', async () => {
    const dir = await tempDir()
    const db = open(join(dir, 'cache.db'))

    expect(tableNames(db)).toEqual(
      expect.arrayContaining(['workspaces', 'repos', 'repo_cache', 'commits_cache', 'ui_state', 'oplog'])
    )
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
  })

  it('reopens an existing database without touching its data', async () => {
    const dir = await tempDir()
    const file = join(dir, 'cache.db')

    const first = open(file)
    first.prepare("INSERT INTO ui_state (key, value) VALUES ('k', '1')").run()
    first.close()
    dbs = dbs.filter((db) => db !== first)

    const second = open(file)
    expect(second.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    expect(second.prepare("SELECT value FROM ui_state WHERE key = 'k'").get()).toEqual({ value: '1' })
  })

  it('rebuilds a corrupted file silently', async () => {
    const dir = await tempDir()
    const file = join(dir, 'cache.db')
    await writeFile(file, 'this is not a sqlite database at all, not even close', 'utf8')

    const db = open(file)
    expect(tableNames(db)).toEqual(expect.arrayContaining(['workspaces', 'repos']))
    expect(db.prepare('SELECT COUNT(*) AS count FROM workspaces').get()).toEqual({ count: 0 })
  })

  it('enables foreign keys and WAL mode', async () => {
    const dir = await tempDir()
    const db = open(join(dir, 'cache.db'))
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal')
  })
})

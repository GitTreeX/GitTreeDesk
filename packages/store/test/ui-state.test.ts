import type { Database } from 'better-sqlite3'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openCacheDatabase } from '../src/db'
import { OpLogStore } from '../src/oplog'
import { UiStateStore } from '../src/ui-state'

let dirs: string[] = []
let dbs: Database[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'gtd-state-'))
  dirs.push(dir)
  return dir
}

function open(file: string): Database {
  const db = openCacheDatabase(file)
  dbs.push(db)
  return db
}

afterEach(async () => {
  for (const db of dbs) db.close()
  dbs = []
  for (const dir of dirs) await rm(dir, { recursive: true, force: true })
  dirs = []
})

describe('UiStateStore', () => {
  it('round-trips JSON values and overwrites in place', async () => {
    const dir = await tempDir()
    const db = open(join(dir, 'cache.db'))
    const ui = new UiStateStore(db)

    expect(ui.get('missing')).toBeNull()
    ui.set('expanded:acme', ['api', 'mobile'])
    expect(ui.get<string[]>('expanded:acme')).toEqual(['api', 'mobile'])

    ui.set('expanded:acme', ['api'])
    expect(ui.get<string[]>('expanded:acme')).toEqual(['api'])

    ui.delete('expanded:acme')
    expect(ui.get('expanded:acme')).toBeNull()
  })

  it('filters keys by prefix', async () => {
    const dir = await tempDir()
    const ui = new UiStateStore(open(join(dir, 'cache.db')))
    ui.set('recent:file:a', 1)
    ui.set('recent:file:b', 2)
    ui.set('graph:prefs', {})

    expect(ui.keys('recent:file:').sort()).toEqual(['recent:file:a', 'recent:file:b'])
    expect(ui.keys()).toHaveLength(3)
  })

  it('returns null for a corrupted value', async () => {
    const dir = await tempDir()
    const db = open(join(dir, 'cache.db'))
    db.prepare("INSERT INTO ui_state (key, value) VALUES ('broken', '{oops')").run()
    expect(new UiStateStore(db).get('broken')).toBeNull()
  })
})

describe('OpLogStore', () => {
  it('records operations and resolves the latest one', async () => {
    const dir = await tempDir()
    const log = new OpLogStore(open(join(dir, 'cache.db')))

    const first = log.record({ repoId: 7, op: 'reset-hard', backupRef: 'refs/gitreedesk/backup/reset-hard/x', at: 1000 })
    log.record({ repoId: 7, op: 'merge', at: 2000 })
    log.record({ repoId: 8, op: 'reset-hard', at: 3000 })

    expect(log.latest(7)?.op).toBe('merge')
    expect(log.latest(7, { op: 'reset-hard' })?.id).toBe(first)
    expect(log.latest(8)?.at).toBe(3000)
    expect(log.latest(null)).toBeNull()
  })

  it('updates the undo state and lists per repository', async () => {
    const dir = await tempDir()
    const log = new OpLogStore(open(join(dir, 'cache.db')))
    const id = log.record({ repoId: 7, op: 'commit-amend', backupRef: 'refs/gitreedesk/backup/commit-amend/y', at: 1000 })
    log.record({ repoId: 7, op: 'pull', at: 2000 })
    log.record({ repoId: 8, op: 'fetch', at: 3000 })

    log.updateUndoState(id, 'undone')
    expect(log.latest(7, { op: 'commit-amend' })?.undoState).toBe('undone')
    expect(log.latest(7, { op: 'commit-amend' })?.backupRef).toBe('refs/gitreedesk/backup/commit-amend/y')

    const forSeven = log.list({ repoId: 7 })
    expect(forSeven.map((row) => row.op)).toEqual(['pull', 'commit-amend'])
    expect(log.list({ limit: 2 }).map((row) => row.at)).toEqual([3000, 2000])

    log.updateUndoState(id, null)
    expect(log.latest(7, { op: 'commit-amend' })?.undoState).toBeNull()
  })
})

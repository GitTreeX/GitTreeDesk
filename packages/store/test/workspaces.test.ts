import type { Database } from 'better-sqlite3'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openCacheDatabase } from '../src/db'
import { WorkspaceStore } from '../src/workspaces'

let dirs: string[] = []
let dbs: Database[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'gtd-ws-'))
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

describe('WorkspaceStore', () => {
  it('records a workspace open and refreshes name and time on revisit', async () => {
    const dir = await tempDir()
    const store = new WorkspaceStore(open(join(dir, 'cache.db')))
    const root = join(dir, 'acme')

    const first = store.upsert(root, { name: 'acme', at: 1000 })
    expect(first.name).toBe('acme')
    expect(first.lastOpenedAt).toBe(1000)
    expect(first.trusted).toBe(false)

    const second = store.upsert(root, { at: 2000 })
    expect(second.id).toBe(first.id)
    expect(second.name).toBe('acme')
    expect(second.lastOpenedAt).toBe(2000)
  })

  it('lists recent workspaces newest first and hides removed entries', async () => {
    const dir = await tempDir()
    const store = new WorkspaceStore(open(join(dir, 'cache.db')))
    const a = join(dir, 'a')
    const b = join(dir, 'b')
    // Stored roots are normalized to forward slashes.
    const norm = (root: string): string => root.replace(/\\/g, '/')

    store.upsert(a, { at: 1000 })
    store.upsert(b, { at: 2000 })
    expect(store.recent().map((row) => row.root)).toEqual([norm(b), norm(a)])

    store.removeFromRecent(b)
    expect(store.recent().map((row) => row.root)).toEqual([norm(a)])
    expect(store.findByRoot(b)?.lastOpenedAt).toBeNull()

    store.upsert(b, { at: 3000 })
    expect(store.recent()[0]?.root).toBe(norm(b))
    expect(store.recent(1)).toHaveLength(1)
  })

  it('keeps trust when a workspace is reopened or renamed', async () => {
    const dir = await tempDir()
    const root = join(dir, 'acme')
    const db = open(join(dir, 'cache.db'))
    const store = new WorkspaceStore(db)

    expect(store.isTrusted(root)).toBe(false)
    store.upsert(root, { name: 'acme', at: 1000 })
    store.setTrusted(root, true)
    expect(store.isTrusted(root)).toBe(true)

    store.upsert(root, { name: 'acme-2', at: 2000 })
    expect(store.isTrusted(root)).toBe(true)
    expect(store.findByRoot(root)?.name).toBe('acme-2')

    store.setTrusted(root, false)
    expect(store.isTrusted(root)).toBe(false)
  })

  it('persists trust across database reopen', async () => {
    const dir = await tempDir()
    const file = join(dir, 'cache.db')
    const root = join(dir, 'acme')

    const first = open(file)
    const store = new WorkspaceStore(first)
    store.upsert(root, { at: 1000 })
    store.setTrusted(root, true)
    first.close()
    dbs = dbs.filter((db) => db !== first)

    const reopened = new WorkspaceStore(open(file))
    expect(reopened.isTrusted(root)).toBe(true)
  })

  it('lands different spellings of the same root on one row', async () => {
    const dir = await tempDir()
    const store = new WorkspaceStore(open(join(dir, 'cache.db')))
    const root = join(dir, 'acme')
    await mkdir(root)

    store.upsert(root, { at: 1000 })
    const posix = root.replace(/\\/g, '/')
    expect(store.findByRoot(posix)?.lastOpenedAt).toBe(1000)

    store.setTrusted(posix, true)
    expect(store.isTrusted(root)).toBe(true)
    expect(store.recent()).toHaveLength(1)
  })
})

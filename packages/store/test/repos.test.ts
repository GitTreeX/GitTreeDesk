import type { Database } from 'better-sqlite3'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { RepoRecord } from '@gitreedesk/shared'
import { openCacheDatabase } from '../src/db'
import { RepoStore } from '../src/repos'
import { WorkspaceStore } from '../src/workspaces'

let dirs: string[] = []
let dbs: Database[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'gtd-repos-'))
  dirs.push(dir)
  return dir
}

function open(file: string): Database {
  const db = openCacheDatabase(file)
  dbs.push(db)
  return db
}

function record(overrides: Partial<RepoRecord> & { relPath: string }): RepoRecord {
  const path = `C:/ws/${overrides.relPath}`
  return {
    id: 'C:/ws/api/.git',
    root: 'C:/ws',
    path,
    gitDir: `${path}/.git`,
    commonDir: `${path}/.git`,
    kind: 'repository',
    parentId: null,
    name: overrides.relPath.split('/').pop() ?? 'repo',
    external: false,
    hasSubmodules: false,
    ...overrides
  }
}

afterEach(async () => {
  for (const db of dbs) db.close()
  dbs = []
  for (const dir of dirs) await rm(dir, { recursive: true, force: true })
  dirs = []
})

describe('RepoStore', () => {
  it('syncs records, links parents to row ids and drops stale rows', async () => {
    const dir = await tempDir()
    const db = open(join(dir, 'cache.db'))
    const workspaceId = new WorkspaceStore(db).upsert(join(dir, 'ws'), { at: 1000 }).id
    const repos = new RepoStore(db)

    const api = record({ relPath: 'api', id: 'C:/ws/api/.git' })
    const apiWorktree = record({
      relPath: '__worktree__/api_wt',
      id: 'C:/ws/api/.git',
      kind: 'worktree',
      parentId: 'C:/ws/api/.git'
    })
    const nested = record({
      relPath: 'api/vendor/tool',
      id: 'C:/ws/api/vendor/tool/.git',
      parentId: 'C:/ws/api/.git',
      name: 'tool'
    })
    const gone = record({ relPath: 'old', id: 'C:/ws/old/.git' })

    const rows = repos.sync(workspaceId, [api, apiWorktree, nested, gone])
    expect(rows.map((row) => row.relPath)).toEqual(['__worktree__/api_wt', 'api', 'api/vendor/tool', 'old'])

    const byRel = new Map(rows.map((row) => [row.relPath, row]))
    const apiRow = byRel.get('api')
    expect(apiRow?.name).toBe('api')
    expect(apiRow?.kind).toBe('repository')
    expect(apiRow?.parentRowId).toBeNull()
    expect(byRel.get('__worktree__/api_wt')?.parentRowId).toBe(apiRow?.id)
    expect(byRel.get('api/vendor/tool')?.parentRowId).toBe(apiRow?.id)

    // A repeated sync keeps row ids, applies updates and removes vanished records.
    const renamed = { ...nested, name: 'tool-renamed' }
    const second = repos.sync(workspaceId, [api, apiWorktree, renamed])
    expect(second).toHaveLength(3)
    expect(second.find((row) => row.relPath === 'api')?.id).toBe(apiRow?.id)
    expect(second.find((row) => row.relPath === 'api/vendor/tool')?.name).toBe('tool-renamed')

    // An empty re-sync clears the workspace.
    expect(repos.sync(workspaceId, [])).toEqual([])
    expect(repos.list(workspaceId)).toEqual([])
  })

  it('scopes rows to their workspace', async () => {
    const dir = await tempDir()
    const db = open(join(dir, 'cache.db'))
    const workspaces = new WorkspaceStore(db)
    const repos = new RepoStore(db)
    const a = workspaces.upsert(join(dir, 'a'), { at: 1000 }).id
    const b = workspaces.upsert(join(dir, 'b'), { at: 2000 }).id

    const entry = record({ relPath: 'api', id: 'C:/ws/api/.git' })
    repos.sync(a, [entry])
    repos.sync(b, [{ ...entry, name: 'other' }])

    expect(repos.findByRelPath(a, 'api')?.name).toBe('api')
    expect(repos.findByRelPath(b, 'api')?.name).toBe('other')
    expect(repos.findByRelPath(a, 'missing')).toBeNull()
  })
})

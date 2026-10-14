import type { Database } from 'better-sqlite3'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { CommitInfo, GitRef, RepoRecord, RepoStatus } from '@gitreedesk/shared'
import { CacheStore } from '../src/cache'
import { openCacheDatabase } from '../src/db'
import { RepoStore } from '../src/repos'
import { WorkspaceStore } from '../src/workspaces'

let dirs: string[] = []
let dbs: Database[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'gtd-cache-'))
  dirs.push(dir)
  return dir
}

function open(file: string): Database {
  const db = openCacheDatabase(file)
  dbs.push(db)
  return db
}

const status: RepoStatus = {
  head: { ref: 'main', sha: 'a'.repeat(40), detached: false, unborn: false },
  upstream: { ref: 'origin/main', ahead: 1, behind: 2 },
  staged: [{ path: 'docs/中文 笔记.md', origPath: 'docs/笔记.md', kind: 'renamed' }],
  unstaged: [],
  untracked: ['notes/'],
  conflicted: [],
  operation: 'none',
  stashCount: 1,
  submodulesPresent: false
}

const ref: GitRef = {
  name: 'main',
  fullName: 'refs/heads/main',
  kind: 'branch',
  annotated: false,
  sha: 'b'.repeat(40),
  isHead: true,
  upstream: 'origin/main',
  ahead: 1,
  behind: 0,
  subject: 'init',
  updatedAt: '2026-01-01T00:00:00+00:00'
}

function commit(sha: string, date: string, subject: string): CommitInfo {
  return {
    sha,
    parents: [],
    author: { name: 'Ada', email: 'ada@example.com', date },
    committer: { name: 'Ada', email: 'ada@example.com', date },
    subject,
    refs: ['HEAD -> main']
  }
}

function record(): RepoRecord {
  return {
    id: 'C:/ws/api/.git',
    root: 'C:/ws',
    relPath: 'api',
    path: 'C:/ws/api',
    gitDir: 'C:/ws/api/.git',
    commonDir: 'C:/ws/api/.git',
    kind: 'repository',
    parentId: null,
    name: 'api',
    external: false,
    hasSubmodules: false
  }
}

afterEach(async () => {
  for (const db of dbs) db.close()
  dbs = []
  for (const dir of dirs) await rm(dir, { recursive: true, force: true })
  dirs = []
})

describe('CacheStore', () => {
  async function setup(): Promise<{ cache: CacheStore; repos: RepoStore; workspaceId: number; repoRowId: number }> {
    const dir = await tempDir()
    const db = open(join(dir, 'cache.db'))
    const workspaceId = new WorkspaceStore(db).upsert(join(dir, 'ws'), { at: 1000 }).id
    const repos = new RepoStore(db)
    const repoRowId = repos.sync(workspaceId, [record()])[0]?.id ?? 0
    return { cache: new CacheStore(db), repos, workspaceId, repoRowId }
  }

  it('round-trips a repository status', async () => {
    const { cache, repoRowId } = await setup()
    const at = Date.now() - 100
    cache.saveStatus(repoRowId, status, at)

    const cached = cache.loadStatus(repoRowId)
    expect(cached?.status).toEqual(status)
    expect(cached?.updatedAt).toBe(at)
    expect(cache.loadStatus(repoRowId, 50)).toBeNull()
    expect(cache.loadStatus(repoRowId, 60_000)).not.toBeNull()
  })

  it('keeps refs when the status is refreshed and vice versa', async () => {
    const { cache, repoRowId } = await setup()
    cache.saveRefs(repoRowId, [ref], 5000)
    cache.saveStatus(repoRowId, status, 6000)

    expect(cache.loadRefs(repoRowId)?.refs).toEqual([ref])
    expect(cache.loadStatus(repoRowId)?.status).toEqual(status)
    expect(cache.loadRefs(repoRowId)?.updatedAt).toBe(6000)

    cache.saveRefs(repoRowId, [ref], 7000)
    expect(cache.loadStatus(repoRowId)?.status).toEqual(status)
  })

  it('returns null for a repository without a cache row', async () => {
    const { cache } = await setup()
    expect(cache.loadStatus(999)).toBeNull()
    expect(cache.loadRefs(999)).toBeNull()
  })

  it('upserts commits by sha and orders by author timestamp', async () => {
    const { cache, repoRowId } = await setup()
    const older = commit('1'.repeat(40), '2026-01-01T10:00:00+08:00', 'first')
    const newer = commit('2'.repeat(40), '2026-02-01T10:00:00+08:00', 'second')
    cache.saveCommits(repoRowId, [older, newer])

    const loaded = cache.loadCommits(repoRowId)
    expect(loaded.map((entry) => entry.sha)).toEqual(['2'.repeat(40), '1'.repeat(40)])
    expect(loaded[1]?.author).toEqual(older.author)
    expect(loaded[0]?.refs).toEqual(['HEAD -> main'])

    cache.saveCommits(repoRowId, [{ ...newer, subject: 'second, amended' }])
    const again = cache.loadCommits(repoRowId, { limit: 1 })
    expect(again).toHaveLength(1)
    expect(again[0]?.subject).toBe('second, amended')
  })

  it('removes cache rows when the repository disappears from the workspace', async () => {
    const { cache, repos, workspaceId, repoRowId } = await setup()
    cache.saveStatus(repoRowId, status, 5000)
    cache.saveCommits(repoRowId, [commit('3'.repeat(40), '2026-01-01T10:00:00Z', 'x')])

    repos.sync(workspaceId, [])
    expect(cache.loadStatus(repoRowId)).toBeNull()
    expect(cache.loadCommits(repoRowId)).toEqual([])
  })
})

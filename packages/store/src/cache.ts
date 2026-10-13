import type { Database } from 'better-sqlite3'
import type { CommitInfo, GitRef, PersonInfo, RepoStatus } from '@gitreedesk/shared'

export interface CachedStatus {
  status: RepoStatus
  updatedAt: number
}

export interface CachedRefs {
  refs: GitRef[]
  updatedAt: number
}

export interface CachedCommit {
  sha: string
  parents: string[]
  author: PersonInfo
  subject: string
  refs: string[]
  /** Author timestamp, epoch milliseconds. */
  timestamp: number
}

interface RepoCacheDbRow {
  status_json: string | null
  refs_json: string | null
  updated_at: number
}

interface CommitDbRow {
  sha: string
  parents: string
  author: string
  ts: number
  subject: string
  refs: string
}

function parseJson<T>(text: string | null): T | null {
  if (text === null) return null
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

export class CacheStore {
  readonly #db: Database

  constructor(db: Database) {
    this.#db = db
  }

  saveStatus(repoRowId: number, status: RepoStatus, at = Date.now()): void {
    this.#db
      .prepare<[number, string, number]>(
        `INSERT INTO repo_cache (repo_id, status_json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(repo_id) DO UPDATE SET
           status_json = excluded.status_json,
           updated_at = excluded.updated_at`
      )
      .run(repoRowId, JSON.stringify(status), at)
  }

  loadStatus(repoRowId: number, maxAgeMs?: number): CachedStatus | null {
    const row = this.#db
      .prepare<[number], RepoCacheDbRow>('SELECT status_json, refs_json, updated_at FROM repo_cache WHERE repo_id = ?')
      .get(repoRowId)
    if (row === undefined) return null
    if (maxAgeMs !== undefined && Date.now() - row.updated_at > maxAgeMs) return null
    const status = parseJson<RepoStatus>(row.status_json)
    return status === null ? null : { status, updatedAt: row.updated_at }
  }

  saveRefs(repoRowId: number, refs: readonly GitRef[], at = Date.now()): void {
    this.#db
      .prepare<[number, string, number]>(
        `INSERT INTO repo_cache (repo_id, refs_json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(repo_id) DO UPDATE SET
           refs_json = excluded.refs_json,
           updated_at = excluded.updated_at`
      )
      .run(repoRowId, JSON.stringify(refs), at)
  }

  loadRefs(repoRowId: number, maxAgeMs?: number): CachedRefs | null {
    const row = this.#db
      .prepare<[number], RepoCacheDbRow>('SELECT status_json, refs_json, updated_at FROM repo_cache WHERE repo_id = ?')
      .get(repoRowId)
    if (row === undefined) return null
    if (maxAgeMs !== undefined && Date.now() - row.updated_at > maxAgeMs) return null
    const refs = parseJson<GitRef[]>(row.refs_json)
    return refs === null ? null : { refs, updatedAt: row.updated_at }
  }

  saveCommits(repoRowId: number, commits: readonly CommitInfo[]): void {
    const upsert = this.#db.prepare<[number, string, string, string, number, string, string]>(
      `INSERT OR REPLACE INTO commits_cache (repo_id, sha, parents, author, ts, subject, refs)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    const run = this.#db.transaction(() => {
      for (const commit of commits) {
        const timestamp = Date.parse(commit.author.date)
        upsert.run(
          repoRowId,
          commit.sha,
          JSON.stringify(commit.parents),
          JSON.stringify(commit.author),
          Number.isNaN(timestamp) ? 0 : timestamp,
          commit.subject,
          JSON.stringify(commit.refs)
        )
      }
    })
    run()
  }

  loadCommits(repoRowId: number, options: { limit?: number } = {}): CachedCommit[] {
    const rows = this.#db
      .prepare<[number, number], CommitDbRow>(
        'SELECT sha, parents, author, ts, subject, refs FROM commits_cache WHERE repo_id = ? ORDER BY ts DESC LIMIT ?'
      )
      .all(repoRowId, options.limit ?? 100)

    const commits: CachedCommit[] = []
    for (const row of rows) {
      const parents = parseJson<string[]>(row.parents)
      const author = parseJson<PersonInfo>(row.author)
      const refs = parseJson<string[]>(row.refs)
      if (parents === null || author === null || refs === null) continue
      commits.push({ sha: row.sha, parents, author, subject: row.subject, refs, timestamp: row.ts })
    }
    return commits
  }
}

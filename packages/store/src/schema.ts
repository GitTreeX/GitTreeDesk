export const SCHEMA_VERSION = 1

export interface Migration {
  version: number
  statements: string[]
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE IF NOT EXISTS workspaces (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        root TEXT NOT NULL UNIQUE,
        name TEXT,
        last_opened_at INTEGER,
        trusted INTEGER NOT NULL DEFAULT 0
      )`,
      `CREATE TABLE IF NOT EXISTS repos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        rel_path TEXT NOT NULL,
        git_dir TEXT NOT NULL,
        common_dir TEXT NOT NULL,
        kind TEXT NOT NULL,
        parent_repo_id INTEGER,
        name TEXT NOT NULL,
        UNIQUE(workspace_id, rel_path)
      )`,
      `CREATE INDEX IF NOT EXISTS repos_workspace ON repos(workspace_id)`,
      `CREATE TABLE IF NOT EXISTS repo_cache (
        repo_id INTEGER PRIMARY KEY REFERENCES repos(id) ON DELETE CASCADE,
        status_json TEXT,
        refs_json TEXT,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS commits_cache (
        repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
        sha TEXT NOT NULL,
        parents TEXT NOT NULL,
        author TEXT NOT NULL,
        ts INTEGER NOT NULL,
        subject TEXT NOT NULL,
        refs TEXT NOT NULL,
        PRIMARY KEY (repo_id, sha)
      )`,
      `CREATE INDEX IF NOT EXISTS commits_cache_repo_ts ON commits_cache(repo_id, ts)`,
      `CREATE TABLE IF NOT EXISTS ui_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS oplog (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo_id INTEGER,
        op TEXT NOT NULL,
        backup_ref TEXT,
        at INTEGER NOT NULL,
        undo_state TEXT
      )`
    ]
  }
]

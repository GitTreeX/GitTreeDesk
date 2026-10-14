import { readdir, realpath, stat } from 'node:fs/promises'
import { basename, join, relative, resolve } from 'node:path'
import type { Dirent } from 'node:fs'
import type { DiscoveryResult, DiscoveryStats, RepoKind, RepoRecord, WorkspaceConfig } from '@gitreedesk/shared'
import { type GitPool, listWorktrees, pathExists, resolveRepoDirs } from '@gitreedesk/git-core'
import { createPathMatcher } from './glob'

const BUILTIN_SKIP = new Set(['node_modules', '.git', '.svn', '.hg'])

export interface DiscoverOptions {
  root: string
  config: WorkspaceConfig
  pool: GitPool
  /**
   * Restricts the scan to a subtree of the workspace (absolute path). Records
   * are still rooted at `root`; linked worktrees of repositories found inside
   * the scope are attributed as usual. Used for rescans after filesystem events.
   */
  scope?: string
  signal?: AbortSignal
}

interface Candidate {
  /** Native absolute path of the directory carrying a `.git` marker or a bare git dir shape. */
  path: string
}

interface CandidateDirs {
  candidate: Candidate
  /** All path fields below are realpaths with forward slashes. */
  path: string
  gitDir: string
  commonDir: string
  id: string
  bare: boolean
}

const toPosix = (value: string): string => value.replace(/\\/g, '/')

async function realpathPosix(value: string): Promise<string> {
  return toPosix(await realpath(value))
}

function isInside(rootPosix: string, pathPosix: string): boolean {
  return pathPosix === rootPosix || pathPosix.startsWith(`${rootPosix}/`)
}

/** Root-relative depth of a directory: the root itself is depth 0. */
function depthOf(root: string, dir: string): number {
  const rel = toPosix(relative(root, dir))
  if (rel === '' || rel === '.') return 0
  return rel.split('/').length
}

/**
 * A bare git directory carries `HEAD`, `objects/` and `refs/` directly and has
 * no `.git` marker, so the scan checks its shape to find it.
 */
function looksLikeBareGitDir(entries: readonly Dirent[]): boolean {
  let head = false
  let objects = false
  let refs = false
  for (const entry of entries) {
    if (entry.name === 'HEAD' && entry.isFile()) head = true
    else if (entry.name === 'objects' && entry.isDirectory()) objects = true
    else if (entry.name === 'refs' && entry.isDirectory()) refs = true
  }
  return head && objects && refs
}

interface ScanOutcome {
  candidates: Candidate[]
  dirsScanned: number
  budgetExceeded: boolean
  maxDepthReached: boolean
}

async function scanDirectories(
  root: string,
  base: string,
  startDepth: number,
  config: WorkspaceConfig,
  signal: AbortSignal | undefined,
  issues: string[]
): Promise<ScanOutcome> {
  const exclude = createPathMatcher(config.exclude)
  const { maxDepth, maxEntries, followSymlinks } = config.scan

  const candidates: Candidate[] = []
  const queue: { dir: string; depth: number }[] = [{ dir: base, depth: startDepth }]
  const visited = new Set<string>()
  if (followSymlinks) visited.add(await realpathPosix(root))

  let dirsScanned = 0
  let budgetExceeded = false
  let maxDepthReached = false

  while (queue.length > 0) {
    if (signal?.aborted === true) throw new DOMException('Discovery aborted', 'AbortError')
    if (dirsScanned >= maxEntries) {
      budgetExceeded = true
      break
    }

    const current = queue.shift()
    if (current === undefined) break
    dirsScanned += 1

    let entries: Dirent[]
    try {
      entries = await readdir(current.dir, { withFileTypes: true })
    } catch {
      issues.push(`Cannot read directory: ${current.dir}`)
      continue
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))

    const bareLike = looksLikeBareGitDir(entries)

    let hasMarker = false
    for (const entry of entries) {
      const name = entry.name
      if (name === '.git') {
        hasMarker = true
        continue
      }
      if (BUILTIN_SKIP.has(name)) continue
      // A bare git directory has no worktree; nothing inside it is scannable.
      if (bareLike) continue

      const childPath = join(current.dir, name)
      if (exclude(toPosix(relative(root, childPath)))) continue

      const isLink = entry.isSymbolicLink()
      if (!entry.isDirectory() && !isLink) continue
      if (isLink) {
        if (!followSymlinks) continue
        try {
          const real = await realpathPosix(childPath)
          if (visited.has(real)) continue
          visited.add(real)
          if (!(await stat(childPath)).isDirectory()) continue
        } catch {
          continue
        }
      }

      if (current.depth + 1 > maxDepth) {
        maxDepthReached = true
        continue
      }
      queue.push({ dir: childPath, depth: current.depth + 1 })
    }

    if (hasMarker || bareLike) candidates.push({ path: current.dir })
  }

  return { candidates, dirsScanned, budgetExceeded, maxDepthReached }
}

async function confirmCandidates(
  candidates: Candidate[],
  pool: GitPool,
  signal: AbortSignal | undefined,
  issues: string[]
): Promise<CandidateDirs[]> {
  const confirmed = await Promise.all(
    candidates.map((candidate) =>
      pool.run(
        async (taskSignal): Promise<CandidateDirs | null> => {
          try {
            const dirs = await resolveRepoDirs(candidate.path, { signal: taskSignal })
            return {
              candidate,
              path: await realpathPosix(dirs.worktreePath ?? candidate.path),
              gitDir: await realpathPosix(dirs.gitDir),
              commonDir: await realpathPosix(dirs.commonDir),
              id: await realpathPosix(dirs.commonDir),
              bare: dirs.bare
            }
          } catch {
            return null
          }
        },
        { priority: 'background', signal }
      )
    )
  )

  const result: CandidateDirs[] = []
  for (let i = 0; i < confirmed.length; i += 1) {
    const entry = confirmed[i]
    if (entry === null || entry === undefined) {
      issues.push(`Skipped unconfirmed repository: ${candidates[i]?.path ?? 'unknown'}`)
      continue
    }
    result.push(entry)
  }
  return result
}

function findPathAncestor(record: RepoRecord, records: readonly RepoRecord[]): string | null {
  let best: RepoRecord | null = null
  for (const candidate of records) {
    if (candidate.path === record.path || !record.path.startsWith(`${candidate.path}/`)) continue
    if (best === null || candidate.path.length > best.path.length) best = candidate
  }
  return best === null ? null : best.id
}

/**
 * Fills in parent links for records whose parent was not determined during
 * construction: submodule checkouts, linked worktrees of a known main checkout,
 * and nested repositories. Idempotent.
 */
export function linkRecordParents(records: readonly RepoRecord[]): void {
  const mainIds: string[] = []
  for (const record of records) {
    if (record.gitDir === record.id) mainIds.push(record.id)
  }

  // Submodule checkouts live under `<superproject git dir>/modules/`.
  for (const record of records) {
    if (record.parentId !== null) continue
    let owner: string | null = null
    for (const id of mainIds) {
      if (id !== record.id && record.id.startsWith(`${id}/modules/`) && (owner === null || id.length > owner.length)) {
        owner = id
      }
    }
    if (owner !== null) record.parentId = owner
  }

  // A linked worktree whose main checkout is present nests under it even when
  // the two were discovered by separate scans.
  for (const record of records) {
    if (record.parentId !== null || record.kind !== 'worktree') continue
    const main = records.find(
      (candidate) => candidate !== record && candidate.id === record.id && candidate.kind !== 'worktree'
    )
    if (main !== undefined) record.parentId = record.id
  }

  // Nested repositories attach to the nearest checkout that contains them.
  for (const record of records) {
    if (record.parentId !== null) continue
    record.parentId = findPathAncestor(record, records)
  }
}

function emptyResult(): DiscoveryResult {
  const stats: DiscoveryStats = {
    dirsScanned: 0,
    candidates: 0,
    repos: 0,
    budgetExceeded: false,
    maxDepthReached: false
  }
  return { repos: [], stats, issues: [] }
}

export async function discoverRepositories(options: DiscoverOptions): Promise<DiscoveryResult> {
  const { config, pool, signal } = options
  const issues: string[] = []

  const root = resolve(options.root)
  const rootPosix = await realpathPosix(root)
  const scanBase = options.scope === undefined ? root : resolve(options.scope)
  if (!(await pathExists(scanBase))) return emptyResult()

  const startDepth = depthOf(root, scanBase)
  const scan = await scanDirectories(root, scanBase, startDepth, config, signal, issues)
  const confirmed = await confirmCandidates(scan.candidates, pool, signal, issues)

  const groups = new Map<string, CandidateDirs[]>()
  for (const entry of confirmed) {
    const members = groups.get(entry.id)
    if (members === undefined) groups.set(entry.id, [entry])
    else members.push(entry)
  }

  const records: RepoRecord[] = []
  const seen = new Set<string>()

  for (const [id, members] of groups) {
    const main = members.find((member) => member.gitDir === id) ?? null

    for (const member of members) {
      const key = `${id}\u0000${member.path}`
      if (seen.has(key)) continue
      seen.add(key)

      const isMain = member === main
      const kind: RepoKind = isMain ? (member.bare ? 'bare' : 'repository') : 'worktree'
      records.push({
        id,
        root: rootPosix,
        relPath: toPosix(relative(rootPosix, member.path)),
        path: member.path,
        gitDir: member.gitDir,
        commonDir: member.commonDir,
        kind,
        // A linked worktree whose main checkout was not discovered has no parent row to nest under.
        parentId: isMain ? null : main === null ? null : id,
        name: basename(member.path),
        external: !isInside(rootPosix, member.path),
        hasSubmodules: false
      })
    }
  }

  // Linked worktrees are enumerated from `git worktree list`: in-root ones were already
  // found by the scan and gain their lock/prune state here; the rest are added. Linked
  // worktrees live under `<commonDir>/worktrees/`, so repos without that directory skip
  // the spawn entirely. The remaining listings run concurrently through the pool.
  const recordByKey = new Map(records.map((record) => [`${record.id}\u0000${record.path}`, record]))
  const mainRecords = records.filter((record) => record.kind !== 'bare' && record.gitDir === record.id)
  await Promise.all(
    mainRecords.map(async (main) => {
      if (signal?.aborted === true) throw new DOMException('Discovery aborted', 'AbortError')
      if (!(await pathExists(join(main.commonDir, 'worktrees')))) return

      let worktrees
      try {
        worktrees = await pool.run((taskSignal) => listWorktrees({ repoPath: main.path, signal: taskSignal }), {
          priority: 'background',
          signal
        })
      } catch {
        issues.push(`Cannot list worktrees of: ${main.path}`)
        return
      }

      for (const worktree of worktrees) {
        if (worktree.bare) continue
        let worktreePath: string
        try {
          worktreePath = await realpathPosix(worktree.path)
        } catch {
          // The folder is gone; keep a prunable record so the leftover can be pruned.
          worktreePath = toPosix(worktree.path)
        }
        // A submodule checkout reports its own git dir as the "main worktree"; the actual
        // checkout is discovered by the scan, so this entry carries no new information.
        if (worktreePath === main.gitDir) continue

        const key = `${main.id}\u0000${worktreePath}`
        const existing = recordByKey.get(key)
        if (existing !== undefined) {
          existing.worktreeLocked = worktree.locked
          existing.worktreePrunable = worktree.prunable
          continue
        }

        let gitDir = ''
        let commonDir = main.commonDir
        try {
          const dirs = await resolveRepoDirs(worktreePath, { signal })
          gitDir = await realpathPosix(dirs.gitDir)
          commonDir = await realpathPosix(dirs.commonDir)
        } catch {
          // Keep the record; status reads resolve the directories again on demand.
        }

        const record: RepoRecord = {
          id: main.id,
          root: rootPosix,
          relPath: toPosix(relative(rootPosix, worktreePath)),
          path: worktreePath,
          gitDir,
          commonDir,
          kind: 'worktree',
          parentId: main.id,
          name: basename(worktreePath),
          external: !isInside(rootPosix, worktreePath),
          hasSubmodules: false,
          worktreeLocked: worktree.locked,
          worktreePrunable: worktree.prunable
        }
        recordByKey.set(key, record)
        records.push(record)
      }
    })
  )

  linkRecordParents(records)

  await Promise.all(
    records.map(async (record) => {
      if (record.kind === 'bare') return
      record.hasSubmodules = await pathExists(join(record.path, '.gitmodules'))
    })
  )

  records.sort((a, b) => a.relPath.localeCompare(b.relPath))

  const stats: DiscoveryStats = {
    dirsScanned: scan.dirsScanned,
    candidates: scan.candidates.length,
    repos: records.length,
    budgetExceeded: scan.budgetExceeded,
    maxDepthReached: scan.maxDepthReached
  }

  return { repos: records, stats, issues }
}

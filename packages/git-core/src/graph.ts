import type { CommitDetails, CommitFileStat } from '@gitreedesk/shared'
import { isCommitPushed } from './commit'
import { parseNameStatusZ } from './diff'
import { runGit, runGitOrThrow } from './run'

const MARKS_LIMIT = 5000

export interface UpstreamMarks {
  /** Upstream ref of the current branch (`origin/main`); `null` when none is set. */
  upstream: string | null
  /** Commits on HEAD but not on the upstream — not pushed yet. */
  outgoing: string[]
  /** Commits on the upstream but not on HEAD — not pulled yet. */
  incoming: string[]
}

export interface ReadUpstreamMarksOptions {
  repoPath: string
  signal?: AbortSignal
}

/** Incoming/outgoing sets of the current branch relative to its upstream. */
export async function readUpstreamMarks(
  options: ReadUpstreamMarksOptions
): Promise<UpstreamMarks> {
  const probe = await runGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], {
    cwd: options.repoPath,
    signal: options.signal
  })
  const upstream = probe.code === 0 ? probe.stdout.trim() : ''
  if (upstream.length === 0) return { upstream: null, outgoing: [], incoming: [] }

  const [outgoing, incoming] = await Promise.all([
    revList(options.repoPath, `${upstream}..HEAD`, options.signal),
    revList(options.repoPath, `HEAD..${upstream}`, options.signal)
  ])
  return { upstream, outgoing, incoming }
}

async function revList(repoPath: string, range: string, signal?: AbortSignal): Promise<string[]> {
  const result = await runGit(['rev-list', `--max-count=${String(MARKS_LIMIT)}`, range], {
    cwd: repoPath,
    signal
  })
  if (result.code !== 0) return []
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

const DETAILS_FORMAT = ['%H', '%P', '%an', '%ae', '%aI', '%cn', '%ce', '%cI', '%B'].join('%x00')
const DETAILS_FIELDS = 8

export interface CommitDetailsOptions {
  repoPath: string
  sha: string
  signal?: AbortSignal
}

/** Full message, identities, parents and the per-file line stats of one commit. */
export async function readCommitDetails(options: CommitDetailsOptions): Promise<CommitDetails> {
  const { sha } = options
  if (sha.length === 0 || sha.startsWith('-')) throw new Error(`Invalid revision: ${sha}`)

  const show = await runGitOrThrow(
    ['show', '--no-color', '-s', `--format=${DETAILS_FORMAT}`, sha],
    { cwd: options.repoPath, signal: options.signal }
  )
  // `%B` renders last and commit messages cannot hold NULs, so the message is
  // whatever follows the eight leading fields.
  const tokens = show.stdout.split('\0')
  const parents = (tokens[1] ?? '').split(' ').filter((parent) => parent.length > 0)
  const message = tokens.slice(DETAILS_FIELDS).join('\0').replace(/\n+$/, '')
  if ((tokens[0] ?? '').length === 0) {
    throw new Error(`Not a commit: ${sha}`)
  }

  const parent = parents[0]
  const statusArgs =
    parent === undefined
      ? ['show', '--no-color', '--name-status', '-z', '-M', '--format=', sha]
      : ['diff', '--name-status', '-z', '-M', parent, sha]
  const numstatArgs =
    parent === undefined
      ? ['show', '--no-color', '--numstat', '-z', '-M', '--format=', sha]
      : ['diff', '--numstat', '-z', '-M', parent, sha]

  const [statusResult, numstatResult, pushed] = await Promise.all([
    runGitOrThrow(statusArgs, { cwd: options.repoPath, signal: options.signal }),
    runGitOrThrow(numstatArgs, { cwd: options.repoPath, signal: options.signal }),
    isCommitPushed({ repoPath: options.repoPath, rev: sha, signal: options.signal })
  ])

  const changes = parseNameStatusZ(statusResult.stdout)
  const stats = parseNumstatZ(numstatResult.stdout)
  const files: CommitFileStat[] = changes.map((change) => {
    const stat = stats.get(change.path)
    return {
      path: change.path,
      ...(change.origPath !== undefined ? { origPath: change.origPath } : {}),
      kind: change.kind,
      additions: stat?.additions ?? null,
      deletions: stat?.deletions ?? null
    }
  })

  return {
    sha: tokens[0] ?? sha,
    message,
    author: { name: tokens[2] ?? '', email: tokens[3] ?? '', date: tokens[4] ?? '' },
    committer: { name: tokens[5] ?? '', email: tokens[6] ?? '', date: tokens[7] ?? '' },
    parents,
    files,
    pushed
  }
}

export interface NumstatEntry {
  additions: number | null
  deletions: number | null
  origPath?: string
}

/**
 * `git diff --numstat -z` output: `adds<TAB>dels<TAB>path<NUL>` per file, and
 * `adds<TAB>dels<TAB><NUL>old<NUL>new<NUL>` for renames and copies. Binary
 * files count as `-` on both sides.
 */
export function parseNumstatZ(stdout: string): Map<string, NumstatEntry> {
  const tokens = stdout.split('\0')
  const stats = new Map<string, NumstatEntry>()
  const count = (value: string): number | null => {
    if (value === '-') return null
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) ? parsed : null
  }

  let i = 0
  while (i < tokens.length) {
    const token = tokens[i] ?? ''
    i += 1
    if (token.length === 0) continue
    const fields = token.split('\t')
    if (fields.length < 3) continue
    const additions = count(fields[0] ?? '')
    const deletions = count(fields[1] ?? '')
    const path = fields[2] ?? ''
    if (path.length > 0) {
      stats.set(path, { additions, deletions })
      continue
    }
    const origPath = tokens[i] ?? ''
    const newPath = tokens[i + 1] ?? ''
    i += 2
    if (newPath.length > 0) {
      stats.set(newPath, { additions, deletions, origPath })
    }
  }
  return stats
}

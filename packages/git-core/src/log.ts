import type { CommitInfo, FileHistoryEntry } from '@gitreedesk/shared'
import { GitCommandError } from './errors'
import { runGit } from './run'
import { LITERAL_PATHS_ENV } from './staging'

const FORMAT = ['%H', '%P', '%an', '%ae', '%aI', '%cn', '%ce', '%cI', '%s', '%D', '%b'].join('%x00')
const FIELDS_PER_COMMIT = 11

function parseDecoration(value: string): string[] {
  if (value.length === 0) return []
  return value.split(', ').map((entry) => {
    if (entry.startsWith('HEAD -> ')) return entry.slice('HEAD -> '.length)
    if (entry.startsWith('tag: ')) return entry.slice('tag: '.length)
    return entry
  })
}

function commitFromFields(fields: readonly string[]): CommitInfo {
  const parents = (fields[1] ?? '').split(' ').filter((parent) => parent.length > 0)
  return {
    sha: fields[0] ?? '',
    parents,
    author: { name: fields[2] ?? '', email: fields[3] ?? '', date: fields[4] ?? '' },
    committer: { name: fields[5] ?? '', email: fields[6] ?? '', date: fields[7] ?? '' },
    subject: fields[8] ?? '',
    refs: parseDecoration(fields[9] ?? ''),
    body: (fields[10] ?? '').trim()
  }
}

export function parseLog(stdout: string): CommitInfo[] {
  const tokens = stdout.split('\0')
  // `-z` terminates every record with NUL, so the output ends with an empty token.
  if (tokens[tokens.length - 1] === '') tokens.pop()

  const commits: CommitInfo[] = []
  for (let i = 0; i + FIELDS_PER_COMMIT <= tokens.length; i += FIELDS_PER_COMMIT) {
    if ((tokens[i] ?? '').length === 0) continue
    commits.push(commitFromFields(tokens.slice(i, i + FIELDS_PER_COMMIT)))
  }
  return commits
}

export interface LogFilters {
  /** Literal substring of the author name or email. */
  author?: string
  /** `--since` boundary; any date git understands. */
  since?: string
  /** `--until` boundary. */
  until?: string
  /** Case-insensitive literal substring of the commit message. */
  grep?: string
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function appendFilterArgs(args: string[], filters: LogFilters): void {
  if (filters.author !== undefined && filters.author.length > 0) {
    args.push(`--author=${escapeRegex(filters.author)}`)
  }
  if (filters.since !== undefined && filters.since.length > 0) args.push(`--since=${filters.since}`)
  if (filters.until !== undefined && filters.until.length > 0) args.push(`--until=${filters.until}`)
  if (filters.grep !== undefined && filters.grep.length > 0) {
    args.push('--regexp-ignore-case', `--grep=${escapeRegex(filters.grep)}`)
  }
}

function appendStartArgs(args: string[], options: { revs?: readonly string[]; all?: boolean }): void {
  // `--all` would also walk backup and stash refs, so the explicit trio stands in.
  if (options.all === true) args.push('--branches', '--remotes', '--tags')
  for (const rev of options.revs ?? []) {
    if (rev.startsWith('-')) throw new Error(`Invalid revision: ${rev}`)
    args.push(rev)
  }
}

/** `HEAD` as a revision argument fails on an unborn branch. */
function isAmbiguousHead(stderr: string): boolean {
  return /ambiguous argument 'HEAD'/.test(stderr)
}

export interface LogOptions extends LogFilters {
  repoPath: string
  maxCount?: number
  skip?: number
  revs?: readonly string[]
  path?: string
  /** Oldest first; used to load replay plans. */
  reverse?: boolean
  /** Walks every branch, remote-tracking branch, tag and HEAD instead of `revs`. */
  all?: boolean
  /** Keeps the walk of each line of development contiguous for graph display. */
  topoOrder?: boolean
  signal?: AbortSignal
}

export interface LogResult {
  commits: CommitInfo[]
  hasMore: boolean
}

export async function logCommits(options: LogOptions): Promise<LogResult> {
  const maxCount = options.maxCount ?? 50
  const buildArgs = (withHead: boolean): string[] => {
    const args = ['log', '-z', `--max-count=${String(maxCount + 1)}`, `--format=${FORMAT}`]
    if (options.reverse === true) args.push('--reverse')
    if (options.topoOrder === true) args.push('--topo-order')
    appendFilterArgs(args, options)
    appendStartArgs(args, options)
    if (withHead) args.push('HEAD')
    if (options.skip !== undefined && options.skip > 0) args.push(`--skip=${String(options.skip)}`)
    if (options.path !== undefined) args.push('--', options.path)
    return args
  }
  const runOptions = {
    cwd: options.repoPath,
    env: options.path === undefined ? undefined : LITERAL_PATHS_ENV,
    signal: options.signal
  }

  // `--branches --remotes --tags` misses a detached HEAD, but a plain `HEAD`
  // argument fails on an unborn branch — one retry covers both readers.
  let result = await runGit(buildArgs(options.all === true), runOptions)
  if (result.code !== 0 && options.all === true && isAmbiguousHead(result.stderr)) {
    result = await runGit(buildArgs(false), runOptions)
  }

  if (result.code !== 0) {
    const explicitRevs = options.revs !== undefined && options.revs.length > 0
    const unborn = /does not have any commits yet|ambiguous argument 'HEAD'/.test(result.stderr)
    if (!explicitRevs && unborn) return { commits: [], hasMore: false }
    throw new GitCommandError(`git log failed (exit code ${String(result.code)})`, {
      args: buildArgs(options.all === true),
      cwd: options.repoPath,
      code: result.code,
      stdout: result.stdout,
      stderr: result.stderr
    })
  }

  const commits = parseLog(result.stdout)
  if (commits.length > maxCount) return { commits: commits.slice(0, maxCount), hasMore: true }
  return { commits, hasMore: false }
}

export interface CountCommitsOptions extends LogFilters {
  repoPath: string
  revs?: readonly string[]
  /** Counts every branch, remote-tracking branch, tag and HEAD instead of `revs`. */
  all?: boolean
  path?: string
  signal?: AbortSignal
}

/** Size of the history a matching `logCommits` call would walk, ignoring paging. */
export async function countCommits(options: CountCommitsOptions): Promise<number> {
  const buildArgs = (withHead: boolean): string[] => {
    const args = ['rev-list', '--count']
    appendFilterArgs(args, options)
    // `log` defaults to HEAD on its own, but `rev-list` treats a missing start
    // point as a usage error — the implicit HEAD is spelled out instead.
    const explicitRevs = options.revs !== undefined && options.revs.length > 0
    if (!explicitRevs && options.all !== true) args.push('HEAD')
    appendStartArgs(args, options)
    if (withHead) args.push('HEAD')
    if (options.path !== undefined) args.push('--', options.path)
    return args
  }
  const runOptions = {
    cwd: options.repoPath,
    env: options.path === undefined ? undefined : LITERAL_PATHS_ENV,
    signal: options.signal
  }

  let result = await runGit(buildArgs(options.all === true), runOptions)
  if (result.code !== 0 && options.all === true && isAmbiguousHead(result.stderr)) {
    result = await runGit(buildArgs(false), runOptions)
  }

  if (result.code !== 0) {
    const explicitRevs = options.revs !== undefined && options.revs.length > 0
    const unborn = /does not have any commits yet|ambiguous argument 'HEAD'/.test(result.stderr)
    if (!explicitRevs && unborn) return 0
    throw new GitCommandError(`git rev-list failed (exit code ${String(result.code)})`, {
      args: buildArgs(options.all === true),
      cwd: options.repoPath,
      code: result.code,
      stdout: result.stdout,
      stderr: result.stderr
    })
  }
  const value = Number.parseInt(result.stdout.trim(), 10)
  return Number.isFinite(value) ? value : 0
}

export interface FileHistoryOptions {
  repoPath: string
  path: string
  maxCount?: number
  skip?: number
  /** Follow the file across renames; git requires exactly one path for this. */
  follow?: boolean
  signal?: AbortSignal
}

export interface FileHistoryResult {
  entries: FileHistoryEntry[]
  hasMore: boolean
}

/**
 * `git log` writes the fixed-width commit fields and then a diff section whose
 * length depends on the commit, so records are located by a `%x01` mark rather
 * than by counting tokens.
 */
const RECORD_MARK = '\u0001'
const RECORD_FORMAT = `%x01${FORMAT}`

function parseFileHistory(stdout: string, requestedPath: string): FileHistoryEntry[] {
  const tokens = stdout.split('\0')
  if (tokens[tokens.length - 1] === '') tokens.pop()

  const entries: FileHistoryEntry[] = []
  for (let i = 0; i < tokens.length; i += 1) {
    if (!(tokens[i] ?? '').startsWith(RECORD_MARK)) continue
    const fields = tokens
      .slice(i, i + FIELDS_PER_COMMIT)
      .map((token, index) => (index === 0 ? token.slice(RECORD_MARK.length) : token))
    if (fields.length < FIELDS_PER_COMMIT) break

    let filePath = requestedPath
    let previousPath: string | null = null
    let next = i + FIELDS_PER_COMMIT
    while (next < tokens.length && !(tokens[next] ?? '').startsWith(RECORD_MARK)) {
      // The diff section opens with the newline that separates it from the header.
      const status = (tokens[next] ?? '').replace(/^\n/, '')
      if (/^[RC]/.test(status)) {
        previousPath = tokens[next + 1] ?? null
        filePath = tokens[next + 2] ?? requestedPath
        next += 3
      } else {
        filePath = tokens[next + 1] ?? requestedPath
        next += 2
      }
    }
    if ((fields[0] ?? '').length > 0) {
      entries.push({ ...commitFromFields(fields), path: filePath, origPath: previousPath })
    }
    i = next - 1
  }
  return entries
}

export async function fileHistory(options: FileHistoryOptions): Promise<FileHistoryResult> {
  const maxCount = options.maxCount ?? 50
  const skip = options.skip ?? 0
  const follow = options.follow === true
  // A followed lineage answers nothing for a skipped window, so the page is taken as
  // the tail of one contiguous window instead of relying on `--skip`.
  const limit = follow ? skip + maxCount + 1 : maxCount + 1
  const args = ['log', '-z', '--name-status', `--max-count=${String(limit)}`, `--format=${RECORD_FORMAT}`]
  if (follow) args.push('--follow')
  if (!follow && skip > 0) args.push(`--skip=${String(skip)}`)
  args.push('--', options.path)

  const result = await runGit(args, {
    cwd: options.repoPath,
    env: LITERAL_PATHS_ENV,
    signal: options.signal
  })
  if (result.code !== 0) {
    const unborn = /does not have any commits yet|ambiguous argument 'HEAD'/.test(result.stderr)
    if (unborn) return { entries: [], hasMore: false }
    throw new GitCommandError(`git log failed (exit code ${String(result.code)})`, {
      args,
      cwd: options.repoPath,
      code: result.code,
      stdout: result.stdout,
      stderr: result.stderr
    })
  }

  const parsed = parseFileHistory(result.stdout, options.path)
  const page = follow ? parsed.slice(skip, skip + maxCount) : parsed.slice(0, maxCount)
  return { entries: page, hasMore: parsed.length > (follow ? skip + maxCount : maxCount) }
}

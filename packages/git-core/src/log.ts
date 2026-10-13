import type { CommitInfo } from '@gitreedesk/shared'
import { GitCommandError } from './errors'
import { runGit } from './run'
import { LITERAL_PATHS_ENV } from './staging'

const FORMAT = ['%H', '%P', '%an', '%ae', '%aI', '%cn', '%ce', '%cI', '%s', '%D'].join('%x00')
const FIELDS_PER_COMMIT = 10

function parseDecoration(value: string): string[] {
  if (value.length === 0) return []
  return value.split(', ').map((entry) => {
    if (entry.startsWith('HEAD -> ')) return entry.slice('HEAD -> '.length)
    if (entry.startsWith('tag: ')) return entry.slice('tag: '.length)
    return entry
  })
}

export function parseLog(stdout: string): CommitInfo[] {
  const tokens = stdout.split('\0')
  // `-z` terminates every record with NUL, so the output ends with an empty token.
  if (tokens[tokens.length - 1] === '') tokens.pop()

  const commits: CommitInfo[] = []
  for (let i = 0; i + FIELDS_PER_COMMIT <= tokens.length; i += FIELDS_PER_COMMIT) {
    const sha = tokens[i] ?? ''
    if (sha.length === 0) continue

    const parents = (tokens[i + 1] ?? '').split(' ').filter((parent) => parent.length > 0)
    commits.push({
      sha,
      parents,
      author: { name: tokens[i + 2] ?? '', email: tokens[i + 3] ?? '', date: tokens[i + 4] ?? '' },
      committer: { name: tokens[i + 5] ?? '', email: tokens[i + 6] ?? '', date: tokens[i + 7] ?? '' },
      subject: tokens[i + 8] ?? '',
      refs: parseDecoration(tokens[i + 9] ?? '')
    })
  }
  return commits
}

export interface LogOptions {
  repoPath: string
  maxCount?: number
  skip?: number
  revs?: readonly string[]
  path?: string
  signal?: AbortSignal
}

export interface LogResult {
  commits: CommitInfo[]
  hasMore: boolean
}

export async function logCommits(options: LogOptions): Promise<LogResult> {
  const maxCount = options.maxCount ?? 50
  const args = ['log', '-z', `--max-count=${String(maxCount + 1)}`, `--format=${FORMAT}`]

  if (options.skip !== undefined && options.skip > 0) args.push(`--skip=${String(options.skip)}`)
  for (const rev of options.revs ?? []) {
    if (rev.startsWith('-')) throw new Error(`Invalid revision: ${rev}`)
    args.push(rev)
  }
  if (options.path !== undefined) args.push('--', options.path)

  const result = await runGit(args, {
    cwd: options.repoPath,
    env: options.path === undefined ? undefined : LITERAL_PATHS_ENV,
    signal: options.signal
  })

  if (result.code !== 0) {
    const explicitRevs = options.revs !== undefined && options.revs.length > 0
    const unborn = /does not have any commits yet|ambiguous argument 'HEAD'/.test(result.stderr)
    if (!explicitRevs && unborn) return { commits: [], hasMore: false }
    throw new GitCommandError(`git log failed (exit code ${String(result.code)})`, {
      args,
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

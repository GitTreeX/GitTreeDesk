import { join } from 'node:path'
import type {
  ChangeKind,
  ConflictedEntry,
  FileChange,
  HeadInfo,
  RepoStatus,
  UpstreamInfo
} from '@gitreedesk/shared'
import { pathExists } from './fs'
import { detectOperation, readStashCount, resolveRepoDirs } from './repo'
import { runGitOrThrow } from './run'

export interface ParsedStatus {
  head: HeadInfo
  upstream: UpstreamInfo | null
  staged: FileChange[]
  unstaged: FileChange[]
  untracked: string[]
  conflicted: ConflictedEntry[]
}

function toChangeKind(code: string): ChangeKind | null {
  switch (code) {
    case 'M':
      return 'modified'
    case 'A':
      return 'added'
    case 'D':
      return 'deleted'
    case 'R':
      return 'renamed'
    case 'C':
      return 'copied'
    case 'T':
      return 'typeChanged'
    default:
      return null
  }
}

export function parseStatusV2(stdout: string): ParsedStatus {
  const head: HeadInfo = { ref: null, sha: null, detached: false, unborn: false }
  let upstream: UpstreamInfo | null = null
  const staged: FileChange[] = []
  const unstaged: FileChange[] = []
  const untracked: string[] = []
  const conflicted: ConflictedEntry[] = []

  const tokens = stdout.split('\0')

  for (let i = 0; i < tokens.length; i += 1) {
    const record = tokens[i]
    if (record === undefined || record.length === 0) continue

    if (record.startsWith('# ')) {
      const header = record.slice(2)
      if (header.startsWith('branch.oid ')) {
        const value = header.slice('branch.oid '.length)
        if (value === '(initial)') head.unborn = true
        else head.sha = value
      } else if (header.startsWith('branch.head ')) {
        const value = header.slice('branch.head '.length)
        if (value === '(detached)') head.detached = true
        else head.ref = value
      } else if (header.startsWith('branch.upstream ')) {
        upstream = { ref: header.slice('branch.upstream '.length), ahead: 0, behind: 0 }
      } else if (header.startsWith('branch.ab ')) {
        const match = /\+(\d+) -(\d+)/.exec(header)
        if (match !== null && upstream !== null) {
          upstream.ahead = Number(match[1] ?? '0')
          upstream.behind = Number(match[2] ?? '0')
        }
      }
      continue
    }

    const tag = record.charAt(0)

    if (tag === '1' || tag === '2' || tag === 'u') {
      const fields = record.split(' ')
      const xy = fields[1] ?? '..'

      if (tag === 'u') {
        conflicted.push({ path: fields.slice(10).join(' '), code: xy })
        continue
      }

      const path = fields.slice(tag === '1' ? 8 : 9).join(' ')
      let origPath: string | undefined
      if (tag === '2') {
        origPath = tokens[i + 1]
        i += 1
      }

      const x = xy.charAt(0)
      const y = xy.charAt(1)

      const stagedKind = toChangeKind(x)
      if (stagedKind !== null) {
        staged.push(
          origPath !== undefined && (stagedKind === 'renamed' || stagedKind === 'copied')
            ? { path, origPath, kind: stagedKind }
            : { path, kind: stagedKind }
        )
      }

      const unstagedKind = toChangeKind(y)
      if (unstagedKind !== null) {
        unstaged.push(
          origPath !== undefined && (unstagedKind === 'renamed' || unstagedKind === 'copied')
            ? { path, origPath, kind: unstagedKind }
            : { path, kind: unstagedKind }
        )
      }
      continue
    }

    if (tag === '?') {
      untracked.push(record.slice(2))
    }
  }

  return { head, upstream, staged, unstaged, untracked, conflicted }
}

export interface ReadStatusOptions {
  repoPath: string
  /** Per-worktree git dir; resolved on demand when omitted. */
  gitDir?: string
  /** Shared git dir of the repository; resolved on demand when omitted. */
  commonDir?: string
  untracked?: 'no' | 'normal' | 'all'
  signal?: AbortSignal
}

export async function readStatus(options: ReadStatusOptions): Promise<RepoStatus> {
  const result = await runGitOrThrow(
    ['status', '--porcelain=v2', '-z', '--branch', `--untracked-files=${options.untracked ?? 'normal'}`],
    { cwd: options.repoPath, signal: options.signal }
  )
  const parsed = parseStatusV2(result.stdout)

  let { gitDir, commonDir } = options
  if (gitDir === undefined || commonDir === undefined) {
    const dirs = await resolveRepoDirs(options.repoPath, { signal: options.signal })
    gitDir ??= dirs.gitDir
    commonDir ??= dirs.commonDir
  }

  const [operation, stashCount, submodulesPresent] = await Promise.all([
    detectOperation(gitDir),
    readStashCount(commonDir),
    pathExists(join(options.repoPath, '.gitmodules'))
  ])

  return { ...parsed, operation, stashCount, submodulesPresent }
}

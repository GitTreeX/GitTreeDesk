import type { HeadCommit } from '@gitreedesk/shared'
import { GitCommandError } from './errors'
import { runGit } from './run'

export interface CommitOptions {
  repoPath: string
  /** An empty message keeps the amended commit's message (`--amend --no-edit`). */
  message: string
  signOff?: boolean
  amend?: boolean
  /** Overrides `core.hooksPath` with an empty value so no hook runs (untrusted workspaces). */
  suppressHooks?: boolean
  /** Receives git's stdout and stderr, including hook output, while the commit runs. */
  onOutput?: (chunk: string) => void
  signal?: AbortSignal
}

export interface CommitResult {
  /** SHA of the new (or amended) HEAD commit. */
  sha: string
}

export async function commit(options: CommitOptions): Promise<CommitResult> {
  const keepMessage = options.message.trim().length === 0
  if (keepMessage && options.amend !== true) {
    throw new Error('A commit message is required')
  }

  const args: string[] = []
  if (options.suppressHooks === true) args.push('-c', 'core.hooksPath=')
  args.push('commit')
  if (options.amend === true) args.push('--amend')
  if (options.signOff === true) args.push('--signoff')
  if (keepMessage) args.push('--no-edit')
  else args.push('-m', options.message)

  const stream = options.onOutput
  const result = await runGit(args, {
    cwd: options.repoPath,
    signal: options.signal,
    onStdout: stream,
    onStderr: stream
  })
  if (result.code !== 0) {
    throw new GitCommandError(`git commit failed (exit code ${String(result.code)})`, {
      args,
      cwd: options.repoPath,
      code: result.code,
      stdout: result.stdout,
      stderr: result.stderr
    })
  }

  const head = await runGit(['rev-parse', 'HEAD'], { cwd: options.repoPath, signal: options.signal })
  return { sha: head.stdout.trim() }
}

export interface ReadHeadCommitOptions {
  repoPath: string
  signal?: AbortSignal
}

/** HEAD commit with its full message; `null` on an unborn branch. */
export async function readHeadCommit(options: ReadHeadCommitOptions): Promise<HeadCommit | null> {
  const probe = await runGit(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], {
    cwd: options.repoPath,
    signal: options.signal
  })
  if (probe.code !== 0) return null

  const log = await runGit(['log', '--no-color', '-1', '--format=%H%n%B'], {
    cwd: options.repoPath,
    signal: options.signal
  })
  if (log.code !== 0) return null
  const separator = log.stdout.indexOf('\n')
  if (separator === -1) return null
  const sha = log.stdout.slice(0, separator).trim()
  const message = log.stdout.slice(separator + 1).replace(/\n+$/, '')
  if (sha.length === 0) return null
  return { sha, message }
}

/** True when HEAD is contained in a remote-tracking branch, i.e. already published. */
export async function isHeadPushed(options: ReadHeadCommitOptions): Promise<boolean> {
  const result = await runGit(['for-each-ref', '--count=1', '--contains=HEAD', 'refs/remotes/'], {
    cwd: options.repoPath,
    signal: options.signal
  })
  return result.code === 0 && result.stdout.trim().length > 0
}

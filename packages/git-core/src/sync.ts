import type { PullStrategy } from '@gitreedesk/shared'
import { runWithAutoStash, type AutoStashOutcome } from './autostash'
import { runGit, runGitOrThrow } from './run'

export interface SyncOutputOptions {
  /** Receives git's stdout and stderr while the command runs. */
  onOutput?: (chunk: string) => void
  signal?: AbortSignal
}

async function snapshotRefs(
  repoPath: string,
  patterns: readonly string[],
  options: SyncOutputOptions
): Promise<string> {
  const result = await runGit(
    ['for-each-ref', '--format=%(refname)%00%(objectname)', ...patterns],
    { cwd: repoPath, signal: options.signal }
  )
  return result.code === 0 ? result.stdout : ''
}

export interface FetchOptions extends SyncOutputOptions {
  remote: string
  /** Deletes remote-tracking branches that no longer exist on the remote. */
  prune?: boolean
  /**
   * Fetch follows tags that point into the downloaded history by default;
   * `false` turns that off with `--no-tags`.
   */
  followTags?: boolean
}

export interface FetchResult {
  /** At least one remote-tracking ref or tag moved. */
  updated: boolean
  /** Combined stdout/stderr for the batch summary details. */
  output: string
}

export async function fetchRemote(repoPath: string, options: FetchOptions): Promise<FetchResult> {
  const args = ['fetch']
  if (options.prune === true) args.push('--prune')
  if (options.followTags === false) args.push('--no-tags')
  args.push(options.remote)
  const patterns = [`refs/remotes/${options.remote}`, 'refs/tags']

  const before = await snapshotRefs(repoPath, patterns, options)
  const result = await runGitOrThrow(args, {
    cwd: repoPath,
    signal: options.signal,
    onStdout: options.onOutput,
    onStderr: options.onOutput
  })
  const after = await snapshotRefs(repoPath, patterns, options)

  return { updated: before !== after, output: `${result.stdout}${result.stderr}`.trimEnd() }
}

const PULL_STASH_MESSAGE = 'GitTreeDesk: auto-stash before pull'

export interface PullOptions extends SyncOutputOptions {
  /** Remote to pull from; the configured upstream is used when omitted. */
  remote?: string
  /** Branch to pull; the checked-out branch is used when omitted. */
  branch?: string
  strategy: PullStrategy
}

export type PullResult = AutoStashOutcome

function pullArgs(options: PullOptions): string[] {
  const args = ['pull']
  if (options.strategy === 'ff-only') args.push('--ff-only')
  else if (options.strategy === 'rebase') args.push('--rebase')
  else args.push('--no-rebase')
  if (options.remote !== undefined && options.remote.length > 0) {
    args.push(options.remote)
    if (options.branch !== undefined && options.branch.length > 0) args.push(options.branch)
  }
  return args
}

/**
 * Pulls with the given strategy. A dirty tree that blocks the update is
 * auto-stashed (untracked included) and restored afterwards.
 */
export async function pullRepo(repoPath: string, options: PullOptions): Promise<PullResult> {
  return await runWithAutoStash(
    repoPath,
    pullArgs(options),
    {
      cwd: repoPath,
      signal: options.signal,
      onStdout: options.onOutput,
      onStderr: options.onOutput,
      // A merge pull must not wait for an editor for the merge commit message.
      env: { GIT_MERGE_AUTOEDIT: 'no' }
    },
    PULL_STASH_MESSAGE
  )
}

export interface PushOptions extends SyncOutputOptions {
  remote: string
  branch: string
  /** Publishes the branch and sets its upstream (`-u`). */
  setUpstream?: boolean
  /** Only offered behind a confirmation; never a plain `--force`. */
  forceWithLease?: boolean
}

export async function pushBranch(repoPath: string, options: PushOptions): Promise<void> {
  if (options.branch.length === 0 || options.branch.startsWith('-')) {
    throw new Error(`Invalid branch: ${options.branch}`)
  }
  const args = ['push']
  if (options.setUpstream === true) args.push('--set-upstream')
  if (options.forceWithLease === true) args.push('--force-with-lease')
  args.push(options.remote, `refs/heads/${options.branch}`)
  await runGitOrThrow(args, {
    cwd: repoPath,
    signal: options.signal,
    onStdout: options.onOutput,
    onStderr: options.onOutput
  })
}

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CommitInfo } from '@gitreedesk/shared'
import { readHeadSha } from './branches'
import { verifyRevision } from './backup'
import { editorEnv, editorScriptPath } from './editor'
import { GitCommandError } from './errors'
import { logCommits } from './log'
import { clearRebaseSession, loadRebasePlan, rebaseInteractive } from './rebase'
import { resolveRepoDirs } from './repo'
import { runGit, runGitOrThrow } from './run'
import { readStatus } from './status'

const PLAN_LIMIT = 1000

/** Replacement values of one rewritten commit; omitted fields stay untouched. */
export interface CommitEdit {
  sha: string
  message?: string
  authorName?: string
  authorEmail?: string
  /** ISO 8601; replaces the author date. */
  authorDate?: string
  /** ISO 8601; sets the committer date via `GIT_COMMITTER_DATE`. */
  committerDate?: string
}

export interface EditCommitsOptions {
  edits: readonly CommitEdit[]
  /** Overrides `core.hooksPath` with an empty value so no hook runs (untrusted workspaces). */
  suppressHooks?: boolean
  /** Receives git's stdout and stderr while the rewrite runs. */
  onOutput?: (chunk: string) => void
  signal?: AbortSignal
}

export interface EditCommitsResult {
  /** A conflict left the rebase in progress; continue or abort through the banner. */
  stopped: boolean
  /** Current HEAD after the rewrite (or at the stop). */
  sha: string
  output: string
}

/**
 * Rewrites the metadata of one or more commits. The current tip is amended
 * directly; older commits (possibly a batch, in one pass) are replayed through a
 * scripted interactive rebase that stops on each target for a metadata-only amend.
 */
export async function editCommits(
  repoPath: string,
  options: EditCommitsOptions
): Promise<EditCommitsResult> {
  if (options.edits.length === 0) throw new Error('No commits to edit')
  const chunks: string[] = []
  const sink = (chunk: string): void => {
    chunks.push(chunk)
    options.onOutput?.(chunk)
  }
  const finish = async (stopped: boolean, fallback: string): Promise<EditCommitsResult> => ({
    stopped,
    sha: (await readHeadSha(repoPath, { signal: options.signal })) ?? fallback,
    output: chunks.join('').trimEnd()
  })

  const head = await readHeadSha(repoPath, { signal: options.signal })
  if (head === null) throw new Error('The repository has no commits yet')

  const edits = new Map<string, CommitEdit>()
  for (const input of options.edits) {
    assertEdit(input)
    const sha = await verifyRevision(repoPath, input.sha, { signal: options.signal })
    edits.set(sha, { ...input, sha })
  }
  const list = [...edits.values()]

  const only = list.length === 1 ? (list[0] as CommitEdit) : null
  if (only !== null && only.sha === head) {
    const script = await editorScriptPath()
    const args = amendArgs(only, options.suppressHooks === true)
    const env = { ...editorEnv(script) }
    if (only.committerDate !== undefined) env.GIT_COMMITTER_DATE = only.committerDate
    const result = await runGit(args, {
      cwd: repoPath,
      env,
      signal: options.signal,
      onStdout: sink,
      onStderr: sink
    })
    if (result.code !== 0) {
      throw new GitCommandError(`git commit --amend failed (exit code ${String(result.code)})`, {
        args,
        cwd: repoPath,
        code: result.code,
        stdout: result.stdout,
        stderr: result.stderr
      })
    }
    return await finish(false, head)
  }

  // Rewriting older commits replays everything above the oldest target; the
  // targets must be non-merge commits on the current branch.
  const positioned: { edit: CommitEdit; above: number; root: boolean }[] = []
  for (const edit of list) {
    positioned.push({
      edit,
      above: await countAbove(repoPath, edit.sha, options.signal),
      root: await isRootCommit(repoPath, edit.sha, options.signal)
    })
  }
  const oldest = positioned.reduce((best, candidate) =>
    candidate.above > best.above ? candidate : best
  )
  const base = oldest.root ? null : `${oldest.edit.sha}^`
  const plan =
    base === null
      ? await loadRootPlan(repoPath, options.signal)
      : await loadRebasePlan({ repoPath, base, signal: options.signal })

  const targets = new Set(list.map((edit) => edit.sha))
  for (const sha of targets) {
    if (!plan.some((commit) => commit.sha === sha)) {
      throw new Error(
        `Cannot rewrite ${sha.slice(0, 7)}: merge commits and history deeper than ${String(PLAN_LIMIT)} commits are not supported`
      )
    }
  }

  const queue = plan.filter((commit) => targets.has(commit.sha)).map((commit) => commit.sha)
  const steps = plan.map((commit) => ({
    sha: commit.sha,
    action: targets.has(commit.sha) ? ('edit' as const) : ('pick' as const)
  }))

  await rebaseInteractive(repoPath, {
    ...(base === null ? { root: true } : { base }),
    steps,
    onOutput: sink,
    signal: options.signal
  })

  // The scripts replay one `edit` stop at a time: amend the stopped target,
  // continue, and repeat until git is no longer mid-rebase.
  const script = await editorScriptPath()
  let stopped = false
  for (;;) {
    const status = await readStatus({ repoPath, untracked: 'no', signal: options.signal })
    if (status.operation === 'none') break
    if (status.conflicted.length > 0) {
      stopped = true
      break
    }
    const stoppedSha = await readStoppedSha(repoPath, options.signal)
    const index = stoppedSha === null ? 0 : queue.indexOf(stoppedSha)
    const sha = index === -1 ? null : (queue[index] ?? null)
    if (sha === null) {
      stopped = true
      break
    }
    queue.splice(index, 1)
    const edit = edits.get(sha)
    if (edit === undefined) {
      stopped = true
      break
    }
    const args = amendArgs(edit, options.suppressHooks === true)
    const env: Record<string, string> = { ...editorEnv(script) }
    if (edit.committerDate !== undefined) env.GIT_COMMITTER_DATE = edit.committerDate
    const amended = await runGit(args, {
      cwd: repoPath,
      env,
      signal: options.signal,
      onStdout: sink,
      onStderr: sink
    })
    if (amended.code !== 0) {
      stopped = true
      break
    }
    // A non-zero continue is fine: the next iteration tells an edit stop apart
    // from a conflict stop.
    await runGit(['rebase', '--continue'], {
      cwd: repoPath,
      env: editorEnv(script),
      signal: options.signal,
      onStdout: sink,
      onStderr: sink
    })
  }

  if (!stopped) await clearRebaseSession(repoPath, options.signal)
  return await finish(stopped, head)
}

function assertEdit(edit: CommitEdit): void {
  if (
    (edit.authorName === undefined) !== (edit.authorEmail === undefined) ||
    (edit.authorName !== undefined && edit.authorName.length === 0) ||
    (edit.authorEmail !== undefined && edit.authorEmail.length === 0)
  ) {
    throw new Error('The author name and email must be provided together')
  }
  if (edit.message !== undefined && edit.message.trim().length === 0) {
    throw new Error('A replacement message cannot be empty')
  }
  if (
    edit.message === undefined &&
    edit.authorName === undefined &&
    edit.authorDate === undefined &&
    edit.committerDate === undefined
  ) {
    throw new Error('The edit changes nothing')
  }
}

/**
 * Amends HEAD in place. `--only` keeps staged changes out of the rewritten
 * commit so a dirty index can never leak into the history edit; `--allow-empty`
 * lets commits that are already empty be amended at all.
 */
function amendArgs(edit: CommitEdit, suppressHooks: boolean): string[] {
  const args: string[] = []
  if (suppressHooks) args.push('-c', 'core.hooksPath=')
  args.push('commit', '--amend', '--only', '--allow-empty')
  if (edit.message === undefined) args.push('--no-edit')
  else args.push('-m', edit.message)
  if (edit.authorName !== undefined && edit.authorEmail !== undefined) {
    args.push(`--author=${edit.authorName} <${edit.authorEmail}>`)
  }
  if (edit.authorDate !== undefined) args.push(`--date=${edit.authorDate}`)
  return args
}

/** Commits above `sha` on HEAD's history; rejects commits on other branches. */
async function countAbove(repoPath: string, sha: string, signal?: AbortSignal): Promise<number> {
  const ancestor = await runGit(['merge-base', '--is-ancestor', sha, 'HEAD'], {
    cwd: repoPath,
    signal
  })
  if (ancestor.code !== 0) throw new Error(`Not a commit on the current branch: ${sha.slice(0, 7)}`)
  const result = await runGitOrThrow(['rev-list', '--count', `${sha}..HEAD`], {
    cwd: repoPath,
    signal
  })
  const value = Number.parseInt(result.stdout.trim(), 10)
  return Number.isFinite(value) ? value : 0
}

async function isRootCommit(repoPath: string, sha: string, signal?: AbortSignal): Promise<boolean> {
  const result = await runGitOrThrow(['rev-list', '--parents', '-n', '1', sha], {
    cwd: repoPath,
    signal
  })
  return result.stdout.trim().split(' ').length === 1
}

/** Oldest-first plan of the whole branch, for rewrites that include the root. */
async function loadRootPlan(repoPath: string, signal?: AbortSignal): Promise<CommitInfo[]> {
  const result = await logCommits({
    repoPath,
    revs: ['HEAD'],
    maxCount: PLAN_LIMIT,
    reverse: true,
    signal
  })
  if (result.hasMore) {
    throw new Error(`The branch has more than ${String(PLAN_LIMIT)} commits`)
  }
  return result.commits.filter((commit) => commit.parents.length <= 1)
}

/** Sha the rebase wrote into its todo for the commit it stopped at. */
async function readStoppedSha(repoPath: string, signal?: AbortSignal): Promise<string | null> {
  const dirs = await resolveRepoDirs(repoPath, { signal })
  try {
    const raw = await readFile(join(dirs.gitDir, 'rebase-merge', 'stopped-sha'), 'utf8')
    const sha = raw.trim()
    return sha.length > 0 ? sha : null
  } catch {
    return null
  }
}

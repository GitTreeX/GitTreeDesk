import { GitCommandError } from './errors'
import { runGit, runGitOrThrow, type GitRunOptions } from './run'

/**
 * Git's refusal-to-overwrite messages for a dirty tree; only these justify the
 * auto-stash retry. A diverged `ff-only` pull also fails, but with its own wording.
 */
export const LOCAL_CHANGES_RE =
  /would be overwritten|you have unstaged changes|your index contains uncommitted changes|commit your changes or stash them|move or remove them/i

export class AutoStashUnavailableError extends Error {
  constructor() {
    super('No local changes could be stashed')
  }
}

export interface AutoStashOutcome {
  /** Auto-stash was taken because the first attempt was blocked by local changes. */
  stashed: boolean
  /** The auto-stash was restored cleanly after the retry succeeded. */
  stashRestored: boolean
  /** Restoring the auto-stash produced conflicts; the stash entry is kept. */
  stashConflict: boolean
}

export const NO_AUTOSTASH: AutoStashOutcome = {
  stashed: false,
  stashRestored: false,
  stashConflict: false
}

async function stashRef(repoPath: string, signal?: AbortSignal): Promise<string> {
  return (
    await runGit(['rev-parse', '--verify', '--quiet', 'refs/stash'], { cwd: repoPath, signal })
  ).stdout.trim()
}

/**
 * Runs `retry` between a protective stash and its restore. A failing `retry`
 * still restores the stash (a failed pop keeps the entry) and rethrows.
 */
async function withAutoStash(
  repoPath: string,
  stashMessage: string,
  signal: AbortSignal | undefined,
  retry: () => Promise<void>
): Promise<AutoStashOutcome> {
  // A previous stash entry shifts refs/stash, so compare before and after to
  // know whether the push actually created one; popping an older entry would
  // restore the wrong content.
  const before = await stashRef(repoPath, signal)
  const push = await runGit(['stash', 'push', '--include-untracked', '-m', stashMessage], {
    cwd: repoPath,
    signal
  })
  if (push.code !== 0) throw new AutoStashUnavailableError()
  const after = await stashRef(repoPath, signal)
  if (after.length === 0 || after === before) throw new AutoStashUnavailableError()

  try {
    await retry()
  } catch (error) {
    await runGit(['stash', 'pop', '--quiet'], { cwd: repoPath, signal })
    throw error
  }

  const pop = await runGit(['stash', 'pop', '--quiet'], { cwd: repoPath, signal })
  return { stashed: true, stashRestored: pop.code === 0, stashConflict: pop.code !== 0 }
}

/**
 * Runs a git command that may be blocked by a dirty tree: a failure matching
 * the overwrite messages stashes (untracked included), retries, and restores.
 * Anything else propagates as the command's own error.
 */
export async function runWithAutoStash(
  repoPath: string,
  args: readonly string[],
  runOptions: GitRunOptions,
  stashMessage: string
): Promise<AutoStashOutcome> {
  const fail = (result: { code: number | null; stdout: string; stderr: string }): GitCommandError =>
    new GitCommandError(`git ${args.join(' ')} failed (exit code ${String(result.code)})`, {
      args,
      cwd: repoPath,
      code: result.code,
      stdout: result.stdout,
      stderr: result.stderr
    })

  const first = await runGit(args, runOptions)
  if (first.code === 0) return NO_AUTOSTASH
  if (!LOCAL_CHANGES_RE.test(first.stderr)) throw fail(first)

  try {
    return await withAutoStash(repoPath, stashMessage, runOptions.signal, async () => {
      await runGitOrThrow(args, runOptions)
    })
  } catch (error) {
    if (error instanceof AutoStashUnavailableError) throw fail(first)
    throw error
  }
}

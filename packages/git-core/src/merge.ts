import type { MergeMode } from '@gitreedesk/shared'
import { editorEnv, editorScriptPath } from './editor'
import { GitCommandError } from './errors'
import { runGit } from './run'
import { isOperationStopped } from './status'

export interface MergeOptions {
  /** Revision to merge into the current branch. */
  rev: string
  /** Omitted merges with git's default: fast-forward when possible. */
  mode?: MergeMode
  signal?: AbortSignal
}

export interface MergeResult {
  /** Conflicts stopped the merge; nothing was committed. */
  stopped: boolean
  upToDate: boolean
  fastForward: boolean
  output: string
}

const MODE_FLAG: Record<Exclude<MergeMode, 'default'>, string> = {
  'no-ff': '--no-ff',
  'ff-only': '--ff-only',
  squash: '--squash'
}

/** `upToDate` and `fastForward` come from git's own summary lines. */
export async function mergeRepo(repoPath: string, options: MergeOptions): Promise<MergeResult> {
  if (options.rev.length === 0 || options.rev.startsWith('-')) {
    throw new Error(`Invalid revision: ${options.rev}`)
  }

  const args = ['merge']
  if (options.mode !== undefined && options.mode !== 'default') args.push(MODE_FLAG[options.mode])
  args.push(options.rev)

  const result = await runGit(args, {
    cwd: repoPath,
    // The merge commit keeps git's generated message; no editor window may open.
    env: { GIT_MERGE_AUTOEDIT: 'no' },
    signal: options.signal
  })

  const output = `${result.stdout}${result.stderr}`.trimEnd()
  if (result.code !== 0) {
    if (await isOperationStopped(repoPath, { signal: options.signal })) {
      return { stopped: true, upToDate: false, fastForward: false, output }
    }
    throw new GitCommandError(`git merge failed (exit code ${String(result.code)})`, {
      args,
      cwd: repoPath,
      code: result.code,
      stdout: result.stdout,
      stderr: result.stderr
    })
  }

  return {
    stopped: false,
    upToDate: /already up[ -]to[ -]date/i.test(result.stdout),
    fastForward: /fast-forward/i.test(result.stdout),
    output
  }
}

/** Concludes a stopped merge with the prepared message; no editor may open. */
export async function mergeContinue(
  repoPath: string,
  options: { signal?: AbortSignal } = {}
): Promise<{ stopped: boolean; output: string }> {
  const env = editorEnv(await editorScriptPath())
  const result = await runGit(['merge', '--continue'], {
    cwd: repoPath,
    env,
    signal: options.signal
  })
  const output = `${result.stdout}${result.stderr}`.trimEnd()
  if (result.code === 0) return { stopped: false, output }
  if (await isOperationStopped(repoPath, { signal: options.signal })) {
    return { stopped: true, output }
  }
  throw new GitCommandError(`git merge --continue failed (exit code ${String(result.code)})`, {
    args: ['merge', '--continue'],
    cwd: repoPath,
    code: result.code,
    stdout: result.stdout,
    stderr: result.stderr
  })
}

/** Restores the pre-merge state exactly. */
export async function mergeAbort(
  repoPath: string,
  options: { signal?: AbortSignal } = {}
): Promise<void> {
  const result = await runGit(['merge', '--abort'], { cwd: repoPath, signal: options.signal })
  if (result.code !== 0) {
    throw new GitCommandError(`git merge --abort failed (exit code ${String(result.code)})`, {
      args: ['merge', '--abort'],
      cwd: repoPath,
      code: result.code,
      stdout: result.stdout,
      stderr: result.stderr
    })
  }
}

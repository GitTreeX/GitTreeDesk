import { editorEnv, editorScriptPath } from './editor'
import { GitCommandError } from './errors'
import { runGit } from './run'
import { isOperationStopped } from './status'

export interface PickOptions {
  /**
   * Commits to apply, in replay order — oldest first.
   * A single element may itself be a range such as `A..B`.
   */
  revs: readonly string[]
  /** Stages the changes and stops before committing. */
  noCommit?: boolean
  /** Parent number when acting on a merge commit (1-based). */
  mainline?: number
  signal?: AbortSignal
}

export interface PickResult {
  /** Conflicts stopped the operation. */
  stopped: boolean
  output: string
}

export type PickAction = 'continue' | 'skip' | 'abort'

function assertRev(rev: string): void {
  if (rev.length === 0 || rev.startsWith('-')) throw new Error(`Invalid revision: ${rev}`)
}

async function runPickCommand(
  action: 'cherry-pick' | 'revert',
  repoPath: string,
  args: readonly string[],
  options: { signal?: AbortSignal; env?: Record<string, string> }
): Promise<PickResult> {
  const result = await runGit(args, { cwd: repoPath, env: options.env, signal: options.signal })
  const output = `${result.stdout}${result.stderr}`.trimEnd()
  if (result.code !== 0) {
    if (await isOperationStopped(repoPath, { signal: options.signal })) {
      return { stopped: true, output }
    }
    throw new GitCommandError(`git ${action} failed (exit code ${String(result.code)})`, {
      args,
      cwd: repoPath,
      code: result.code,
      stdout: result.stdout,
      stderr: result.stderr
    })
  }
  return { stopped: false, output }
}

function pickArgs(action: 'cherry-pick' | 'revert', options: PickOptions): string[] {
  if (options.revs.length === 0) throw new Error('No revision to apply')
  for (const rev of options.revs) assertRev(rev)
  const args: string[] = [action]
  if (options.noCommit === true) args.push('--no-commit')
  if (options.mainline !== undefined) args.push('-m', String(options.mainline))
  // Revert writes a generated message; `--no-edit` keeps it without an editor.
  if (action === 'revert') args.push('--no-edit')
  args.push(...options.revs)
  return args
}

export async function cherryPick(
  repoPath: string,
  options: PickOptions
): Promise<PickResult> {
  return await runPickCommand('cherry-pick', repoPath, pickArgs('cherry-pick', options), options)
}

export async function revertCommit(
  repoPath: string,
  options: PickOptions
): Promise<PickResult> {
  return await runPickCommand('revert', repoPath, pickArgs('revert', options), options)
}

/** `continue` reuses the prepared message, so no editor window may open. */
export async function cherryPickAction(
  action: PickAction,
  repoPath: string,
  options: { signal?: AbortSignal } = {}
): Promise<PickResult> {
  const env = editorEnv(await editorScriptPath())
  return await runPickCommand('cherry-pick', repoPath, ['cherry-pick', `--${action}`], {
    ...options,
    env
  })
}

export async function revertAction(
  action: PickAction,
  repoPath: string,
  options: { signal?: AbortSignal } = {}
): Promise<PickResult> {
  const env = editorEnv(await editorScriptPath())
  return await runPickCommand('revert', repoPath, ['revert', `--${action}`], { ...options, env })
}

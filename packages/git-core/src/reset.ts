import type { ResetMode } from '@gitreedesk/shared'
import { runGitOrThrow } from './run'

export interface ResetOptions {
  /** Revision the branch is moved to. */
  target: string
  mode: ResetMode
  signal?: AbortSignal
}

/**
 * `soft` moves the branch pointer only, `mixed` resets the index, `hard` also
 * resets the working tree. Callers take a backup ref before `hard`.
 */
export async function resetRepo(repoPath: string, options: ResetOptions): Promise<void> {
  if (options.target.length === 0 || options.target.startsWith('-')) {
    throw new Error(`Invalid revision: ${options.target}`)
  }
  await runGitOrThrow(['reset', `--${options.mode}`, options.target], {
    cwd: repoPath,
    signal: options.signal
  })
}

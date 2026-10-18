import { runGit, runGitOrThrow } from './run'

export interface MutateOptions {
  signal?: AbortSignal
}

/** Status paths are data, not globs; literal matching keeps names like `a[1].txt` safe. */
export const LITERAL_PATHS_ENV = { GIT_LITERAL_PATHSPECS: '1' }

async function hasHead(repoPath: string, options: MutateOptions): Promise<boolean> {
  const result = await runGit(['rev-parse', '--verify', '--quiet', 'HEAD'], {
    cwd: repoPath,
    signal: options.signal
  })
  return result.code === 0
}

/** Stages the current content of the paths: additions, edits, deletions. */
export async function stagePaths(
  repoPath: string,
  paths: readonly string[],
  options: MutateOptions = {}
): Promise<void> {
  await runGitOrThrow(['add', '-A', '--', ...paths], {
    cwd: repoPath,
    env: LITERAL_PATHS_ENV,
    signal: options.signal
  })
}

/** Unstages the paths, keeping the working tree untouched. Works on unborn HEAD. */
export async function unstagePaths(
  repoPath: string,
  paths: readonly string[],
  options: MutateOptions = {}
): Promise<void> {
  if (await hasHead(repoPath, options)) {
    await runGitOrThrow(['restore', '--staged', '--', ...paths], {
      cwd: repoPath,
      env: LITERAL_PATHS_ENV,
      signal: options.signal
    })
    return
  }
  await runGitOrThrow(['rm', '-q', '--cached', '-r', '--ignore-unmatch', '--', ...paths], {
    cwd: repoPath,
    env: LITERAL_PATHS_ENV,
    signal: options.signal
  })
}

export async function stageAll(repoPath: string, options: MutateOptions = {}): Promise<void> {
  await runGitOrThrow(['add', '-A'], { cwd: repoPath, signal: options.signal })
}

/** Unstages everything; on an unborn branch this drops the whole index instead. */
export async function unstageAll(repoPath: string, options: MutateOptions = {}): Promise<void> {
  if (await hasHead(repoPath, options)) {
    await runGitOrThrow(['restore', '--staged', '--', '.'], {
      cwd: repoPath,
      env: LITERAL_PATHS_ENV,
      signal: options.signal
    })
    return
  }
  await runGitOrThrow(['rm', '-q', '--cached', '-r', '--ignore-unmatch', '--', '.'], {
    cwd: repoPath,
    env: LITERAL_PATHS_ENV,
    signal: options.signal
  })
}

/** Restores tracked paths in the working tree from the index. Destroying. */
export async function discardWorktreePaths(
  repoPath: string,
  paths: readonly string[],
  options: MutateOptions = {}
): Promise<void> {
  await runGitOrThrow(['restore', '--worktree', '--', ...paths], {
    cwd: repoPath,
    env: LITERAL_PATHS_ENV,
    signal: options.signal
  })
}

export type PatchApplyMode = 'stage' | 'unstage' | 'revert'

export interface ApplyPatchOptions extends MutateOptions {
  /** The patch shares no line between its two sides, so git needs `--unidiff-zero`. */
  zeroContext?: boolean
}

/**
 * Applies a unified patch produced by the diff reader:
 * `stage` moves a worktree hunk into the index, `unstage` moves a staged hunk back,
 * `revert` restores a worktree hunk from the index.
 */
export async function applyPatch(
  repoPath: string,
  patch: string,
  mode: PatchApplyMode,
  options: ApplyPatchOptions = {}
): Promise<void> {
  const args = ['apply', '--whitespace=nowarn']
  if (options.zeroContext === true) args.push('--unidiff-zero')
  if (mode === 'stage') args.push('--cached')
  else if (mode === 'unstage') args.push('--cached', '-R')
  else args.push('-R')
  args.push('-')
  await runGitOrThrow(args, { cwd: repoPath, input: patch, signal: options.signal })
}

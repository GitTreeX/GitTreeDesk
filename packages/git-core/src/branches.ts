import { NO_AUTOSTASH, runWithAutoStash, type AutoStashOutcome } from './autostash'
import { runGit, runGitOrThrow } from './run'

export interface BranchOpOptions {
  signal?: AbortSignal
}

const SWITCH_STASH_MESSAGE = 'GitTreeDesk: auto-stash before branch switch'
const DETACH_STASH_MESSAGE = 'GitTreeDesk: auto-stash before checkout'

const INVALID_REF_CHARS = /[\u0000-\u001f\u007f ~^:?*[\\]/

/** Rejects names git itself would refuse, so the error names the rule. */
export function assertRefName(name: string): void {
  const problem = (reason: string): never => {
    throw new Error(`Invalid branch name "${name}": ${reason}`)
  }
  if (name.length === 0) problem('empty')
  if (name.length > 255) problem('longer than 255 characters')
  if (name.startsWith('-')) problem('starts with a dash')
  if (name.startsWith('/') || name.endsWith('/') || name.endsWith('.')) problem('bad separator position')
  if (name.includes('//')) problem('contains an empty path segment')
  if (name.includes('..') || name.includes('@{')) problem('contains a reserved sequence')
  if (name.endsWith('.lock')) problem('ends with .lock')
  if (INVALID_REF_CHARS.test(name)) problem('contains an invalid character')
}

/**
 * Switches to a local branch. A dirty tree that blocks the switch is
 * auto-stashed (untracked included) and restored afterwards.
 */
export async function checkoutBranch(
  repoPath: string,
  name: string,
  options: BranchOpOptions = {}
): Promise<AutoStashOutcome> {
  assertRefName(name)
  return await runWithAutoStash(
    repoPath,
    ['switch', name],
    { cwd: repoPath, signal: options.signal },
    SWITCH_STASH_MESSAGE
  )
}

/**
 * Detaches HEAD onto a revision (commit, tag or remote branch), with the same
 * auto-stash guard as a branch switch.
 */
export async function checkoutDetach(
  repoPath: string,
  rev: string,
  options: BranchOpOptions = {}
): Promise<AutoStashOutcome> {
  if (rev.length === 0 || rev.startsWith('-')) throw new Error(`Invalid revision: ${rev}`)
  return await runWithAutoStash(
    repoPath,
    ['switch', '--detach', rev],
    { cwd: repoPath, signal: options.signal },
    DETACH_STASH_MESSAGE
  )
}

export interface CreateBranchOptions extends BranchOpOptions {
  name: string
  /** Revision to start from; defaults to the current HEAD. */
  startPoint?: string
  /** Switches to the new branch right away (with the auto-stash guard). */
  checkout?: boolean
}

export async function createBranch(
  repoPath: string,
  options: CreateBranchOptions
): Promise<AutoStashOutcome> {
  assertRefName(options.name)
  const args = ['branch', options.name]
  if (options.startPoint !== undefined && options.startPoint.length > 0) {
    if (options.startPoint.startsWith('-')) throw new Error(`Invalid start point: ${options.startPoint}`)
    args.push(options.startPoint)
  }
  await runGitOrThrow(args, { cwd: repoPath, signal: options.signal })
  if (options.checkout !== true) return NO_AUTOSTASH
  return await runWithAutoStash(
    repoPath,
    ['switch', options.name],
    { cwd: repoPath, signal: options.signal },
    SWITCH_STASH_MESSAGE
  )
}

/** Renames a local branch; git carries the upstream tracking config along. */
export async function renameBranch(
  repoPath: string,
  oldName: string,
  newName: string,
  options: BranchOpOptions = {}
): Promise<void> {
  assertRefName(oldName)
  assertRefName(newName)
  await runGitOrThrow(['branch', '-m', oldName, newName], { cwd: repoPath, signal: options.signal })
}

/** True when the tip is reachable from HEAD, i.e. `-d` can delete it safely. */
export async function isBranchMerged(
  repoPath: string,
  name: string,
  options: BranchOpOptions = {}
): Promise<boolean> {
  const head = await runGit(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], {
    cwd: repoPath,
    signal: options.signal
  })
  if (head.code !== 0) return true
  const result = await runGit(['merge-base', '--is-ancestor', `refs/heads/${name}`, 'HEAD'], {
    cwd: repoPath,
    signal: options.signal
  })
  return result.code === 0
}

/** Deletes a local branch; without `force` git refuses unmerged tips. */
export async function deleteBranch(
  repoPath: string,
  name: string,
  options: BranchOpOptions & { force?: boolean } = {}
): Promise<void> {
  assertRefName(name)
  await runGitOrThrow(['branch', options.force === true ? '-D' : '-d', name], {
    cwd: repoPath,
    signal: options.signal
  })
}

/** Points `branch` at `upstream` (e.g. `origin/feat`) as tracking target. */
export async function setUpstream(
  repoPath: string,
  branch: string,
  upstream: string,
  options: BranchOpOptions = {}
): Promise<void> {
  assertRefName(branch)
  if (upstream.length === 0 || upstream.startsWith('-')) throw new Error(`Invalid upstream: ${upstream}`)
  await runGitOrThrow(['branch', `--set-upstream-to=${upstream}`, branch], {
    cwd: repoPath,
    signal: options.signal
  })
}

export interface BranchTipOptions extends BranchOpOptions {
  name: string
}

/** Tip sha of a local branch; `null` when the ref does not exist. */
export async function readBranchTip(
  repoPath: string,
  options: BranchTipOptions
): Promise<string | null> {
  const result = await runGit(['rev-parse', '--verify', '--quiet', `refs/heads/${options.name}`], {
    cwd: repoPath,
    signal: options.signal
  })
  if (result.code !== 0) return null
  return result.stdout.trim()
}

/** Sha of the HEAD commit; `null` on an unborn branch. */
export async function readHeadSha(repoPath: string, options: BranchOpOptions = {}): Promise<string | null> {
  const result = await runGit(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], {
    cwd: repoPath,
    signal: options.signal
  })
  if (result.code !== 0) return null
  return result.stdout.trim()
}

/** Current branch name of HEAD; `null` while detached. */
export async function readHeadRef(repoPath: string, options: BranchOpOptions = {}): Promise<string | null> {
  const result = await runGit(['symbolic-ref', '--short', '-q', 'HEAD'], {
    cwd: repoPath,
    signal: options.signal
  })
  if (result.code !== 0) return null
  const name = result.stdout.trim()
  return name.length === 0 ? null : name
}

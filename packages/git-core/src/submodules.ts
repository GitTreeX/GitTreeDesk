import type { SubmoduleCheckout, SubmoduleInfo } from '@gitreedesk/shared'
import { runGit, runGitOrThrow, type GitRunResult } from './run'

const PREFIX_TO_CHECKOUT: Record<string, SubmoduleCheckout | undefined> = {
  ' ': 'in-sync',
  '-': 'uninitialized',
  '+': 'different',
  U: 'conflict'
}

export function parseSubmoduleStatus(stdout: string): SubmoduleInfo[] {
  const submodules: SubmoduleInfo[] = []

  for (const line of stdout.split('\n')) {
    if (line.length < 42) continue

    const checkout = PREFIX_TO_CHECKOUT[line.charAt(0)]
    if (checkout === undefined) continue

    const sha = line.slice(1, 41)
    let rest = line.slice(42)
    let describe: string | null = null

    if (rest.endsWith(')')) {
      const open = rest.lastIndexOf(' (')
      if (open !== -1) {
        describe = rest.slice(open + 2, -1)
        rest = rest.slice(0, open)
      }
    }
    if (rest.length === 0) continue

    submodules.push({ path: rest, sha, describe, checkout })
  }

  return submodules
}

export interface ListSubmodulesOptions {
  repoPath: string
  signal?: AbortSignal
}

export async function listSubmodules(options: ListSubmodulesOptions): Promise<SubmoduleInfo[]> {
  const result = await runGit(['submodule', 'status'], { cwd: options.repoPath, signal: options.signal })
  if (result.code !== 0) return []
  return parseSubmoduleStatus(result.stdout)
}

function assertSubmodulePath(path: string): void {
  if (path.length === 0) throw new Error('Submodule path is empty')
  if (path.startsWith('-')) throw new Error(`Invalid submodule path: ${path}`)
}

/** Rejected before the separator so a URL cannot be read as an option. */
function assertSubmoduleUrl(url: string): void {
  if (url.length === 0) throw new Error('Submodule URL is empty')
  if (url.startsWith('-')) throw new Error(`Invalid submodule URL: ${url}`)
}

export interface UpdateSubmodulesOptions {
  repoPath: string
  /** Repo-relative submodule paths; omitted updates every submodule of the repository. */
  paths?: readonly string[]
  /** Clones uninitialized submodules (`--init`). */
  init?: boolean
  /** Updates nested submodules too (`--recursive`). */
  recursive?: boolean
  signal?: AbortSignal
  /** Streams stdout and stderr chunks while the update runs. */
  onOutput?: (chunk: string) => void
}

export async function updateSubmodules(options: UpdateSubmodulesOptions): Promise<void> {
  const args = ['submodule', 'update']
  if (options.init === true) args.push('--init')
  if (options.recursive === true) args.push('--recursive')
  if (options.paths !== undefined && options.paths.length > 0) {
    for (const path of options.paths) assertSubmodulePath(path)
    args.push('--', ...options.paths)
  }
  await runGitOrThrow(args, {
    cwd: options.repoPath,
    signal: options.signal,
    ...(options.onOutput === undefined
      ? {}
      : { onStdout: options.onOutput, onStderr: options.onOutput })
  })
}

export interface AddSubmoduleOptions {
  repoPath: string
  /** Repository to clone; a URL, or a local path when the file protocol is allowed. */
  url: string
  /** Folder to check it out into; git names it after the URL when omitted. */
  path?: string
  /** Branch to record (`--branch`). */
  branch?: string
  /** Tracks a path the index already ignores or holds (`--force`). */
  force?: boolean
  signal?: AbortSignal
}

/** `git submodule add`: clones a repository, pins its commit and lists it in `.gitmodules`. */
export async function addSubmodule(options: AddSubmoduleOptions): Promise<GitRunResult> {
  assertSubmoduleUrl(options.url)
  const args = ['submodule', 'add']
  if (options.force === true) args.push('--force')
  const branch = options.branch?.trim()
  // The `=` form keeps a branch name that starts with a dash out of option parsing.
  if (branch !== undefined && branch.length > 0) args.push(`--branch=${branch}`)
  args.push('--', options.url)
  if (options.path !== undefined && options.path.length > 0) {
    assertSubmodulePath(options.path)
    args.push(options.path)
  }
  return await runGitOrThrow(args, { cwd: options.repoPath, signal: options.signal })
}

export interface DeinitSubmodulesOptions {
  repoPath: string
  /** Repo-relative submodule paths. */
  paths: readonly string[]
  /** Deinitializes a submodule with its own uncommitted changes (`--force`). */
  force?: boolean
  signal?: AbortSignal
}

/**
 * `git submodule deinit`: empties the checkout and unregisters it from the git
 * configuration. The `.gitmodules` entry and the recorded commit stay, so the
 * submodule can be initialized again.
 */
export async function deinitSubmodules(options: DeinitSubmodulesOptions): Promise<GitRunResult> {
  if (options.paths.length === 0) throw new Error('No submodule path given')
  for (const path of options.paths) assertSubmodulePath(path)
  const args = ['submodule', 'deinit']
  if (options.force === true) args.push('--force')
  args.push('--', ...options.paths)
  return await runGitOrThrow(args, { cwd: options.repoPath, signal: options.signal })
}

export interface PendingSubmoduleEntryOptions {
  repoPath: string
  /** Repo-relative submodule path. */
  path: string
  signal?: AbortSignal
}

/**
 * Whether the superproject still holds an uncommitted entry for a submodule, such
 * as a fresh `git submodule add` that has not been committed yet. git refuses to
 * deinit one of those without `--force`.
 */
export async function hasPendingSubmoduleEntry(
  options: PendingSubmoduleEntryOptions
): Promise<boolean> {
  assertSubmodulePath(options.path)
  const result = await runGit(['status', '--porcelain', '--', options.path], {
    cwd: options.repoPath,
    signal: options.signal
  })
  if (result.code !== 0) return false
  return result.stdout.trim().length > 0
}

export interface SyncSubmoduleUrlsOptions {
  repoPath: string
  /** Repo-relative submodule paths; omitted syncs every submodule of the repository. */
  paths?: readonly string[]
  recursive?: boolean
  signal?: AbortSignal
}

/** `git submodule sync`: re-copies `.gitmodules` URLs into the git configuration. */
export async function syncSubmoduleUrls(options: SyncSubmoduleUrlsOptions): Promise<GitRunResult> {
  const args = ['submodule', 'sync']
  if (options.recursive === true) args.push('--recursive')
  if (options.paths !== undefined && options.paths.length > 0) {
    for (const path of options.paths) assertSubmodulePath(path)
    args.push('--', ...options.paths)
  }
  return await runGitOrThrow(args, { cwd: options.repoPath, signal: options.signal })
}

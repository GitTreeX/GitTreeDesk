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

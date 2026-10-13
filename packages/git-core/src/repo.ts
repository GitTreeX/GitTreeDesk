import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { RepoOperationKind } from '@gitreedesk/shared'
import { pathExists } from './fs'
import { runGitOrThrow } from './run'

export interface RepoDirs {
  /** Absolute worktree root, or `null` for bare repositories. */
  worktreePath: string | null
  gitDir: string
  commonDir: string
  bare: boolean
}

export interface ResolveRepoDirsOptions {
  signal?: AbortSignal
}

export async function resolveRepoDirs(cwd: string, options: ResolveRepoDirsOptions = {}): Promise<RepoDirs> {
  // `--show-toplevel` fails inside bare repositories, so retry without it in that case.
  let result = await runGitOrThrow(
    ['rev-parse', '--absolute-git-dir', '--git-common-dir', '--is-bare-repository', '--show-toplevel'],
    { cwd, signal: options.signal }
  ).catch(() => null)

  if (result === null) {
    result = await runGitOrThrow(['rev-parse', '--absolute-git-dir', '--git-common-dir', '--is-bare-repository'], {
      cwd,
      signal: options.signal
    })
  }

  const lines = result.stdout.split('\n')
  const gitDirRaw = lines[0] ?? ''
  const commonDirRaw = lines[1] ?? ''
  const bareRaw = lines[2] ?? ''
  const toplevelRaw = lines[3]
  const bare = bareRaw.trim() === 'true'

  return {
    worktreePath: bare || toplevelRaw === undefined || toplevelRaw.trim() === '' ? null : resolve(toplevelRaw.trim()),
    gitDir: resolve(gitDirRaw.trim()),
    commonDir: resolve(cwd, commonDirRaw.trim()),
    bare
  }
}

export async function detectOperation(gitDir: string): Promise<RepoOperationKind> {
  if (await pathExists(join(gitDir, 'rebase-merge'))) {
    return (await pathExists(join(gitDir, 'rebase-merge', 'interactive'))) ? 'rebase-interactive' : 'rebase'
  }
  if (await pathExists(join(gitDir, 'rebase-apply'))) return 'rebase'
  if (await pathExists(join(gitDir, 'MERGE_HEAD'))) return 'merge'
  if (await pathExists(join(gitDir, 'CHERRY_PICK_HEAD'))) return 'cherry-pick'
  if (await pathExists(join(gitDir, 'REVERT_HEAD'))) return 'revert'
  if (await pathExists(join(gitDir, 'BISECT_LOG'))) return 'bisect'
  return 'none'
}

/**
 * The stash stack is the reflog of `refs/stash`; counting its file is equivalent to
 * `git stash list` without spawning a process.
 */
export async function readStashCount(commonDir: string): Promise<number> {
  try {
    const content = await readFile(join(commonDir, 'logs', 'refs', 'stash'), 'utf8')
    let count = 0
    for (const line of content.split('\n')) {
      if (line.length > 0) count += 1
    }
    return count
  } catch {
    return 0
  }
}

import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { RepoWorktree } from '@gitreedesk/shared'
import { assertRefName } from './branches'
import { runGit, runGitOrThrow } from './run'

function assertArgument(value: string, label: string): void {
  if (value.length === 0) throw new Error(`${label} is empty`)
  if (value.startsWith('-')) throw new Error(`${label} starts with a dash: ${value}`)
}

export function parseWorktreeList(stdout: string): RepoWorktree[] {
  const worktrees: RepoWorktree[] = []
  let current: Partial<RepoWorktree> | null = null

  const finalize = (): void => {
    if (current === null) return
    worktrees.push({
      path: current.path ?? '',
      sha: current.sha ?? null,
      branch: current.branch ?? null,
      detached: current.detached ?? false,
      bare: current.bare ?? false,
      locked: current.locked ?? null,
      prunable: current.prunable ?? null
    })
    current = null
  }

  for (const line of stdout.split('\n')) {
    if (line.length === 0) {
      finalize()
      continue
    }

    const space = line.indexOf(' ')
    const key = space === -1 ? line : line.slice(0, space)
    const value = space === -1 ? '' : line.slice(space + 1)

    switch (key) {
      case 'worktree':
        finalize()
        current = { path: value }
        break
      case 'HEAD':
        if (current !== null) current.sha = value
        break
      case 'branch':
        if (current !== null) current.branch = value
        break
      case 'detached':
        if (current !== null) current.detached = true
        break
      case 'bare':
        if (current !== null) current.bare = true
        break
      case 'locked':
        if (current !== null) current.locked = value
        break
      case 'prunable':
        if (current !== null) current.prunable = value
        break
      default:
        break
    }
  }

  finalize()
  return worktrees
}

export interface ListWorktreesOptions {
  repoPath: string
  signal?: AbortSignal
}

export async function listWorktrees(options: ListWorktreesOptions): Promise<RepoWorktree[]> {
  const result = await runGitOrThrow(['worktree', 'list', '--porcelain'], {
    cwd: options.repoPath,
    signal: options.signal
  })
  return parseWorktreeList(result.stdout)
}

export type WorktreeAddMode =
  | { kind: 'branch'; branch: string }
  | { kind: 'new-branch'; branch: string; base?: string }
  | { kind: 'detach'; rev: string }

export interface AddWorktreeOptions {
  repoPath: string
  /** Target directory of the new working tree; missing parent directories are created. */
  path: string
  mode: WorktreeAddMode
  signal?: AbortSignal
}

export async function addWorktree(options: AddWorktreeOptions): Promise<void> {
  const { mode } = options
  assertArgument(options.path, 'Worktree path')

  const args = ['worktree', 'add']
  if (mode.kind === 'new-branch') {
    assertRefName(mode.branch)
    args.push('-b', mode.branch)
  } else if (mode.kind === 'detach') {
    assertArgument(mode.rev, 'Revision')
    args.push('--detach')
  } else {
    assertRefName(mode.branch)
  }

  await mkdir(dirname(options.path), { recursive: true })
  args.push(options.path)
  if (mode.kind === 'branch') args.push(mode.branch)
  if (mode.kind === 'new-branch' && mode.base !== undefined) {
    assertArgument(mode.base, 'Base revision')
    args.push(mode.base)
  }
  if (mode.kind === 'detach') args.push(mode.rev)

  await runGitOrThrow(args, { cwd: options.repoPath, signal: options.signal })
}

export interface RemoveWorktreeOptions {
  repoPath: string
  path: string
  /** Removes a dirty worktree; callers take a backup ref first. */
  force?: boolean
  signal?: AbortSignal
}

export async function removeWorktree(options: RemoveWorktreeOptions): Promise<void> {
  assertArgument(options.path, 'Worktree path')
  const args = ['worktree', 'remove']
  if (options.force === true) args.push('--force')
  args.push('--', options.path)
  await runGitOrThrow(args, { cwd: options.repoPath, signal: options.signal })
}

export interface PruneWorktreesOptions {
  repoPath: string
  signal?: AbortSignal
}

export async function pruneWorktrees(options: PruneWorktreesOptions): Promise<void> {
  await runGitOrThrow(['worktree', 'prune'], { cwd: options.repoPath, signal: options.signal })
}

export interface LockWorktreeOptions extends PruneWorktreesOptions {
  path: string
  reason?: string
}

export async function lockWorktree(options: LockWorktreeOptions): Promise<void> {
  assertArgument(options.path, 'Worktree path')
  const args = ['worktree', 'lock']
  if (options.reason !== undefined && options.reason.length > 0) args.push('--reason', options.reason)
  args.push('--', options.path)
  await runGitOrThrow(args, { cwd: options.repoPath, signal: options.signal })
}

export interface UnlockWorktreeOptions extends PruneWorktreesOptions {
  path: string
}

export async function unlockWorktree(options: UnlockWorktreeOptions): Promise<void> {
  assertArgument(options.path, 'Worktree path')
  await runGitOrThrow(['worktree', 'unlock', '--', options.path], {
    cwd: options.repoPath,
    signal: options.signal
  })
}

/** `true`/`false` when the directory can be inspected; `null` when it cannot (missing folder). */
export async function isWorktreeDirty(
  repoPath: string,
  options: { signal?: AbortSignal } = {}
): Promise<boolean | null> {
  try {
    const result = await runGit(['status', '--porcelain'], { cwd: repoPath, signal: options.signal })
    if (result.code !== 0) return null
    return result.stdout.trim().length > 0
  } catch {
    return null
  }
}

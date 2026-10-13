import type { RepoWorktree } from '@gitreedesk/shared'
import { runGitOrThrow } from './run'

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

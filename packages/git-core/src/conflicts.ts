import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveConflictText, type ConflictSide } from '@gitreedesk/shared'
import { runGitOrThrow } from './run'

export interface ResolveConflictOptions {
  /** Repo-relative path (forward slashes) of the unmerged file. */
  path: string
  /** Raw two-letter unmerged code from `git status` (e.g. `UU`, `DU`). */
  code: string
  resolution: ConflictSide
  signal?: AbortSignal
}

/**
 * Resolves one unmerged path onto a side and stages the result. A side that was
 * deleted resolves to a staged deletion; `both` union-merges marker sections
 * (one-sided deletions keep the surviving content).
 */
export async function resolveConflict(
  repoPath: string,
  options: ResolveConflictOptions
): Promise<void> {
  const oursDeleted = options.code.charAt(0) === 'D'
  const theirsDeleted = options.code.charAt(1) === 'D'
  let side: ConflictSide = options.resolution
  if (side === 'both' && (oursDeleted || theirsDeleted)) side = oursDeleted ? 'theirs' : 'ours'

  if (side === 'both') {
    await resolveByUnion(repoPath, options.path, options.signal)
    return
  }

  const deleted = side === 'ours' ? oursDeleted : theirsDeleted
  if (deleted) {
    await runGitOrThrow(['rm', '--force', '--quiet', '--', options.path], {
      cwd: repoPath,
      signal: options.signal
    })
    return
  }

  await runGitOrThrow(['checkout', `--${side}`, '--', options.path], {
    cwd: repoPath,
    signal: options.signal
  })
  await runGitOrThrow(['add', '--', options.path], { cwd: repoPath, signal: options.signal })
}

async function resolveByUnion(
  repoPath: string,
  path: string,
  signal?: AbortSignal
): Promise<void> {
  const file = join(repoPath, path)
  const data = await readFile(file)
  if (!data.includes(0)) {
    const text = data.toString('utf8')
    const merged = resolveConflictText(text, 'both')
    if (merged !== text) await writeFile(file, merged, 'utf8')
  }
  await runGitOrThrow(['add', '--', path], { cwd: repoPath, signal })
}

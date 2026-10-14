import type { FileChange, StashEntry } from '@gitreedesk/shared'
import { parseNameStatusZ } from './diff'
import { GitCommandError } from './errors'
import { runGit, runGitOrThrow } from './run'
import { LITERAL_PATHS_ENV } from './staging'
import { isOperationStopped } from './status'

const FORMAT = '%gd%x00%H%x00%gs%x00%cI'
const FIELDS_PER_STASH = 4

const SUBJECT_BRANCH_RE = /^(?:WIP on|On) ([^:]+):/

export function parseStashList(stdout: string): StashEntry[] {
  const tokens = stdout.split('\0')
  if (tokens[tokens.length - 1] === '') tokens.pop()

  const stashes: StashEntry[] = []
  for (let i = 0; i + FIELDS_PER_STASH <= tokens.length; i += FIELDS_PER_STASH) {
    const selector = tokens[i] ?? ''
    if (selector.length === 0) continue

    const match = /\{(\d+)\}/.exec(selector)
    const subject = tokens[i + 2] ?? ''
    const branchMatch = SUBJECT_BRANCH_RE.exec(subject)
    stashes.push({
      index: match === null ? stashes.length : Number(match[1]),
      selector,
      sha: tokens[i + 1] ?? '',
      subject,
      branch: branchMatch === null ? null : (branchMatch[1] ?? null),
      at: tokens[i + 3] ?? '',
      files: 0
    })
  }
  return stashes
}

export interface ListStashesOptions {
  repoPath: string
  signal?: AbortSignal
}

/** Newest first, each entry carrying its file count for the stash list. */
export async function listStashes(options: ListStashesOptions): Promise<StashEntry[]> {
  const result = await runGitOrThrow(['stash', 'list', '-z', `--format=${FORMAT}`], {
    cwd: options.repoPath,
    signal: options.signal
  })
  const stashes = parseStashList(result.stdout)
  await Promise.all(
    stashes.map(async (entry) => {
      const files = await runGit(
        ['stash', 'show', '--include-untracked', '--name-only', '-z', entry.selector],
        { cwd: options.repoPath, signal: options.signal }
      )
      entry.files =
        files.code === 0 ? files.stdout.split('\0').filter((path) => path.length > 0).length : 0
    })
  )
  return stashes
}

export interface CreateStashOptions {
  message?: string
  /** New files are stashed too (`--include-untracked`). */
  includeUntracked?: boolean
  /** Staged changes stay staged in the working tree (`--keep-index`). */
  keepIndex?: boolean
  /** Repo-relative paths; only changes under them are stashed. */
  paths?: readonly string[]
  signal?: AbortSignal
}

export interface CreateStashResult {
  /** False when the working tree had nothing to stash. */
  created: boolean
  output: string
}

export async function createStash(
  repoPath: string,
  options: CreateStashOptions = {}
): Promise<CreateStashResult> {
  const args = ['stash', 'push']
  if (options.includeUntracked === true) args.push('--include-untracked')
  if (options.keepIndex === true) args.push('--keep-index')
  if (options.message !== undefined && options.message.length > 0) args.push('-m', options.message)
  if (options.paths !== undefined && options.paths.length > 0) {
    args.push('--')
    for (const path of options.paths) {
      if (path.length === 0 || path.startsWith('-')) throw new Error(`Invalid path: ${path}`)
      args.push(path)
    }
  }

  const result = await runGit(args, {
    cwd: repoPath,
    env: options.paths === undefined || options.paths.length === 0 ? undefined : LITERAL_PATHS_ENV,
    signal: options.signal
  })
  const output = `${result.stdout}${result.stderr}`.trimEnd()
  if (result.code !== 0) {
    throw new GitCommandError(`git stash push failed (exit code ${String(result.code)})`, {
      args,
      cwd: repoPath,
      code: result.code,
      stdout: result.stdout,
      stderr: result.stderr
    })
  }
  return { created: !/no local changes to save/i.test(result.stdout), output }
}

function assertSelector(selector: string): void {
  if (selector.length === 0 || selector.startsWith('-')) {
    throw new Error(`Invalid stash selector: ${selector}`)
  }
}

export interface StashSelectorOptions {
  /** Stash selector, e.g. `stash@{0}`. */
  stash: string
  signal?: AbortSignal
}

/** The stash commit and its subject, read before a drop so the backup can restore it. */
export async function readStashEntry(
  repoPath: string,
  options: StashSelectorOptions
): Promise<{ sha: string; subject: string } | null> {
  assertSelector(options.stash)
  // `%s` reads the stash commit's own message; `%gs` is empty outside a reflog walk.
  const result = await runGit(['log', '-1', '--format=%H%x00%s', options.stash], {
    cwd: repoPath,
    signal: options.signal
  })
  if (result.code !== 0) return null
  const [sha = '', subject = ''] = result.stdout.split('\0')
  if (sha.length === 0) return null
  return { sha, subject: subject.replace(/\n$/, '') }
}

/** Recreates a stash entry from a commit sha; backs the undo of a drop. */
export async function stashStore(
  repoPath: string,
  options: { sha: string; message: string; signal?: AbortSignal }
): Promise<void> {
  if (options.sha.length === 0 || options.sha.startsWith('-')) {
    throw new Error(`Invalid stash commit: ${options.sha}`)
  }
  await runGitOrThrow(['stash', 'store', '-m', options.message, options.sha], {
    cwd: repoPath,
    signal: options.signal
  })
}

/** Files the stash touches, rename-aware. */
export async function stashFileChanges(
  repoPath: string,
  options: StashSelectorOptions
): Promise<FileChange[]> {
  assertSelector(options.stash)
  const result = await runGitOrThrow(
    ['stash', 'show', '--include-untracked', '-z', '--name-status', options.stash],
    { cwd: repoPath, signal: options.signal }
  )
  return parseNameStatusZ(result.stdout)
}

export interface StashDiffOptions extends StashSelectorOptions {
  /** Restricts the patch to one repo-relative path. */
  path?: string
}

export async function readStashDiff(repoPath: string, options: StashDiffOptions): Promise<string> {
  assertSelector(options.stash)
  const args = ['stash', 'show', '--include-untracked', '-p', options.stash]
  if (options.path !== undefined) args.push('--', options.path)
  const result = await runGitOrThrow(args, {
    cwd: repoPath,
    env: options.path === undefined ? undefined : LITERAL_PATHS_ENV,
    signal: options.signal
  })
  return result.stdout
}

export interface StashApplyResult {
  /** Conflicts stopped the apply; on a pop the entry is kept. */
  stopped: boolean
  output: string
}

async function runStashApply(
  action: 'apply' | 'pop',
  repoPath: string,
  options: StashSelectorOptions
): Promise<StashApplyResult> {
  assertSelector(options.stash)
  const args = ['stash', action, options.stash]
  const result = await runGit(args, { cwd: repoPath, signal: options.signal })
  const output = `${result.stdout}${result.stderr}`.trimEnd()
  if (result.code !== 0) {
    if (await isOperationStopped(repoPath, { signal: options.signal })) {
      return { stopped: true, output }
    }
    throw new GitCommandError(`git stash ${action} failed (exit code ${String(result.code)})`, {
      args,
      cwd: repoPath,
      code: result.code,
      stdout: result.stdout,
      stderr: result.stderr
    })
  }
  return { stopped: false, output }
}

export async function applyStash(
  repoPath: string,
  options: StashSelectorOptions
): Promise<StashApplyResult> {
  return await runStashApply('apply', repoPath, options)
}

export async function popStash(
  repoPath: string,
  options: StashSelectorOptions
): Promise<StashApplyResult> {
  return await runStashApply('pop', repoPath, options)
}

export async function dropStash(
  repoPath: string,
  options: StashSelectorOptions
): Promise<void> {
  assertSelector(options.stash)
  await runGitOrThrow(['stash', 'drop', options.stash], { cwd: repoPath, signal: options.signal })
}

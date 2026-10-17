import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { RepoWorktree } from '@gitreedesk/shared'
import { runGitOrThrow } from '../src/run'
import { encodeUndoState, parseUndoState, performUndo } from '../src/undo'
import {
  addWorktree,
  isWorktreeDirty,
  listWorktrees,
  lockWorktree,
  moveWorktree,
  pruneWorktrees,
  removeWorktree,
  unlockWorktree
} from '../src/worktrees'

const toPosix = (value: string): string => value.replace(/\\/g, '/')

let dirs: string[] = []

/**
 * The temp directory is canonicalized first: macOS hands out `/var/...` while git
 * reports `/private/var/...`, so worktree paths would otherwise never compare equal.
 */
async function tempDir(): Promise<string> {
  const base = await realpath(tmpdir()).catch(() => tmpdir())
  const dir = await mkdtemp(join(base, 'gtd-worktrees-'))
  dirs.push(dir)
  return dir
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const result = await runGitOrThrow(args, { cwd })
  return result.stdout
}

async function write(cwd: string, relative: string, content: string): Promise<void> {
  const full = join(cwd, relative)
  await mkdir(dirname(full), { recursive: true })
  await writeFile(full, content, 'utf8')
}

async function initRepo(): Promise<string> {
  const dir = await tempDir()
  await git(dir, ['init', '-q', '-b', 'main'])
  await git(dir, ['config', 'user.name', 'GitTreeDesk Test'])
  await git(dir, ['config', 'user.email', 'test@gitreedesk.invalid'])
  await git(dir, ['config', 'core.autocrlf', 'false'])
  await write(dir, 'a.txt', 'one\n')
  await git(dir, ['add', '.'])
  await git(dir, ['commit', '-q', '-m', 'first'])
  return dir
}

async function headSha(cwd: string): Promise<string> {
  return (await git(cwd, ['rev-parse', 'HEAD'])).trim()
}

function find(worktrees: readonly RepoWorktree[], path: string): RepoWorktree | undefined {
  const key = toPosix(path)
  return worktrees.find((entry) => toPosix(entry.path) === key)
}

afterEach(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true })
  dirs = []
})

describe('worktrees', () => {
  it('adds a worktree on a new branch and lists it', async () => {
    const repo = await initRepo()
    const wt = join(await tempDir(), 'feature tree')
    await addWorktree({
      repoPath: repo,
      path: wt,
      mode: { kind: 'new-branch', branch: 'feat', base: 'main' }
    })

    const worktrees = await listWorktrees({ repoPath: repo })
    expect(worktrees).toHaveLength(2)
    expect(find(worktrees, wt)?.branch).toBe('refs/heads/feat')
    expect(await headSha(wt)).toBe(await headSha(repo))
  })

  it('checks out an existing branch and a detached revision', async () => {
    const repo = await initRepo()
    const base = await headSha(repo)
    await git(repo, ['branch', 'solo'])

    const branchWt = join(await tempDir(), 'solo')
    await addWorktree({ repoPath: repo, path: branchWt, mode: { kind: 'branch', branch: 'solo' } })
    expect(find(await listWorktrees({ repoPath: repo }), branchWt)?.branch).toBe('refs/heads/solo')

    const detachWt = join(await tempDir(), 'pinned')
    await addWorktree({ repoPath: repo, path: detachWt, mode: { kind: 'detach', rev: base } })
    const entry = find(await listWorktrees({ repoPath: repo }), detachWt)
    expect(entry?.detached).toBe(true)
    expect(entry?.branch).toBeNull()
  })

  it('requires force for a dirty worktree and removes it either way', async () => {
    const repo = await initRepo()
    const wt = join(await tempDir(), 'dirty')
    await addWorktree({ repoPath: repo, path: wt, mode: { kind: 'new-branch', branch: 'scratch' } })

    expect(await isWorktreeDirty(wt)).toBe(false)
    await write(wt, 'loose.txt', 'x\n')
    expect(await isWorktreeDirty(wt)).toBe(true)

    await expect(removeWorktree({ repoPath: repo, path: wt })).rejects.toThrow()
    await removeWorktree({ repoPath: repo, path: wt, force: true })
    expect(await listWorktrees({ repoPath: repo })).toHaveLength(1)
    expect(await isWorktreeDirty(wt)).toBeNull()
  })

  it('moves a worktree, keeping its branch and uncommitted edits', async () => {
    const repo = await initRepo()
    const from = join(await tempDir(), 'moved', 'keeper')
    await addWorktree({ repoPath: repo, path: from, mode: { kind: 'new-branch', branch: 'traveler' } })
    await write(from, 'loose.txt', 'still staged nothing\n')

    // The parent of the target does not exist yet: git needs the directory chain present.
    const to = join(await tempDir(), 'fresh', 'parent', 'renamed')
    await moveWorktree({ repoPath: repo, path: from, target: to })

    expect(await listWorktrees({ repoPath: repo })).toHaveLength(2)
    expect(find(await listWorktrees({ repoPath: repo }), from)).toBeUndefined()
    const entry = find(await listWorktrees({ repoPath: repo }), to)
    expect(entry?.branch).toBe('refs/heads/traveler')
    expect(await isWorktreeDirty(to)).toBe(true)
    expect(await readFile(join(to, 'loose.txt'), 'utf8')).toBe('still staged nothing\n')
  })

  it('refuses to move a locked worktree or the main working tree', async () => {
    const repo = await initRepo()
    const wt = join(await tempDir(), 'chained')
    await addWorktree({ repoPath: repo, path: wt, mode: { kind: 'new-branch', branch: 'paused' } })

    await lockWorktree({ repoPath: repo, path: wt })
    const elsewhere = join(await tempDir(), 'elsewhere')
    await expect(moveWorktree({ repoPath: repo, path: wt, target: elsewhere })).rejects.toThrow()
    expect(find(await listWorktrees({ repoPath: repo }), wt)).toBeDefined()

    const mainAway = join(await tempDir(), 'main-away')
    await expect(moveWorktree({ repoPath: repo, path: repo, target: mainAway })).rejects.toThrow()
    expect(await listWorktrees({ repoPath: repo })).toHaveLength(2)
  })

  it('locks and unlocks a worktree', async () => {
    const repo = await initRepo()
    const wt = join(await tempDir(), 'locked')
    await addWorktree({ repoPath: repo, path: wt, mode: { kind: 'new-branch', branch: 'keeper' } })

    await lockWorktree({ repoPath: repo, path: wt, reason: 'in use elsewhere' })
    expect(find(await listWorktrees({ repoPath: repo }), wt)?.locked).toBe('in use elsewhere')

    await unlockWorktree({ repoPath: repo, path: wt })
    expect(find(await listWorktrees({ repoPath: repo }), wt)?.locked).toBeNull()
  })

  it('marks a deleted worktree prunable and prunes its metadata', async () => {
    const repo = await initRepo()
    const wt = join(await tempDir(), 'gone')
    await addWorktree({ repoPath: repo, path: wt, mode: { kind: 'new-branch', branch: 'temp' } })

    await rm(wt, { recursive: true, force: true })
    expect(find(await listWorktrees({ repoPath: repo }), wt)?.prunable).not.toBeNull()

    await pruneWorktrees({ repoPath: repo })
    expect(find(await listWorktrees({ repoPath: repo }), wt)).toBeUndefined()
  })

  it('recreates a removed worktree through its undo state', async () => {
    const repo = await initRepo()
    const wt = join(await tempDir(), 'restore-me')
    await addWorktree({ repoPath: repo, path: wt, mode: { kind: 'new-branch', branch: 'restore' } })
    const sha = await headSha(wt)
    await write(wt, 'scratch.txt', 'wip\n')
    await removeWorktree({ repoPath: repo, path: wt, force: true })

    const descriptor = parseUndoState(
      encodeUndoState({ kind: 'worktree-remove', name: toPosix(wt), before: sha, target: 'restore' })
    )
    if (descriptor === null) throw new Error('expected a parsed undo descriptor')
    await performUndo(repo, { descriptor })

    const restored = find(await listWorktrees({ repoPath: repo }), wt)
    expect(restored?.branch).toBe('refs/heads/restore')
    expect(await headSha(wt)).toBe(sha)
  })

  it('recreates a removed detached worktree at its recorded commit', async () => {
    const repo = await initRepo()
    const wt = join(await tempDir(), 'detached')
    const sha = await headSha(repo)
    await addWorktree({ repoPath: repo, path: wt, mode: { kind: 'detach', rev: sha } })
    await removeWorktree({ repoPath: repo, path: wt })

    const descriptor = parseUndoState(
      encodeUndoState({ kind: 'worktree-remove', name: toPosix(wt), before: sha, target: 'HEAD' })
    )
    if (descriptor === null) throw new Error('expected a parsed undo descriptor')
    await performUndo(repo, { descriptor })

    const restored = find(await listWorktrees({ repoPath: repo }), wt)
    expect(restored?.detached).toBe(true)
    expect(await headSha(wt)).toBe(sha)
  })
})

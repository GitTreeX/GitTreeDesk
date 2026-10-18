import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { applyPatch, readDiff, runGitOrThrow, type PatchApplyMode } from '@gitreedesk/git-core'
import type { DiffSource } from '@gitreedesk/shared'
import { parsePatch, singleLinePatch, type PatchHunk, type SingleLinePatch } from '../src/renderer/src/editor/patch'

const IDENTITY = ['-c', 'user.name=GitTreeDesk Test', '-c', 'user.email=test@gitreedesk.invalid']
const BASE = 'one\ntwo\nthree\nfour\nfive\nsix\n'

let dirs: string[] = []

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const result = await runGitOrThrow([...IDENTITY, ...args], { cwd })
  return result.stdout
}

async function initRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'gtd-line-'))
  dirs.push(dir)
  await git(dir, ['init', '-q', '-b', 'main'])
  // The fixtures compare file contents byte for byte, so line endings must not move.
  await git(dir, ['config', 'core.autocrlf', 'false'])
  await writeFile(join(dir, 'lines.txt'), BASE)
  await git(dir, ['add', '.'])
  await git(dir, ['commit', '-q', '-m', 'initial'])
  return dir
}

/** `stage` edits the from side, `unstage` and `revert` edit the side that already carries the change. */
function sideFor(mode: PatchApplyMode): 'old' | 'new' {
  return mode === 'stage' ? 'old' : 'new'
}

interface ActOnLine {
  path?: string
  from: DiffSource
  to: DiffSource
  mode: PatchApplyMode
  /** Content of the changed line to act on, without its patch prefix. */
  line: string
}

/** Builds the one-line patch the diff view would produce and applies it for real. */
async function actOnLine(repo: string, act: ActOnLine): Promise<SingleLinePatch> {
  const filePath = act.path ?? 'lines.txt'
  const diff = await readDiff(repo, { gitDir: repo, path: filePath, from: act.from, to: act.to })
  const parsed = parsePatch(diff.patch)
  for (const hunk of parsed.hunks) {
    const index = hunk.lines.findIndex(
      (cand) => cand.kind !== 'context' && cand.kind !== 'meta' && cand.text.slice(1) === act.line
    )
    if (index === -1) continue
    const built = singleLinePatch(parsed, hunk.index, index, sideFor(act.mode))
    if (built === null) throw new Error(`no patch for ${act.line}`)
    await applyPatch(repo, built.patch, act.mode, { zeroContext: built.zeroContext })
    return built
  }
  throw new Error(`changed line ${act.line} not found`)
}

async function staged(repo: string, path = 'lines.txt'): Promise<string> {
  return await git(repo, ['show', `:${path}`])
}

afterEach(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true })
  dirs = []
})

const worktree: DiffSource = { kind: 'worktree' }
const index: DiffSource = { kind: 'index' }
const head: DiffSource = { kind: 'rev', rev: 'HEAD' }

describe('line actions against a real repository', () => {
  it(
    'stages an inserted line and leaves its neighbour unstaged',
    async () => {
      const repo = await initRepo()
      await writeFile(join(repo, 'lines.txt'), 'one\ntwo\nA\nB\nthree\nfour\nfive\nsix\n')
      const built = await actOnLine(repo, { from: index, to: worktree, mode: 'stage', line: 'B' })
      expect(built.patch).toContain('@@ -3,3 +3,4 @@')
      // B belongs between the two lines that stay behind, so it lands before `three`.
      expect(await staged(repo)).toBe('one\ntwo\nB\nthree\nfour\nfive\nsix\n')
      expect(await readFile(join(repo, 'lines.txt'), 'utf8')).toBe('one\ntwo\nA\nB\nthree\nfour\nfive\nsix\n')
    },
    30_000
  )

  it(
    'stages a modified line as a replacement, never as a duplicate',
    async () => {
      const repo = await initRepo()
      await writeFile(join(repo, 'lines.txt'), 'one\nTWO\nthree\nfour\nfive\nsix\n')
      const built = await actOnLine(repo, { from: index, to: worktree, mode: 'stage', line: 'TWO' })
      expect(built.zeroContext).toBe(false)
      expect(await staged(repo)).toBe('one\nTWO\nthree\nfour\nfive\nsix\n')
      expect(await readFile(join(repo, 'lines.txt'), 'utf8')).toBe('one\nTWO\nthree\nfour\nfive\nsix\n')
      expect(await git(repo, ['diff', '--', 'lines.txt'])).toBe('')
    },
    30_000
  )

  it(
    'unstages a modified line back to the line it replaced',
    async () => {
      const repo = await initRepo()
      await writeFile(join(repo, 'lines.txt'), 'one\nTWO\nthree\nfour\nfive\nsix\n')
      await git(repo, ['add', 'lines.txt'])
      await actOnLine(repo, { from: head, to: index, mode: 'unstage', line: 'TWO' })
      expect(await staged(repo)).toBe(BASE)
      expect(await readFile(join(repo, 'lines.txt'), 'utf8')).toBe('one\nTWO\nthree\nfour\nfive\nsix\n')
    },
    30_000
  )

  it(
    'unstages one line of a file that is new to the index',
    async () => {
      const repo = await initRepo()
      await writeFile(join(repo, 'fresh.txt'), 'a\nb\nc\nd\ne\nf\ng\n')
      await git(repo, ['add', 'fresh.txt'])
      await actOnLine(repo, { path: 'fresh.txt', from: head, to: index, mode: 'unstage', line: 'd' })
      expect(await staged(repo, 'fresh.txt')).toBe('a\nb\nc\ne\nf\ng\n')
      expect(await readFile(join(repo, 'fresh.txt'), 'utf8')).toBe('a\nb\nc\nd\ne\nf\ng\n')
    },
    30_000
  )

  it(
    'reverts one worktree line and keeps the other change',
    async () => {
      const repo = await initRepo()
      await writeFile(join(repo, 'lines.txt'), 'one\ntwo\nthree\nfour\nFIVE\nsix\nNEW\n')
      await actOnLine(repo, { from: index, to: worktree, mode: 'revert', line: 'NEW' })
      expect(await readFile(join(repo, 'lines.txt'), 'utf8')).toBe('one\ntwo\nthree\nfour\nFIVE\nsix\n')
      expect(await staged(repo)).toBe(BASE)
    },
    30_000
  )

  it(
    'applies a context-free line hunk through unidiff-zero',
    async () => {
      const repo = await initRepo()
      await writeFile(join(repo, 'single.txt'), 'first\n')
      await git(repo, ['add', '.'])
      await git(repo, ['commit', '-q', '-m', 'single'])
      await writeFile(join(repo, 'single.txt'), 'second\n')
      const built = await actOnLine(repo, { path: 'single.txt', from: index, to: worktree, mode: 'stage', line: 'second' })
      expect(built.patch).toContain('@@ -1,1 +1,1 @@')
      expect(built.zeroContext).toBe(true)
      expect(await staged(repo, 'single.txt')).toBe('second\n')
    },
    30_000
  )

  it('refuses to act on a context line', () => {
    const hunk: PatchHunk = parsePatch('@@ -1,3 +1,3 @@\n a\n-b\n+c\n').hunks[0] as PatchHunk
    expect(singleLinePatch({ header: [], hunks: [hunk], text: '' }, 0, 0, 'old')).toBeNull()
  })
})

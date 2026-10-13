import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readFileSnapshot } from '../src/content'
import { readDiff } from '../src/diff'
import { runGitOrThrow } from '../src/run'
import { applyPatch, stageAll } from '../src/staging'

const IDENTITY = ['-c', 'user.name=GitTreeDesk Test', '-c', 'user.email=test@gitreedesk.invalid']

let dirs: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'gtd-diff-'))
  dirs.push(dir)
  return dir
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const result = await runGitOrThrow([...IDENTITY, ...args], { cwd })
  return result.stdout
}

async function initRepo(): Promise<string> {
  const dir = await tempDir()
  await git(dir, ['init', '-q', '-b', 'main'])
  return dir
}

async function commit(cwd: string, message: string): Promise<void> {
  await git(cwd, ['commit', '-q', '--allow-empty', '-m', message])
}

async function write(cwd: string, relative: string, content: string | Buffer): Promise<void> {
  const full = join(cwd, relative)
  await mkdir(dirname(full), { recursive: true })
  await writeFile(full, content)
}

function hunkPatch(patch: string, index: number): string {
  const lines = patch.split('\n')
  const header: string[] = []
  const hunks: string[][] = []
  let current: string[] | null = null
  for (const line of lines) {
    if (line.startsWith('@@')) {
      current = [line]
      hunks.push(current)
      continue
    }
    if (current === null) header.push(line)
    else current.push(line)
  }
  const hunk = hunks[index]
  if (hunk === undefined) throw new Error(`no hunk ${index}`)
  let result = [...header, ...hunk].join('\n')
  if (!result.endsWith('\n')) result += '\n'
  return result
}

afterEach(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true })
  dirs = []
})

const LINES = 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\neleven\ntwelve\n'

describe('diff against a real repository', () => {
  it(
    'reads index and worktree sides with a patch for an unstaged edit',
    async () => {
      const repo = await initRepo()
      await write(repo, 'lines.txt', LINES)
      await git(repo, ['add', '.'])
      await commit(repo, 'initial')
      await write(repo, 'lines.txt', LINES.replace('two', 'TWO').replace('eleven', 'ELEVEN'))

      const diff = await readDiff(repo, {
        gitDir: repo,
        path: 'lines.txt',
        from: { kind: 'index' },
        to: { kind: 'worktree' }
      })

      expect(diff.path).toBe('lines.txt')
      expect(diff.origPath).toBeNull()
      expect(diff.kind).toBe('text')
      expect(diff.old.label).toBe('INDEX')
      expect(diff.old.exists).toBe(true)
      expect(diff.old.text).toContain('two')
      expect(diff.old.text).not.toContain('TWO')
      expect(diff.new.label).toBe('WORKTREE')
      expect(diff.new.text).toContain('TWO')
      expect(diff.patch).toContain('@@')
      expect(diff.patch.match(/^@@/gm)).toHaveLength(2)
    },
    30_000
  )

  it(
    'reads HEAD and index sides for a staged edit',
    async () => {
      const repo = await initRepo()
      await write(repo, 'a.txt', 'v1\n')
      await git(repo, ['add', '.'])
      await commit(repo, 'initial')
      await write(repo, 'a.txt', 'v2\n')
      await git(repo, ['add', 'a.txt'])

      const diff = await readDiff(repo, {
        gitDir: repo,
        path: 'a.txt',
        from: { kind: 'rev', rev: 'HEAD' },
        to: { kind: 'index' }
      })

      expect(diff.old.label).toBe('HEAD')
      expect(diff.old.text).toBe('v1\n')
      expect(diff.new.label).toBe('INDEX')
      expect(diff.new.text).toBe('v2\n')
      expect(diff.patch).toContain('-v1')
      expect(diff.patch).toContain('+v2')
    },
    30_000
  )

  it(
    'reports a missing side for an untracked file',
    async () => {
      const repo = await initRepo()
      await commit(repo, 'initial')
      await write(repo, 'fresh.txt', 'brand new\n')

      const diff = await readDiff(repo, {
        gitDir: repo,
        path: 'fresh.txt',
        from: { kind: 'index' },
        to: { kind: 'worktree' }
      })

      expect(diff.old.exists).toBe(false)
      expect(diff.new.exists).toBe(true)
      expect(diff.new.text).toBe('brand new\n')
      expect(diff.patch).toBe('')
    },
    30_000
  )

  it(
    'shows both sides of a staged rename and skips hunk application',
    async () => {
      const repo = await initRepo()
      await write(repo, 'old.txt', 'payload\n')
      await git(repo, ['add', '.'])
      await commit(repo, 'initial')
      await git(repo, ['mv', 'old.txt', 'new.txt'])

      const diff = await readDiff(repo, {
        gitDir: repo,
        path: 'new.txt',
        origPath: 'old.txt',
        from: { kind: 'rev', rev: 'HEAD' },
        to: { kind: 'index' }
      })

      expect(diff.origPath).toBe('old.txt')
      expect(diff.old.exists).toBe(true)
      expect(diff.old.text).toBe('payload\n')
      expect(diff.new.exists).toBe(true)
      expect(diff.new.text).toBe('payload\n')
      expect(diff.patch).toBe('')
    },
    30_000
  )

  it(
    'treats HEAD on an unborn branch as an empty tree',
    async () => {
      const repo = await initRepo()
      await write(repo, 'first.txt', 'first\n')
      await git(repo, ['add', 'first.txt'])

      const diff = await readDiff(repo, {
        gitDir: repo,
        path: 'first.txt',
        from: { kind: 'rev', rev: 'HEAD' },
        to: { kind: 'index' }
      })

      expect(diff.old.exists).toBe(false)
      expect(diff.new.exists).toBe(true)
      expect(diff.new.text).toBe('first\n')
    },
    30_000
  )

  it(
    'detects binary content and image previews',
    async () => {
      const repo = await initRepo()
      await write(repo, 'blob.bin', Buffer.from([1, 2, 0, 3, 4]))
      await write(repo, 'pic.png', Buffer.from('89504e470d0a1a0a0000000d', 'hex'))
      await git(repo, ['add', '.'])
      await commit(repo, 'initial')

      const binary = await readDiff(repo, {
        gitDir: repo,
        path: 'blob.bin',
        from: { kind: 'index' },
        to: { kind: 'worktree' }
      })
      expect(binary.kind).toBe('binary')
      expect(binary.old.text).toBeNull()

      const image = await readDiff(repo, {
        gitDir: repo,
        path: 'pic.png',
        from: { kind: 'index' },
        to: { kind: 'worktree' }
      })
      expect(image.kind).toBe('image')
      expect(image.old.dataUrl?.startsWith('data:image/png;base64,')).toBe(true)
      expect(image.old.size).toBe(12)
    },
    30_000
  )

  it(
    'caps oversized text until the caller asks for the full diff',
    async () => {
      const repo = await initRepo()
      const big = 'x'.repeat(3 * 1024 * 1024)
      await write(repo, 'big.txt', big)
      await git(repo, ['add', '.'])
      await commit(repo, 'initial')

      const capped = await readDiff(repo, {
        gitDir: repo,
        path: 'big.txt',
        from: { kind: 'index' },
        to: { kind: 'worktree' }
      })
      expect(capped.kind).toBe('tooLarge')
      expect(capped.old.text).toBeNull()

      const full = await readDiff(repo, {
        gitDir: repo,
        path: 'big.txt',
        from: { kind: 'index' },
        to: { kind: 'worktree' },
        allowLarge: true
      })
      expect(full.kind).toBe('text')
      expect(full.old.text).toHaveLength(big.length)
    },
    30_000
  )

  it(
    'reads blob paths containing glob characters literally',
    async () => {
      const repo = await initRepo()
      await write(repo, 'a[1].txt', 'brackets\n')
      await git(repo, ['add', '.'])
      await commit(repo, 'initial')
      await write(repo, 'a[1].txt', 'brackets changed\n')

      const diff = await readDiff(repo, {
        gitDir: repo,
        path: 'a[1].txt',
        from: { kind: 'index' },
        to: { kind: 'worktree' }
      })

      expect(diff.old.exists).toBe(true)
      expect(diff.old.text).toBe('brackets\n')
      expect(diff.new.text).toBe('brackets changed\n')
    },
    30_000
  )
})

describe('hunk application against a real repository', () => {
  async function twoHunkRepo(): Promise<string> {
    const repo = await initRepo()
    await write(repo, 'lines.txt', LINES)
    await git(repo, ['add', '.'])
    await commit(repo, 'initial')
    await write(repo, 'lines.txt', LINES.replace('two', 'TWO').replace('eleven', 'ELEVEN'))
    return repo
  }

  it(
    'stages a single hunk into the index only',
    async () => {
      const repo = await twoHunkRepo()
      const diff = await readDiff(repo, {
        gitDir: repo,
        path: 'lines.txt',
        from: { kind: 'index' },
        to: { kind: 'worktree' }
      })

      await applyPatch(repo, hunkPatch(diff.patch, 0), 'stage')

      const indexContent = await git(repo, ['show', ':lines.txt'])
      expect(indexContent).toContain('TWO')
      expect(indexContent).not.toContain('ELEVEN')
      const worktree = await readFile(join(repo, 'lines.txt'), 'utf8')
      expect(worktree.replace(/\r\n/g, '\n')).toContain('ELEVEN')
    },
    30_000
  )

  it(
    'reverts a single worktree hunk from the index',
    async () => {
      const repo = await twoHunkRepo()
      const diff = await readDiff(repo, {
        gitDir: repo,
        path: 'lines.txt',
        from: { kind: 'index' },
        to: { kind: 'worktree' }
      })

      await applyPatch(repo, hunkPatch(diff.patch, 1), 'revert')

      const worktree = await readFile(join(repo, 'lines.txt'), 'utf8')
      expect(worktree.replace(/\r\n/g, '\n')).toContain('TWO')
      expect(worktree.replace(/\r\n/g, '\n')).not.toContain('ELEVEN')
      expect(worktree.replace(/\r\n/g, '\n')).toContain('eleven')
    },
    30_000
  )

  it(
    'unstages a single hunk back toward HEAD',
    async () => {
      const repo = await twoHunkRepo()
      await stageAll(repo)
      const diff = await readDiff(repo, {
        gitDir: repo,
        path: 'lines.txt',
        from: { kind: 'rev', rev: 'HEAD' },
        to: { kind: 'index' }
      })

      await applyPatch(repo, hunkPatch(diff.patch, 0), 'unstage')

      const indexContent = await git(repo, ['show', ':lines.txt'])
      expect(indexContent).not.toContain('TWO')
      expect(indexContent).toContain('two')
      expect(indexContent).toContain('ELEVEN')
    },
    30_000
  )
})

describe('file snapshots', () => {
  it(
    'classifies text, binary and oversized files',
    async () => {
      const dir = await tempDir()
      await write(dir, 'note.txt', 'hello\n')
      await write(dir, 'blob.bin', Buffer.from([0, 1, 2]))

      const note = await readFileSnapshot(join(dir, 'note.txt'))
      expect(note.exists).toBe(true)
      expect(note.kind).toBe('text')
      expect(note.text).toBe('hello\n')
      expect((await stat(join(dir, 'note.txt'))).mtimeMs).toBe(note.mtimeMs)

      const blob = await readFileSnapshot(join(dir, 'blob.bin'))
      expect(blob.kind).toBe('binary')
      expect(blob.text).toBeNull()

      const missing = await readFileSnapshot(join(dir, 'gone.txt'))
      expect(missing.exists).toBe(false)

      const large = join(dir, 'large.txt')
      await writeFile(large, 'y'.repeat(11 * 1024 * 1024))
      const capped = await readFileSnapshot(large)
      expect(capped.kind).toBe('tooLarge')
      const full = await readFileSnapshot(large, { allowLarge: true })
      expect(full.kind).toBe('text')
      expect(full.text).toHaveLength(11 * 1024 * 1024)
    },
    30_000
  )
})

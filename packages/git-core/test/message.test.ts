import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { StagedFile } from '@gitreedesk/shared'
import { COMMIT_TEMPLATE_LIMIT, readStagedSummary, resolveCommitTemplate } from '../src/message'
import { runGitOrThrow } from '../src/run'

const IDENTITY = ['-c', 'user.name=GitTreeDesk Test', '-c', 'user.email=test@gitreedesk.invalid']

let dirs: string[] = []

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const result = await runGitOrThrow([...IDENTITY, ...args], { cwd })
  return result.stdout
}

async function initRepo(): Promise<string> {
  const dir = await tempDir('gtd-message-')
  await git(dir, ['init', '-q', '-b', 'main'])
  await git(dir, ['commit', '-q', '--allow-empty', '-m', 'initial'])
  return dir
}

async function write(cwd: string, relative: string, content: string | Buffer): Promise<void> {
  const full = join(cwd, relative)
  await mkdir(dirname(full), { recursive: true })
  await writeFile(full, content)
}

afterEach(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true })
  dirs = []
})

function byPath(files: readonly StagedFile[], path: string): StagedFile {
  const found = files.find((file) => file.path === path)
  if (found === undefined) throw new Error(`no staged file ${path}`)
  return found
}

describe('readStagedSummary', () => {
  it('summarizes staged adds, edits, renames and binary files with a patch', async () => {
    const repo = await initRepo()
    await write(repo, 'src/app.ts', 'one\ntwo\n')
    await write(repo, 'docs/old.md', 'a\nb\nc\n')
    await git(repo, ['add', '-A'])
    await git(repo, ['commit', '-q', '-m', 'files'])

    await write(repo, 'src/app.ts', 'one\nTWO\n')
    await write(repo, 'src/new.ts', 'export const a = 1\nexport const b = 2\n')
    await git(repo, ['mv', 'docs/old.md', 'docs/new.md'])
    await write(repo, 'docs/new.md', 'a\nb\nc\nd\n')
    await write(repo, 'assets/icon.bin', Buffer.from([0x89, 0x50, 0x00, 0x47, 0x0d, 0x0a]))
    await git(repo, ['add', '-A'])

    const summary = await readStagedSummary(repo)

    expect(summary.files.map((file) => file.path).sort()).toEqual([
      'assets/icon.bin',
      'docs/new.md',
      'src/app.ts',
      'src/new.ts'
    ])
    expect(byPath(summary.files, 'src/app.ts')).toEqual({
      path: 'src/app.ts',
      kind: 'modified',
      additions: 1,
      deletions: 1
    })
    expect(byPath(summary.files, 'src/new.ts')).toEqual({
      path: 'src/new.ts',
      kind: 'added',
      additions: 2,
      deletions: 0
    })
    expect(byPath(summary.files, 'docs/new.md')).toEqual({
      path: 'docs/new.md',
      origPath: 'docs/old.md',
      kind: 'renamed',
      additions: 1,
      deletions: 0
    })
    expect(byPath(summary.files, 'assets/icon.bin')).toEqual({
      path: 'assets/icon.bin',
      kind: 'added',
      additions: null,
      deletions: null
    })

    expect(summary.patchTruncated).toBe(false)
    expect(summary.patch).toContain('diff --git a/src/app.ts b/src/app.ts')
    expect(summary.patch).toContain('diff --git a/docs/old.md b/docs/new.md')
  })

  it('returns an empty summary without staged changes', async () => {
    const repo = await initRepo()
    expect(await readStagedSummary(repo)).toEqual({ files: [], patch: '', patchTruncated: false })
  })

  it('reads staged files on an unborn branch', async () => {
    const repo = await tempDir('gtd-message-')
    await git(repo, ['init', '-q', '-b', 'main'])
    await write(repo, 'first.txt', 'hello\n')
    await git(repo, ['add', '-A'])

    const summary = await readStagedSummary(repo)
    expect(summary.files).toEqual([{ path: 'first.txt', kind: 'added', additions: 1, deletions: 0 }])
  })

  it('caps the patch at the byte limit and flags the truncation', async () => {
    const repo = await initRepo()
    await write(repo, 'big.txt', `${'a'.repeat(4000)}\n`)
    await git(repo, ['add', '-A'])
    await git(repo, ['commit', '-q', '-m', 'big'])
    await write(repo, 'big.txt', `${'b'.repeat(4000)}\n`)
    await git(repo, ['add', '-A'])

    const capped = await readStagedSummary(repo, { patchLimit: 200 })
    expect(capped.patchTruncated).toBe(true)
    expect(capped.patch.length).toBeLessThanOrEqual(200)
    expect(capped.patch.startsWith('diff --git a/big.txt b/big.txt')).toBe(true)

    const full = await readStagedSummary(repo)
    expect(full.patchTruncated).toBe(false)
    expect(full.patch.length).toBeGreaterThan(200)
  })
})

describe('resolveCommitTemplate', () => {
  it('reads the configured template by absolute path', async () => {
    const repo = await initRepo()
    const home = await tempDir('gtd-home-')
    const template = join(repo, 'my-template.txt')
    await write(repo, 'my-template.txt', 'feat(scope): \n')
    await git(repo, ['config', 'commit.template', template])

    expect(await resolveCommitTemplate(repo, { home })).toBe('feat(scope): \n')
  })

  it('resolves a relative configured path against the repository', async () => {
    const repo = await initRepo()
    const home = await tempDir('gtd-home-')
    await write(repo, '.gitmessage', 'fix: describe the change\n')
    await git(repo, ['config', 'commit.template', '.gitmessage'])

    expect(await resolveCommitTemplate(repo, { home })).toBe('fix: describe the change\n')
  })

  it('expands a ~-prefixed configured path', async () => {
    const repo = await initRepo()
    const home = await tempDir('gtd-home-')
    await write(home, 'template.txt', 'chore: note\n')
    await git(repo, ['config', 'commit.template', '~/template.txt'])

    expect(await resolveCommitTemplate(repo, { home })).toBe('chore: note\n')
  })

  it('falls back to ~/.gitmessage when the configured file is missing', async () => {
    const repo = await initRepo()
    const home = await tempDir('gtd-home-')
    await git(repo, ['config', 'commit.template', join(repo, 'missing.txt')])
    await write(home, '.gitmessage', 'docs: update the guide\n')

    expect(await resolveCommitTemplate(repo, { home })).toBe('docs: update the guide\n')
  })

  it('returns null when neither the configured nor the fallback template exists', async () => {
    const repo = await initRepo()
    const home = await tempDir('gtd-home-')
    expect(await resolveCommitTemplate(repo, { home })).toBeNull()
  })

  it('caps the template length', async () => {
    const repo = await initRepo()
    const home = await tempDir('gtd-home-')
    await write(home, '.gitmessage', 'x'.repeat(COMMIT_TEMPLATE_LIMIT + 500))

    expect((await resolveCommitTemplate(repo, { home }))?.length).toBe(COMMIT_TEMPLATE_LIMIT)
  })
})

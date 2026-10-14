import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runGitOrThrow } from '../src/run'
import {
  createTag,
  deleteRemoteTag,
  deleteTag,
  listRemoteTags,
  parseLsRemoteTags,
  pushAllTags,
  pushTag
} from '../src/tags'

let dirs: string[] = []

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
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

async function fixture(): Promise<{ origin: string; work: string }> {
  const origin = await tempDir('gtd-tag-origin-')
  await git(origin, ['init', '-q', '--bare'])
  const work = await tempDir('gtd-tag-work-')
  await git(work, ['init', '-q', '-b', 'main'])
  await git(work, ['config', 'user.name', 'GitTreeDesk Test'])
  await git(work, ['config', 'user.email', 'test@gitreedesk.invalid'])
  await write(work, 'a.txt', 'one\n')
  await git(work, ['add', '.'])
  await git(work, ['commit', '-q', '-m', 'first'])
  await git(work, ['remote', 'add', 'origin', origin])
  await git(work, ['push', '-q', '-u', 'origin', 'main'])
  await git(origin, ['symbolic-ref', 'HEAD', 'refs/heads/main'])
  return { origin, work }
}

afterEach(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true })
  dirs = []
})

describe('parseLsRemoteTags', () => {
  it('parses lightweight and annotated tags, preferring the peeled commit', () => {
    const tags = parseLsRemoteTags(
      [
        `${'f'.repeat(40)}\trefs/tags/v1.0.0`,
        `${'a'.repeat(40)}\trefs/tags/v1.0.0^{}`,
        `${'d'.repeat(40)}\trefs/tags/light`,
        ''
      ].join('\n')
    )
    expect(tags).toEqual([
      { name: 'light', sha: 'd'.repeat(40) },
      { name: 'v1.0.0', sha: 'a'.repeat(40) }
    ])
  })

  it('ignores non-tag refs and empty output', () => {
    expect(parseLsRemoteTags('')).toEqual([])
    expect(parseLsRemoteTags(`${'a'.repeat(40)}\trefs/heads/main`)).toEqual([])
  })
})

describe('tags against a real repository', () => {
  it(
    'creates lightweight and annotated tags on the requested target',
    async () => {
      const repo = await tempDir('gtd-tag-repo-')
      await git(repo, ['init', '-q', '-b', 'main'])
      await git(repo, ['config', 'user.name', 'GitTreeDesk Test'])
      await git(repo, ['config', 'user.email', 'test@gitreedesk.invalid'])
      await write(repo, 'a.txt', 'one\n')
      await git(repo, ['add', '.'])
      await git(repo, ['commit', '-q', '-m', 'first'])
      const first = (await git(repo, ['rev-parse', 'HEAD'])).trim()

      await write(repo, 'b.txt', 'two\n')
      await git(repo, ['add', '.'])
      await git(repo, ['commit', '-q', '-m', 'second'])

      await createTag(repo, { name: 'light', target: first })
      await createTag(repo, { name: 'v1.0.0', target: 'HEAD', message: 'Release 1.0.0' })

      expect((await git(repo, ['cat-file', '-t', 'light'])).trim()).toBe('commit')
      expect((await git(repo, ['rev-parse', 'light^{commit}'])).trim()).toBe(first)
      expect((await git(repo, ['cat-file', '-t', 'v1.0.0'])).trim()).toBe('tag')
      expect((await git(repo, ['for-each-ref', '--format=%(contents:subject)', 'refs/tags/v1.0.0'])).trim()).toBe(
        'Release 1.0.0'
      )

      await deleteTag(repo, 'light')
      expect((await git(repo, ['tag', '--list'])).trim()).toBe('v1.0.0')
    },
    30_000
  )

  it(
    'pushes, lists and deletes tags on a remote',
    async () => {
      const { work } = await fixture()
      const head = (await git(work, ['rev-parse', 'HEAD'])).trim()

      await createTag(work, { name: 'light', target: 'HEAD' })
      await createTag(work, { name: 'v1.0.0', target: 'HEAD', message: 'Release 1.0.0' })
      await pushTag(work, 'origin', 'v1.0.0')

      let remoteTags = await listRemoteTags(work, 'origin')
      expect(remoteTags).toEqual([{ name: 'v1.0.0', sha: head }])

      await pushAllTags(work, 'origin')
      remoteTags = await listRemoteTags(work, 'origin')
      expect(remoteTags).toEqual([
        { name: 'light', sha: head },
        { name: 'v1.0.0', sha: head }
      ])

      await deleteRemoteTag(work, 'origin', 'light')
      expect(await listRemoteTags(work, 'origin')).toEqual([{ name: 'v1.0.0', sha: head }])

      await deleteTag(work, 'light')
      expect((await git(work, ['tag', '--list'])).trim()).toBe('v1.0.0')
    },
    60_000
  )
})

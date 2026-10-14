import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { addRemote, listRemotes, parseRemoteV, removeRemote, resolveDefaultRemote, setRemoteUrl } from '../src/remotes'
import { runGitOrThrow } from '../src/run'

let dirs: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'gtd-remote-'))
  dirs.push(dir)
  return dir
}

async function initRepo(): Promise<string> {
  const dir = await tempDir()
  await runGitOrThrow(['init', '-q', '-b', 'main'], { cwd: dir })
  return dir
}

afterEach(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true })
  dirs = []
})

describe('parseRemoteV', () => {
  it('parses fetch and push URLs, defaulting push to fetch', () => {
    const remotes = parseRemoteV(
      [
        'origin\tgit@example.com:acme/api-server.git (fetch)',
        'origin\tgit@example.com:acme/api-server.git (push)',
        'upstream\thttps://example.com/acme/api-server.git (fetch)',
        'upstream\thttps://example.com/acme/api-server.git (push)'
      ].join('\n')
    )
    expect(remotes).toEqual([
      {
        name: 'origin',
        fetchUrl: 'git@example.com:acme/api-server.git',
        pushUrl: 'git@example.com:acme/api-server.git'
      },
      {
        name: 'upstream',
        fetchUrl: 'https://example.com/acme/api-server.git',
        pushUrl: 'https://example.com/acme/api-server.git'
      }
    ])
  })

  it('keeps a dedicated push URL distinct from the fetch URL', () => {
    const remotes = parseRemoteV(
      [
        'origin\tgit@example.com:acme/mirror.git (fetch)',
        'origin\tgit@example.com:acme/api-server.git (push)'
      ].join('\n')
    )
    expect(remotes[0]).toEqual({
      name: 'origin',
      fetchUrl: 'git@example.com:acme/mirror.git',
      pushUrl: 'git@example.com:acme/api-server.git'
    })
  })

  it('ignores empty lines and returns nothing for no remotes', () => {
    expect(parseRemoteV('')).toEqual([])
    expect(parseRemoteV('\n\n')).toEqual([])
  })
})

describe('resolveDefaultRemote', () => {
  const remotes = [
    { name: 'fork', fetchUrl: 'a', pushUrl: 'a' },
    { name: 'origin', fetchUrl: 'b', pushUrl: 'b' }
  ]

  it('prefers the configured remote when present', () => {
    expect(resolveDefaultRemote(remotes, 'fork')).toBe('fork')
  })

  it('falls back to origin, then the first remote', () => {
    expect(resolveDefaultRemote(remotes, 'missing')).toBe('origin')
    expect(resolveDefaultRemote(remotes.slice(0, 1), null)).toBe('fork')
    expect(resolveDefaultRemote([], 'origin')).toBeNull()
  })
})

describe('remotes against a real repository', () => {
  it(
    'adds, edits and removes remotes',
    async () => {
      const repo = await initRepo()
      await addRemote(repo, 'origin', 'https://example.com/acme/api-server.git')
      await addRemote(repo, 'mirror', 'https://example.com/acme/mirror.git')

      let remotes = await listRemotes(repo)
      expect(remotes.map((remote) => remote.name)).toEqual(['mirror', 'origin'])
      expect(remotes.find((remote) => remote.name === 'origin')?.fetchUrl).toBe(
        'https://example.com/acme/api-server.git'
      )

      await setRemoteUrl(repo, 'origin', 'https://example.com/acme/moved.git')
      remotes = await listRemotes(repo)
      expect(remotes.find((remote) => remote.name === 'origin')?.fetchUrl).toBe(
        'https://example.com/acme/moved.git'
      )

      await setRemoteUrl(repo, 'origin', 'https://example.com/acme/push.git', { push: true })
      remotes = await listRemotes(repo)
      expect(remotes.find((remote) => remote.name === 'origin')).toEqual({
        name: 'origin',
        fetchUrl: 'https://example.com/acme/moved.git',
        pushUrl: 'https://example.com/acme/push.git'
      })

      await removeRemote(repo, 'mirror')
      expect((await listRemotes(repo)).map((remote) => remote.name)).toEqual(['origin'])
    },
    30_000
  )
})

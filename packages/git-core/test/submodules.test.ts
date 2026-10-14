import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { runGitOrThrow } from '../src/run'
import { listSubmodules, syncSubmoduleUrls, updateSubmodules } from '../src/submodules'

const toPosix = (value: string): string => value.replace(/\\/g, '/')

let dirs: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'gtd-submodules-'))
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

async function commitAll(cwd: string, message: string): Promise<string> {
  await git(cwd, ['add', '.'])
  await git(cwd, ['commit', '-q', '-m', message])
  return (await git(cwd, ['rev-parse', 'HEAD'])).trim()
}

/** Advances the submodule's HEAD so the superproject records it as out of sync. */
async function drift(touched: string): Promise<void> {
  const identity = ['-c', 'user.name=GitTreeDesk Test', '-c', 'user.email=test@gitreedesk.invalid']
  await write(touched, 'extra.txt', 'wip\n')
  await git(touched, [...identity, 'add', '.'])
  await git(touched, [...identity, 'commit', '-q', '-m', 'drift'])
}

/** Superproject with one `libs/core` submodule cloned from a local repository. */
async function initSuperproject(): Promise<{ repo: string; sub: string }> {
  const sub = await initRepo()
  await write(sub, 'lib.txt', 'lib\n')
  await commitAll(sub, 'library')
  const repo = await initRepo()
  await git(repo, ['submodule', 'add', '-q', toPosix(sub), 'libs/core'])
  await commitAll(repo, 'add library submodule')
  return { repo, sub }
}

// Cloning from a local path uses the file protocol, which git blocks for
// submodules unless it is explicitly allowed; the allowance has to be in the
// environment because the submodule helpers spawn their own git processes.
let previousAllow: string | undefined

beforeAll(() => {
  previousAllow = process.env.GIT_ALLOW_PROTOCOL
  process.env.GIT_ALLOW_PROTOCOL = 'file'
})

afterAll(() => {
  if (previousAllow === undefined) delete process.env.GIT_ALLOW_PROTOCOL
  else process.env.GIT_ALLOW_PROTOCOL = previousAllow
})

afterEach(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true })
  dirs = []
})

describe('submodules', () => {
  it('reports an in-sync submodule and leaves a no-op update alone', async () => {
    const { repo } = await initSuperproject()
    const status = await listSubmodules({ repoPath: repo })
    expect(status).toHaveLength(1)
    expect(status[0]?.path).toBe('libs/core')
    expect(status[0]?.checkout).toBe('in-sync')

    await updateSubmodules({ repoPath: repo, paths: ['libs/core'] })
    expect((await listSubmodules({ repoPath: repo }))[0]?.checkout).toBe('in-sync')
  }, 30_000)

  it('resets a drifted submodule and streams its output', async () => {
    const { repo } = await initSuperproject()
    await drift(join(repo, 'libs', 'core'))
    expect((await listSubmodules({ repoPath: repo }))[0]?.checkout).toBe('different')

    const chunks: string[] = []
    await updateSubmodules({ repoPath: repo, paths: ['libs/core'], onOutput: (chunk) => chunks.push(chunk) })
    expect((await listSubmodules({ repoPath: repo }))[0]?.checkout).toBe('in-sync')
    expect(chunks.join('')).toContain('libs/core')
  }, 30_000)

  it('initializes an uninitialized submodule with --init', async () => {
    const { repo } = await initSuperproject()
    await rm(join(repo, 'libs'), { recursive: true, force: true })
    await rm(join(repo, '.git', 'modules'), { recursive: true, force: true })
    await git(repo, ['config', '--remove-section', 'submodule.libs/core'])
    expect((await listSubmodules({ repoPath: repo }))[0]?.checkout).toBe('uninitialized')

    await updateSubmodules({ repoPath: repo, paths: ['libs/core'], init: true })
    expect((await listSubmodules({ repoPath: repo }))[0]?.checkout).toBe('in-sync')
    const text = await readFile(join(repo, 'libs', 'core', 'lib.txt'), 'utf8')
    expect(text.replace(/\r\n/g, '\n')).toBe('lib\n')
  }, 30_000)

  it('updates every submodule when no paths are given', async () => {
    const { repo } = await initSuperproject()
    await drift(join(repo, 'libs', 'core'))
    await updateSubmodules({ repoPath: repo })
    expect((await listSubmodules({ repoPath: repo }))[0]?.checkout).toBe('in-sync')
  }, 30_000)

  it('syncs submodule URLs from .gitmodules', async () => {
    const { repo, sub } = await initSuperproject()
    await git(repo, ['config', 'submodule.libs/core.url', 'https://example.invalid/core.git'])
    const result = await syncSubmoduleUrls({ repoPath: repo, paths: ['libs/core'] })
    expect(result.code).toBe(0)
    const url = (await git(repo, ['config', 'submodule.libs/core.url'])).trim()
    expect(url).toBe(toPosix(sub))
  }, 30_000)
})

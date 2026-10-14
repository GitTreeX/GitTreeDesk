import type { RemoteInfo } from '@gitreedesk/shared'
import { runGitOrThrow } from './run'

export interface RemoteOpOptions {
  signal?: AbortSignal
}

function assertRemoteName(name: string): void {
  if (name.length === 0 || name.startsWith('-') || /[\s\u0000-\u001f]/.test(name)) {
    throw new Error(`Invalid remote name: ${JSON.stringify(name)}`)
  }
}

function assertRemoteUrl(url: string): void {
  if (url.length === 0 || url.startsWith('-') || /[\u0000-\u001f]/.test(url)) {
    throw new Error(`Invalid remote URL: ${JSON.stringify(url)}`)
  }
}

/** Parses `git remote -v`: one line per URL, `<name>\t<url> (fetch|push)`. */
export function parseRemoteV(stdout: string): RemoteInfo[] {
  const byName = new Map<string, RemoteInfo>()

  for (const line of stdout.split('\n')) {
    if (line.length === 0) continue
    const match = /^(\S+)\t(.+) \((fetch|push)\)$/.exec(line)
    if (match === null) continue
    const [, name = '', url = '', kind = ''] = match

    const remote = byName.get(name) ?? { name, fetchUrl: '', pushUrl: '' }
    if (kind === 'fetch') {
      if (remote.fetchUrl.length === 0) remote.fetchUrl = url
    } else if (remote.pushUrl.length === 0) {
      remote.pushUrl = url
    }
    byName.set(name, remote)
  }

  const remotes = [...byName.values()]
  // A configured remote always lists a fetch URL; without one the line was push-only.
  for (const remote of remotes) {
    if (remote.pushUrl.length === 0) remote.pushUrl = remote.fetchUrl
  }
  return remotes.sort((a, b) => a.name.localeCompare(b.name))
}

export async function listRemotes(repoPath: string, options: RemoteOpOptions = {}): Promise<RemoteInfo[]> {
  const result = await runGitOrThrow(['remote', '-v'], { cwd: repoPath, signal: options.signal })
  return parseRemoteV(result.stdout)
}

export async function addRemote(
  repoPath: string,
  name: string,
  url: string,
  options: RemoteOpOptions = {}
): Promise<void> {
  assertRemoteName(name)
  assertRemoteUrl(url)
  await runGitOrThrow(['remote', 'add', name, url], { cwd: repoPath, signal: options.signal })
}

export async function removeRemote(
  repoPath: string,
  name: string,
  options: RemoteOpOptions = {}
): Promise<void> {
  assertRemoteName(name)
  await runGitOrThrow(['remote', 'remove', name], { cwd: repoPath, signal: options.signal })
}

/** Rewrites the fetch URL, or the separate push URL when `push` is set. */
export async function setRemoteUrl(
  repoPath: string,
  name: string,
  url: string,
  options: RemoteOpOptions & { push?: boolean } = {}
): Promise<void> {
  assertRemoteName(name)
  assertRemoteUrl(url)
  const args = ['remote', 'set-url']
  if (options.push === true) args.push('--push')
  args.push(name, url)
  await runGitOrThrow(args, { cwd: repoPath, signal: options.signal })
}

/**
 * The remote commands default to: the configured name when the repo has it,
 * `origin` when it exists, otherwise the first remote by name.
 */
export function resolveDefaultRemote(
  remotes: readonly RemoteInfo[],
  configured: string | null
): string | null {
  if (configured !== null && remotes.some((remote) => remote.name === configured)) return configured
  if (remotes.some((remote) => remote.name === 'origin')) return 'origin'
  return remotes[0]?.name ?? null
}

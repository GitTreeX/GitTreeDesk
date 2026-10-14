import type { RemoteTag } from '@gitreedesk/shared'
import { assertRefName } from './branches'
import { runGitOrThrow, type GitRunResult } from './run'

export interface TagOpOptions {
  signal?: AbortSignal
  onOutput?: (chunk: string) => void
}

export interface CreateTagOptions extends TagOpOptions {
  name: string
  /** Revision the tag points at, e.g. `HEAD`, a branch or a commit sha. */
  target: string
  /** A message makes the tag annotated; omit for a lightweight tag. */
  message?: string | null
}

export async function createTag(repoPath: string, options: CreateTagOptions): Promise<void> {
  assertRefName(options.name)
  if (options.target.length === 0 || options.target.startsWith('-')) {
    throw new Error(`Invalid tag target: ${options.target}`)
  }
  const message = options.message?.trim() ?? ''
  const args = message.length > 0
    ? ['tag', '-a', options.name, options.target, '-m', message]
    : ['tag', options.name, options.target]
  await runGitOrThrow(args, { cwd: repoPath, signal: options.signal })
}

export async function deleteTag(
  repoPath: string,
  name: string,
  options: TagOpOptions = {}
): Promise<void> {
  assertRefName(name)
  await runGitOrThrow(['tag', '-d', name], { cwd: repoPath, signal: options.signal })
}

export async function pushTag(
  repoPath: string,
  remote: string,
  name: string,
  options: TagOpOptions = {}
): Promise<GitRunResult> {
  assertRefName(name)
  return await runGitOrThrow(['push', remote, `refs/tags/${name}`], {
    cwd: repoPath,
    signal: options.signal,
    onStdout: options.onOutput,
    onStderr: options.onOutput
  })
}

/** `git push --tags`: every local tag that is missing on the remote. */
export async function pushAllTags(
  repoPath: string,
  remote: string,
  options: TagOpOptions = {}
): Promise<GitRunResult> {
  return await runGitOrThrow(['push', remote, '--tags'], {
    cwd: repoPath,
    signal: options.signal,
    onStdout: options.onOutput,
    onStderr: options.onOutput
  })
}

export async function deleteRemoteTag(
  repoPath: string,
  remote: string,
  name: string,
  options: TagOpOptions = {}
): Promise<GitRunResult> {
  assertRefName(name)
  return await runGitOrThrow(['push', remote, `:refs/tags/${name}`], {
    cwd: repoPath,
    signal: options.signal,
    onStdout: options.onOutput,
    onStderr: options.onOutput
  })
}

/**
 * Parses `git ls-remote --tags`: one line per ref, `<sha>\trefs/tags/<name>`.
 * Annotated tags also list a peeled `<sha>\trefs/tags/<name>^{}` line, which
 * replaces the tag-object sha so entries always carry the commit sha.
 */
export function parseLsRemoteTags(stdout: string): RemoteTag[] {
  const byName = new Map<string, string>()

  for (const line of stdout.split('\n')) {
    if (line.length === 0) continue
    const match = /^([0-9a-f]+)\trefs\/tags\/(.+)$/.exec(line)
    if (match === null) continue
    const [, sha = '', rawName = ''] = match
    const peeled = rawName.endsWith('^{}')
    const name = peeled ? rawName.slice(0, -3) : rawName
    if (name.length === 0) continue
    if (peeled || !byName.has(name)) byName.set(name, sha)
  }

  return [...byName.entries()]
    .map(([name, sha]) => ({ name, sha }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function listRemoteTags(
  repoPath: string,
  remote: string,
  options: TagOpOptions = {}
): Promise<RemoteTag[]> {
  const result = await runGitOrThrow(['ls-remote', '--tags', remote], {
    cwd: repoPath,
    signal: options.signal
  })
  return parseLsRemoteTags(result.stdout)
}

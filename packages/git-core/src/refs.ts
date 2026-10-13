import type { GitRef, RefKind } from '@gitreedesk/shared'
import { runGitOrThrow } from './run'

const FORMAT = [
  '%(refname)',
  '%(refname:short)',
  '%(objectname)',
  '%(*objectname)',
  '%(upstream:short)',
  '%(upstream:track)',
  '%(contents:subject)',
  '%(HEAD)'
].join('%00')

function refKind(fullName: string): RefKind | null {
  if (fullName.startsWith('refs/heads/')) return 'branch'
  if (fullName.startsWith('refs/remotes/')) return 'remote'
  if (fullName.startsWith('refs/tags/')) return 'tag'
  return null
}

function parseTrack(track: string): { ahead: number; behind: number } {
  const ahead = /ahead (\d+)/.exec(track)
  const behind = /behind (\d+)/.exec(track)
  return {
    ahead: ahead === null ? 0 : Number(ahead[1]),
    behind: behind === null ? 0 : Number(behind[1])
  }
}

export function parseForEachRef(stdout: string): GitRef[] {
  const refs: GitRef[] = []

  for (const line of stdout.split('\n')) {
    if (line.length === 0) continue

    const [fullName = '', name = '', objectName = '', peeledName = '', upstream = '', track = '', subject = '', headMark = ''] =
      line.split('\0')

    const kind = refKind(fullName)
    if (kind === null) continue
    // `<remote>/HEAD` is a symbolic alias of the remote's default branch, not a branch of its own.
    // Its short name resolves to the bare remote name, so the full name is the reliable marker.
    if (kind === 'remote' && fullName.endsWith('/HEAD')) continue

    const { ahead, behind } = parseTrack(track)
    refs.push({
      name,
      fullName,
      kind,
      // Annotated tags point at a tag object; the peeled name is the commit they ultimately reference.
      sha: peeledName.length > 0 ? peeledName : objectName,
      isHead: headMark === '*',
      upstream: upstream.length > 0 ? upstream : null,
      ahead,
      behind,
      subject: subject.length > 0 ? subject : null
    })
  }

  return refs
}

export interface ListRefsOptions {
  repoPath: string
  signal?: AbortSignal
}

export async function listRefs(options: ListRefsOptions): Promise<GitRef[]> {
  const result = await runGitOrThrow(
    ['for-each-ref', `--format=${FORMAT}`, 'refs/heads', 'refs/remotes', 'refs/tags'],
    { cwd: options.repoPath, signal: options.signal }
  )
  return parseForEachRef(result.stdout)
}

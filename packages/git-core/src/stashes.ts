import type { StashEntry } from '@gitreedesk/shared'
import { runGitOrThrow } from './run'

const FORMAT = '%gd%x00%H%x00%gs'

export function parseStashList(stdout: string): StashEntry[] {
  const tokens = stdout.split('\0')
  if (tokens[tokens.length - 1] === '') tokens.pop()

  const stashes: StashEntry[] = []
  for (let i = 0; i + 3 <= tokens.length; i += 3) {
    const selector = tokens[i] ?? ''
    if (selector.length === 0) continue

    const match = /\{(\d+)\}/.exec(selector)
    stashes.push({
      index: match === null ? stashes.length : Number(match[1]),
      selector,
      sha: tokens[i + 1] ?? '',
      subject: tokens[i + 2] ?? ''
    })
  }
  return stashes
}

export interface ListStashesOptions {
  repoPath: string
  signal?: AbortSignal
}

export async function listStashes(options: ListStashesOptions): Promise<StashEntry[]> {
  const result = await runGitOrThrow(['stash', 'list', '-z', `--format=${FORMAT}`], {
    cwd: options.repoPath,
    signal: options.signal
  })
  return parseStashList(result.stdout)
}

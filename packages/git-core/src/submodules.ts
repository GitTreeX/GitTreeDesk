import type { SubmoduleCheckout, SubmoduleInfo } from '@gitreedesk/shared'
import { runGit } from './run'

const PREFIX_TO_CHECKOUT: Record<string, SubmoduleCheckout | undefined> = {
  ' ': 'in-sync',
  '-': 'uninitialized',
  '+': 'different',
  U: 'conflict'
}

export function parseSubmoduleStatus(stdout: string): SubmoduleInfo[] {
  const submodules: SubmoduleInfo[] = []

  for (const line of stdout.split('\n')) {
    if (line.length < 42) continue

    const checkout = PREFIX_TO_CHECKOUT[line.charAt(0)]
    if (checkout === undefined) continue

    const sha = line.slice(1, 41)
    let rest = line.slice(42)
    let describe: string | null = null

    if (rest.endsWith(')')) {
      const open = rest.lastIndexOf(' (')
      if (open !== -1) {
        describe = rest.slice(open + 2, -1)
        rest = rest.slice(0, open)
      }
    }
    if (rest.length === 0) continue

    submodules.push({ path: rest, sha, describe, checkout })
  }

  return submodules
}

export interface ListSubmodulesOptions {
  repoPath: string
  signal?: AbortSignal
}

export async function listSubmodules(options: ListSubmodulesOptions): Promise<SubmoduleInfo[]> {
  const result = await runGit(['submodule', 'status'], { cwd: options.repoPath, signal: options.signal })
  if (result.code !== 0) return []
  return parseSubmoduleStatus(result.stdout)
}

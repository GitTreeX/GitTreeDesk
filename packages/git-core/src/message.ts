import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import type { StagedFile, StagedSummary } from '@gitreedesk/shared'
import { parseNameStatusZ } from './diff'
import { GitCommandError } from './errors'
import { runGit, runGitOrThrow, runGitRaw } from './run'
import { LITERAL_PATHS_ENV } from './staging'

/** Default byte cap for the staged patch handed to message generators. */
export const STAGED_PATCH_LIMIT = 512 * 1024
/** Default character cap for a commit template. */
export const COMMIT_TEMPLATE_LIMIT = 8 * 1024

export interface ReadStagedSummaryOptions {
  /** Overrides the byte cap for the textual patch. */
  patchLimit?: number
  signal?: AbortSignal
}

interface Churn {
  additions: number | null
  deletions: number | null
}

/** `--numstat -z`: `add\tdel\tpath\0`; renames/copies split the stats token, then old and new path. */
function parseNumstatZ(stdout: string): Map<string, Churn> {
  const tokens = stdout.split('\0')
  const byPath = new Map<string, Churn>()
  let index = 0
  while (index < tokens.length) {
    const token = tokens[index]
    index += 1
    if (token === undefined || token.length === 0) continue

    const firstTab = token.indexOf('\t')
    const secondTab = firstTab === -1 ? -1 : token.indexOf('\t', firstTab + 1)
    if (firstTab === -1 || secondTab === -1) continue
    const additions = parseCount(token.slice(0, firstTab))
    const deletions = parseCount(token.slice(firstTab + 1, secondTab))

    const inlinePath = token.slice(secondTab + 1)
    if (inlinePath.length > 0) {
      byPath.set(inlinePath, { additions, deletions })
      continue
    }
    const oldPath = tokens[index] ?? ''
    const newPath = tokens[index + 1] ?? ''
    index += 2
    if (oldPath.length > 0 && newPath.length > 0) byPath.set(newPath, { additions, deletions })
  }
  return byPath
}

function parseCount(value: string): number | null {
  if (value === '-') return null
  const parsed = Number.parseInt(value, 10)
  return Number.isNaN(parsed) ? null : parsed
}

/** The staged change-set: name-status, per-file churn and the capped unified patch. */
export async function readStagedSummary(
  repoPath: string,
  options: ReadStagedSummaryOptions = {}
): Promise<StagedSummary> {
  const patchLimit = options.patchLimit ?? STAGED_PATCH_LIMIT
  const common = { cwd: repoPath, env: LITERAL_PATHS_ENV, signal: options.signal }
  const patchArgs = ['diff', '--cached', '--patch', '--unified=3', '-M', '--no-color', '--no-ext-diff', '--no-textconv']
  const [nameStatus, numstat, patchBytes] = await Promise.all([
    runGitOrThrow(['diff', '--cached', '--name-status', '-z', '-M'], common),
    runGitOrThrow(['diff', '--cached', '--numstat', '-z', '-M'], common),
    runGitRaw(patchArgs, common)
  ])
  if (patchBytes.code !== 0) {
    throw new GitCommandError(`git ${patchArgs.join(' ')} failed (exit code ${String(patchBytes.code)})`, {
      args: patchArgs,
      cwd: repoPath,
      code: patchBytes.code,
      stdout: '',
      stderr: patchBytes.stderr
    })
  }

  const churn = parseNumstatZ(numstat.stdout)
  const files: StagedFile[] = parseNameStatusZ(nameStatus.stdout).map((change) => {
    const counts = churn.get(change.path)
    return {
      ...change,
      additions: counts?.additions ?? null,
      deletions: counts?.deletions ?? null
    }
  })

  const truncated = patchBytes.stdout.length > patchLimit
  return {
    files,
    patch: patchBytes.stdout.subarray(0, patchLimit).toString('utf8'),
    patchTruncated: truncated
  }
}

export interface ResolveCommitTemplateOptions {
  /** Overrides the home directory used to expand `~` and to find `~/.gitmessage`. */
  home?: string
  signal?: AbortSignal
}

/** The `commit.template` file, falling back to `~/.gitmessage`; `null` when neither exists. */
export async function resolveCommitTemplate(
  repoPath: string,
  options: ResolveCommitTemplateOptions = {}
): Promise<string | null> {
  const home = options.home ?? homedir()
  const configured = await runGit(['config', '--get', 'commit.template'], {
    cwd: repoPath,
    signal: options.signal
  })
  const raw = configured.code === 0 ? configured.stdout.trim() : ''
  if (raw.length > 0) {
    const text = await readTemplateFile(expandTemplatePath(raw, repoPath, home))
    if (text !== null) return text
  }
  return await readTemplateFile(join(home, '.gitmessage'))
}

function expandTemplatePath(raw: string, repoPath: string, home: string): string {
  if (raw === '~') return home
  if (raw.startsWith('~/') || raw.startsWith('~\\')) return join(home, raw.slice(2))
  return isAbsolute(raw) ? raw : join(repoPath, raw)
}

async function readTemplateFile(absolute: string): Promise<string | null> {
  try {
    return (await readFile(absolute, 'utf8')).slice(0, COMMIT_TEMPLATE_LIMIT)
  } catch {
    return null
  }
}

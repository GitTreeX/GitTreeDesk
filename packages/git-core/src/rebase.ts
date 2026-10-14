import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { CommitInfo, RebaseAction } from '@gitreedesk/shared'
import { editorCommand, editorEnv, editorScriptPath } from './editor'
import { GitCommandError } from './errors'
import { logCommits } from './log'
import { resolveRepoDirs } from './repo'
import { runGit, type GitRunResult } from './run'
import { isOperationStopped } from './status'

export interface RebaseResult {
  /** The rebase stopped on conflicts or an `edit` row. */
  stopped: boolean
  output: string
}

const PLAN_LIMIT = 1000

interface RebaseSession {
  /** Temp dir holding the todo list and message queues. */
  dir: string
  base: string
  startedAt: number
}

const SESSION_FILE = 'rebase-interactive.json'

function assertRev(rev: string, label: string): void {
  if (rev.length === 0 || rev.startsWith('-')) throw new Error(`Invalid ${label}: ${rev}`)
}

/** Replay plan of the list editor: non-merge commits above `base`, oldest first. */
export async function loadRebasePlan(options: {
  repoPath: string
  base: string
  signal?: AbortSignal
}): Promise<CommitInfo[]> {
  assertRev(options.base, 'base')
  const result = await logCommits({
    repoPath: options.repoPath,
    revs: [`${options.base}..HEAD`],
    maxCount: PLAN_LIMIT,
    reverse: true,
    signal: options.signal
  })
  return result.commits.filter((commit) => commit.parents.length <= 1)
}

async function sessionPath(repoPath: string, signal?: AbortSignal): Promise<string> {
  const dirs = await resolveRepoDirs(repoPath, { signal })
  return join(dirs.gitDir, 'gitreedesk', SESSION_FILE)
}

async function readRebaseSession(
  repoPath: string,
  signal?: AbortSignal
): Promise<RebaseSession | null> {
  try {
    const raw = await readFile(await sessionPath(repoPath, signal), 'utf8')
    const value = JSON.parse(raw) as Record<string, unknown>
    if (typeof value.dir !== 'string' || typeof value.base !== 'string') return null
    return {
      dir: value.dir,
      base: value.base,
      startedAt: typeof value.startedAt === 'number' ? value.startedAt : 0
    }
  } catch {
    return null
  }
}

/** Drops a finished interactive-rebase session: state file and temp dir. */
export async function clearRebaseSession(repoPath: string, signal?: AbortSignal): Promise<void> {
  const session = await readRebaseSession(repoPath, signal)
  if (session === null) return
  await rm(await sessionPath(repoPath, signal), { force: true }).catch(() => undefined)
  await rm(session.dir, { recursive: true, force: true }).catch(() => undefined)
}

/**
 * Editor environment for rebase commands. A live interactive session contributes
 * its message queues (reword/squash); without one the editor accepts whatever
 * git prepared, so no window can ever open.
 */
async function rebaseEditorEnv(
  repoPath: string,
  signal?: AbortSignal
): Promise<Record<string, string>> {
  const script = await editorScriptPath()
  const session = await readRebaseSession(repoPath, signal)
  if (session === null) return editorEnv(script)
  return {
    ...editorEnv(script, join(session.dir, 'config.json')),
    GIT_SEQUENCE_EDITOR: editorCommand(script, 'seq')
  }
}

async function classifyRebaseRun(
  repoPath: string,
  args: readonly string[],
  result: GitRunResult,
  signal: AbortSignal | undefined,
  clearOnSuccess: boolean
): Promise<RebaseResult> {
  const output = `${result.stdout}${result.stderr}`.trimEnd()
  if (result.code !== 0) {
    if (await isOperationStopped(repoPath, { signal })) return { stopped: true, output }
    throw new GitCommandError(`git rebase failed (exit code ${String(result.code)})`, {
      args,
      cwd: repoPath,
      code: result.code,
      stdout: result.stdout,
      stderr: result.stderr
    })
  }
  if (clearOnSuccess) await clearRebaseSession(repoPath, signal)
  return { stopped: false, output }
}

/** `git rebase <onto>`; a dirty working tree is auto-stashed and restored by git. */
export async function rebaseOnto(
  repoPath: string,
  options: { onto: string; signal?: AbortSignal }
): Promise<RebaseResult> {
  assertRev(options.onto, 'revision')
  const args = ['-c', 'rebase.autoStash=true', 'rebase', options.onto]
  const result = await runGit(args, {
    cwd: repoPath,
    env: await rebaseEditorEnv(repoPath, options.signal),
    signal: options.signal
  })
  return await classifyRebaseRun(repoPath, args, result, options.signal, true)
}

export interface RebaseStepInput {
  sha: string
  action: RebaseAction
  /** Original subject of a `reword` row; matches the message file git prepares. */
  subject?: string
  /** Replacement message of a `reword`; combined message of a `squash` group. */
  message?: string
}

export interface InteractiveRebaseOptions {
  /** Revision whose descendants are replayed (`git rebase -i <base>`). */
  base: string
  steps: readonly RebaseStepInput[]
  signal?: AbortSignal
}

/**
 * Runs a scripted interactive rebase: the sequence editor is overwritten with the
 * prepared todo list, and queued reword/squash messages are applied by the message
 * editor as git reaches each row. Auto-stash is git's own, so it survives stops.
 */
export async function rebaseInteractive(
  repoPath: string,
  options: InteractiveRebaseOptions
): Promise<RebaseResult> {
  assertRev(options.base, 'base')
  if (options.steps.length === 0) throw new Error('The rebase plan is empty')

  const todo: string[] = []
  const rewords: { subject: string; message: string }[] = []
  const squashes: (string | null)[] = []
  for (const step of options.steps) {
    assertRev(step.sha, 'commit')
    todo.push(`${step.action} ${step.sha}`)
    if (step.action === 'reword') {
      if (
        step.subject === undefined ||
        step.subject.length === 0 ||
        step.message === undefined ||
        step.message.length === 0
      ) {
        throw new Error('A reword step needs the original subject and the new message')
      }
      rewords.push({ subject: step.subject, message: step.message })
    } else if (step.action === 'squash') {
      squashes.push(step.message !== undefined && step.message.length > 0 ? step.message : null)
    }
  }

  const dir = await mkdtemp(join(tmpdir(), 'gtd-rebase-'))
  const script = await editorScriptPath()
  const todoPath = join(dir, 'todo.txt')
  const messagesPath = join(dir, 'messages.json')
  const configPath = join(dir, 'config.json')
  await writeFile(todoPath, `${todo.join('\n')}\n`, 'utf8')
  await writeFile(messagesPath, JSON.stringify({ rewords, squashes }), 'utf8')
  await writeFile(configPath, JSON.stringify({ todo: todoPath, messages: messagesPath }), 'utf8')

  const file = await sessionPath(repoPath, options.signal)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(
    file,
    JSON.stringify({ dir, base: options.base, startedAt: Date.now() } satisfies RebaseSession),
    'utf8'
  )

  const args = ['-c', 'rebase.autoStash=true', 'rebase', '--interactive', options.base]
  try {
    const result = await runGit(args, {
      cwd: repoPath,
      env: {
        ...editorEnv(script, configPath),
        GIT_SEQUENCE_EDITOR: editorCommand(script, 'seq')
      },
      signal: options.signal
    })
    return await classifyRebaseRun(repoPath, args, result, options.signal, true)
  } catch (error) {
    await clearRebaseSession(repoPath, options.signal)
    throw error
  }
}

export async function rebaseAction(
  action: 'continue' | 'skip' | 'abort',
  repoPath: string,
  options: { signal?: AbortSignal } = {}
): Promise<RebaseResult> {
  const args = ['rebase', `--${action}`]
  const result = await runGit(args, {
    cwd: repoPath,
    env: await rebaseEditorEnv(repoPath, options.signal),
    signal: options.signal
  })
  const output = `${result.stdout}${result.stderr}`.trimEnd()
  if (result.code !== 0) {
    if (action !== 'abort' && (await isOperationStopped(repoPath, { signal: options.signal }))) {
      return { stopped: true, output }
    }
    throw new GitCommandError(`git rebase --${action} failed (exit code ${String(result.code)})`, {
      args,
      cwd: repoPath,
      code: result.code,
      stdout: result.stdout,
      stderr: result.stderr
    })
  }
  await clearRebaseSession(repoPath, options.signal)
  return { stopped: false, output }
}

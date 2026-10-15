import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import { GitCommandError } from './errors'

let gitExecutable = 'git'

export function setGitExecutable(executable: string): void {
  gitExecutable = executable
}

export function getGitExecutable(): string {
  return gitExecutable
}

export interface GitRunOptions {
  cwd: string
  env?: Record<string, string | undefined>
  signal?: AbortSignal
  input?: string
  /** When provided, stdout is streamed to this callback and not buffered in the result. */
  onStdout?: (chunk: string) => void
  /** When provided, stderr is streamed to this callback; the result still buffers it. */
  onStderr?: (chunk: string) => void
  timeoutMs?: number
}

export interface GitRunResult {
  code: number | null
  stdout: string
  stderr: string
  aborted: boolean
  timedOut: boolean
}

/** Same as `GitRunResult`, but stdout is the undecoded byte stream (blob reads). */
export interface GitRunRawResult {
  code: number | null
  stdout: Buffer
  stderr: string
  aborted: boolean
  timedOut: boolean
}

function killProcessTree(child: ChildProcess): void {
  const { pid } = child
  if (pid === undefined || child.exitCode !== null) return

  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on(
      'error',
      () => undefined
    )
  } else {
    child.kill('SIGTERM')
  }
}

interface RawRunOutcome {
  code: number | null
  stdout: Buffer
  stderr: string
  aborted: boolean
  timedOut: boolean
}

function runGitProcess(args: readonly string[], options: GitRunOptions): Promise<RawRunOutcome> {
  if (options.signal?.aborted === true) {
    return Promise.resolve({ code: null, stdout: Buffer.alloc(0), stderr: '', aborted: true, timedOut: false })
  }

  const fullArgs = process.platform === 'win32' ? ['-c', 'core.longpaths=true', ...args] : [...args]
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_PAGER: 'cat',
    LC_ALL: 'C',
    LANG: 'C',
    // Many repositories are refreshed in parallel; optional index-lock refreshes would only
    // add lock churn. Required locks taken by write commands are unaffected.
    GIT_OPTIONAL_LOCKS: '0',
    ...options.env
  }

  return new Promise<RawRunOutcome>((resolve, reject) => {
    const child = spawn(gitExecutable, fullArgs, {
      cwd: options.cwd,
      env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    })

    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    const streamStdout = options.onStdout
    const stdoutDecoder = streamStdout === undefined ? null : new StringDecoder('utf8')
    const streamStderr = options.onStderr
    const stderrDecoder = streamStderr === undefined ? null : new StringDecoder('utf8')

    let settled = false
    let aborted = false
    let timedOut = false

    const cleanup = (): void => {
      if (timeout !== null) clearTimeout(timeout)
      options.signal?.removeEventListener('abort', onAbort)
    }

    const onAbort = (): void => {
      aborted = true
      killProcessTree(child)
    }

    const timeout =
      options.timeoutMs === undefined
        ? null
        : setTimeout(() => {
            timedOut = true
            killProcessTree(child)
          }, options.timeoutMs)

    child.stdout.on('data', (chunk: Buffer) => {
      if (stdoutDecoder !== null && streamStdout !== undefined) streamStdout(stdoutDecoder.write(chunk))
      else stdoutChunks.push(chunk)
    })

    child.stderr.on('data', (chunk: Buffer) => {
      if (stderrDecoder !== null && streamStderr !== undefined) streamStderr(stderrDecoder.write(chunk))
      stderrChunks.push(chunk)
    })

    child.on('error', (error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(
        new GitCommandError(`Failed to run ${gitExecutable}`, {
          args,
          cwd: options.cwd,
          code: null,
          stdout: '',
          stderr: '',
          cause: error
        })
      )
    })

    child.on('close', (code) => {
      if (settled) return
      settled = true
      cleanup()
      if (options.signal?.aborted === true) aborted = true

      if (stdoutDecoder !== null) {
        const tail = stdoutDecoder.end()
        if (tail.length > 0) stdoutChunks.push(Buffer.from(tail, 'utf8'))
      }
      resolve({ code, stdout: Buffer.concat(stdoutChunks), stderr: Buffer.concat(stderrChunks).toString('utf8'), aborted, timedOut })
    })

    // Most commands never read stdin and may already have exited by the time the
    // pipe is closed; the resulting EPIPE is expected and must not surface as an
    // unhandled error.
    child.stdin.on('error', () => undefined)
    child.stdin.end(options.input ?? '')

    options.signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export async function runGit(args: readonly string[], options: GitRunOptions): Promise<GitRunResult> {
  const outcome = await runGitProcess(args, options)
  return {
    code: outcome.code,
    stdout: outcome.stdout.toString('utf8'),
    stderr: outcome.stderr,
    aborted: outcome.aborted,
    timedOut: outcome.timedOut
  }
}

export async function runGitRaw(args: readonly string[], options: GitRunOptions): Promise<GitRunRawResult> {
  const outcome = await runGitProcess(args, options)
  return { code: outcome.code, stdout: outcome.stdout, stderr: outcome.stderr, aborted: outcome.aborted, timedOut: outcome.timedOut }
}

export async function runGitOrThrow(args: readonly string[], options: GitRunOptions): Promise<GitRunResult> {
  const result = await runGit(args, options)
  if (result.code !== 0) {
    const reason = result.aborted ? 'aborted' : result.timedOut ? 'timed out' : `exit code ${String(result.code)}`
    throw new GitCommandError(`git ${args.join(' ')} failed (${reason})`, {
      args,
      cwd: options.cwd,
      code: result.code,
      stdout: result.stdout,
      stderr: result.stderr
    })
  }
  return result
}

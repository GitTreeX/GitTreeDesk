export interface GitCommandErrorDetails {
  args: readonly string[]
  cwd: string
  code: number | null
  stdout: string
  stderr: string
  cause?: unknown
}

export class GitCommandError extends Error {
  readonly args: readonly string[]
  readonly cwd: string
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string

  constructor(message: string, details: GitCommandErrorDetails) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause })
    this.name = 'GitCommandError'
    this.args = details.args
    this.cwd = details.cwd
    this.code = details.code
    this.stdout = details.stdout
    this.stderr = details.stderr
  }
}

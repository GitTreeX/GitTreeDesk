export type ServiceErrorCode =
  | 'not-open'
  | 'unknown-repo'
  | 'outside-workspace'
  | 'invalid-name'
  | 'exists'
  | 'file-changed'
  | 'fs-failed'
  | 'git-failed'
  | 'auth-required'
  | 'auth-ssh'
  | 'branch-unmerged'
  | 'branch-in-use'
  | 'worktree-dirty'
  | 'worktree-locked'
  | 'invalid-request'
  | 'operation-in-progress'
  | 'no-operation'
  | 'unresolved-conflicts'
  | 'not-conflicted'
  | 'merge-tool-missing'
  | 'disposed'

/** Expected failures of the main-process services; surfaced to the renderer with their code. */
export class ServiceError extends Error {
  readonly code: ServiceErrorCode
  /** Raw git output for the troubleshooting drawer, when available. */
  readonly details: string | undefined

  constructor(code: ServiceErrorCode, message: string, details?: string) {
    super(message)
    this.name = 'ServiceError'
    this.code = code
    this.details = details
  }
}

export type ServiceErrorCode =
  | 'not-open'
  | 'unknown-repo'
  | 'outside-workspace'
  | 'invalid-name'
  | 'exists'
  | 'file-changed'
  | 'fs-failed'
  | 'git-failed'
  | 'disposed'

/** Expected failures of the main-process services; surfaced to the renderer with their code. */
export class ServiceError extends Error {
  readonly code: ServiceErrorCode

  constructor(code: ServiceErrorCode, message: string) {
    super(message)
    this.name = 'ServiceError'
    this.code = code
  }
}

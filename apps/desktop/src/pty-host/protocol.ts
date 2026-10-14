/** Control messages between the main process and the pty host utility process. */

export interface PtyCreateRequest {
  id: string
  /** Shell executable: a path, or a bare name resolved on the `PATH` by node-pty. */
  shell: string
  args: readonly string[]
  /** Profile environment; merged over the host's own environment. */
  env: Readonly<Record<string, string>>
  cwd: string
  cols: number
  rows: number
  workspaceRoot: string
  repoRoot: string | null
}

export type HostControlRequest =
  | ({ t: 'create' } & PtyCreateRequest)
  | { t: 'attach'; id: string }
  | { t: 'kill'; id: string }
  | { t: 'dispose'; id: string }
  | { t: 'shutdown' }

export type HostControlEvent =
  | { t: 'created'; id: string }
  | { t: 'create-failed'; id: string; message: string }
  | { t: 'exited'; id: string; code: number | null }

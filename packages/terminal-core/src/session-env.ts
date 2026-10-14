/** Starting environment for a terminal session: base env, minus our Git plumbing, plus profile env. */
export interface SessionEnvInput {
  base: Record<string, string | undefined>
  profileEnv?: Readonly<Record<string, string>>
  /** Exposed as `GITREEDESK_WORKSPACE` when set. */
  workspaceRoot?: string | null
  /** Exposed as `GITREEDESK_REPO` when the session directory is inside a repository. */
  repoRoot?: string | null
}

/**
 * Builds the session env: `{...base, ...profileEnv, TERM, GITREEDESK_*}`.
 * `GIT_*` entries are dropped — a shell must not inherit Git plumbing
 * (`GIT_DIR`, `GIT_INDEX_FILE`, …) that belongs to the app's own commands.
 */
export function buildSessionEnv(input: SessionEnvInput): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(input.base)) {
    if (value === undefined || /^GIT_/i.test(key)) continue
    env[key] = value
  }
  for (const [key, value] of Object.entries(input.profileEnv ?? {})) {
    env[key] = value
  }
  env['TERM'] = 'xterm-256color'
  if (input.workspaceRoot !== undefined && input.workspaceRoot !== null) {
    env['GITREEDESK_WORKSPACE'] = input.workspaceRoot
  }
  if (input.repoRoot !== undefined && input.repoRoot !== null) {
    env['GITREEDESK_REPO'] = input.repoRoot
  }
  return env
}

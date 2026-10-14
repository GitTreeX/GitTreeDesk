/** A shell profile a terminal session can start. */
export interface TerminalProfileInfo {
  /** Stable id: a detected id (`pwsh`, `wsl:Ubuntu`, `default`) or a config profile's name. */
  id: string
  name: string
  /** Shell executable: a path, or a bare name resolved on the `PATH`. */
  shell: string
  args: readonly string[]
  env: Readonly<Record<string, string>>
  /** Working-directory template; tokens `{dir}` / `{repoRoot}` / `{workspaceRoot}`. */
  cwd: string | null
  icon: string | null
  color: string | null
  origin: 'detected' | 'config'
  /** True when a config profile's shell cannot be resolved on this machine. */
  missing?: boolean
}

/** A command offered by `.gitreedesk/terminal.json`; never runs on its own. */
export interface TerminalQuickCommandInfo {
  name: string
  command: string
  args: readonly string[]
  /** Starting directory template; tokens `{dir}` / `{repoRoot}` / `{workspaceRoot}`. */
  cwd: string | null
  /** Runs the command line through the shell (pipes, `&&`, env expansion). */
  shellCommand: boolean
}

/** Everything a terminal opened at a directory may choose from. */
export interface TerminalResolutionInfo {
  /** Normalized directory the resolution was made for. */
  dir: string
  /** Profile id to start by default; `null` means the first detected profile. */
  defaultProfile: string | null
  profiles: readonly TerminalProfileInfo[]
  /** Empty in an untrusted workspace. */
  quickCommands: readonly TerminalQuickCommandInfo[]
}

/** State of one live terminal session; sessions outlive the renderer. */
export interface TerminalSessionInfo {
  id: string
  /** Normalized directory the session started in. */
  cwd: string
  profileId: string
  profileName: string
  icon: string | null
  color: string | null
  /** Set when the session runs a quick command instead of an interactive shell. */
  quickName: string | null
  /** False once the shell exited. */
  running: boolean
  exitCode: number | null
}

/** Frames the pty host sends over a session port. `data` is raw pty bytes. */
export type TerminalHostFrame = { t: 'data'; data: Uint8Array } | { t: 'exit'; code: number | null }

/** Frames the renderer sends over a session port. */
export type TerminalClientFrame = { t: 'input'; data: string } | { t: 'resize'; cols: number; rows: number }

import { basename, isAbsolute, join } from 'node:path'
import type { TerminalQuickCommandInfo } from '@gitreedesk/shared'

/** Paths available to `cwd` templates. */
export interface CwdContext {
  /** The terminal's directory. */
  dir: string
  /** Repository root when the directory is inside a repo; `null` otherwise. */
  repoRoot: string | null
  workspaceRoot: string
}

/** Resolves a `cwd` template; `null` and unknown absolute values fall back to the terminal's directory. */
export function applyCwdTemplate(template: string | null, context: CwdContext): string {
  if (template === null || template.trim().length === 0) return context.dir
  const replaced = template
    .replace(/\{dir\}/gi, () => context.dir)
    .replace(/\{repoRoot\}/gi, () => context.repoRoot ?? context.dir)
    .replace(/\{workspaceRoot\}/gi, () => context.workspaceRoot)
  return isAbsolute(replaced) ? replaced : join(context.dir, replaced)
}

/** `~` belongs here: Windows 8.3 short names (`RUNNER~1`) put it in almost every temp path. */
const CMD_SAFE = /^[A-Za-z0-9._:/\\@=+,;~-]+$/

/** Quotes one argv token for a `cmd.exe` command line (C-runtime rules). */
export function quoteCmdArgument(argument: string): string {
  if (argument.length > 0 && CMD_SAFE.test(argument)) return argument
  const escaped = argument.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1')
  return `"${escaped}"`
}

/** Joins file and args into a `cmd.exe /d /s /c` payload; pair with {@link quoteCmdLine}. */
export function buildCmdCommandLine(file: string, args: readonly string[]): string {
  return [file, ...args].map((part) => quoteCmdArgument(part)).join(' ')
}

/** Adds the outer quotes `/s /c` expects when the payload starts with a quote. */
export function quoteCmdLine(line: string): string {
  return line.startsWith('"') ? `"${line}"` : line
}

export interface QuickCommandSpawnPlan {
  /** Executable for the pty. */
  file: string
  args: string[]
  cwd: string
}

export interface PlanQuickCommandInput {
  command: TerminalQuickCommandInfo
  /** The profile the session would start: used for `shellCommand` mode. */
  profile: { shell: string; args: readonly string[] }
  context: CwdContext
  platform: NodeJS.Platform
  /** Resolves an executable on the `PATH`; Windows `.cmd`/`.bat` wrappers need the shell. */
  resolveExecutable?: (name: string) => Promise<string | null>
}

/** Shell-specific arguments that run one command line. */
export function shellCommandArgs(
  shell: string,
  baseArgs: readonly string[],
  line: string,
  platform: NodeJS.Platform
): string[] {
  // `basename` only splits on the host separator; a Windows shell path has to be
  // normalized first so `C:\pwsh.exe` still yields `pwsh.exe` when simulated elsewhere.
  const name = basename(shell.replace(/\\/g, '/')).toLowerCase()
  if (platform === 'win32') {
    if (name === 'cmd' || name === 'cmd.exe') return [...baseArgs, '/d', '/s', '/c', line]
    if (name === 'wsl' || name === 'wsl.exe') return [...baseArgs, '--', 'sh', '-lc', line]
    if (name.startsWith('pwsh') || name.startsWith('powershell')) return [...baseArgs, '-Command', line]
    return [...baseArgs, '-c', line]
  }
  return [...baseArgs, '-c', line]
}

/** Turns a quick command into a spawn plan: argv mode by default, through the shell on request. */
export async function planQuickCommand(input: PlanQuickCommandInput): Promise<QuickCommandSpawnPlan> {
  const { command } = input
  const cwd = applyCwdTemplate(command.cwd, input.context)

  if (command.shellCommand) {
    const line = [command.command, ...command.args].join(' ')
    return {
      file: input.profile.shell,
      args: shellCommandArgs(input.profile.shell, input.profile.args, line, input.platform),
      cwd
    }
  }

  if (input.platform !== 'win32') {
    return { file: command.command, args: [...command.args], cwd }
  }

  const resolve = input.resolveExecutable
  const resolved = resolve === undefined ? null : await resolve(command.command)
  const needsShell =
    resolved !== null && (/\.(cmd|bat)$/i.test(resolved) || resolved.includes(' ') || resolved.includes('\t'))
  if (!needsShell) {
    return { file: resolved ?? command.command, args: [...command.args], cwd }
  }
  const line = buildCmdCommandLine(resolved, command.args)
  return { file: 'cmd.exe', args: ['/d', '/s', '/c', quoteCmdLine(line)], cwd }
}

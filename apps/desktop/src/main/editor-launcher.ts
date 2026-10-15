import { existsSync } from 'node:fs'
import { execSync, spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { shell } from 'electron'
import { buildEditorCommand } from './editor-command'

const LAUNCH_TIMEOUT_MS = 4000

/**
 * Standard Windows install locations for the VSCode CLI shim and GUI binary,
 * keyed by the bare command name. Checked before the registry lookup so the
 * common per-user / system installs are covered without spawning `reg`.
 */
const VSCODE_STANDARD: Record<string, string[]> = {
  code: ['Microsoft VS Code\\bin\\code.cmd', 'Microsoft VS Code\\Code.exe'],
  'code-insiders': [
    'Microsoft VS Code Insiders\\bin\\code-insiders.cmd',
    'Microsoft VS Code Insiders\\Code - Insiders.exe'
  ]
}

/** `App Paths` registry value name for each VSCode launcher. */
const VSCODE_APP_PATHS: Record<string, string> = {
  code: 'Code.exe',
  'code-insiders': 'Code - Insiders.exe'
}

/** Registry roots that may hold the `App Paths` registration. */
const APP_PATHS_KEYS = (filename: string): string[] => [
  `HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${filename}`,
  `HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${filename}`,
  `HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${filename}`
]

function resolveFromStandardLocations(base: string): string | null {
  const candidates = VSCODE_STANDARD[base]
  if (candidates === undefined) return null
  const roots = [
    process.env.LOCALAPPDATA,
    process.env.ProgramFiles,
    process.env['ProgramFiles(X86)']
  ]
  for (const relative of candidates) {
    for (const root of roots) {
      if (root === undefined) continue
      const full = join(root, relative)
      if (existsSync(full)) return full
    }
  }
  return null
}

/**
 * Finds a VSCode launcher through the Windows `App Paths` registration, which
 * VSCode writes regardless of the install directory. This covers custom install
 * locations that are neither on the app's PATH nor under the standard folders.
 * Prefers the `code.cmd` shim next to the binary so the call returns promptly.
 */
function resolveFromAppPaths(base: string, filename: string): string | null {
  for (const key of APP_PATHS_KEYS(filename)) {
    try {
      const output = execSync(`reg query "${key}" /ve`, { windowsHide: true }).toString()
      const match = output.match(/REG_SZ\s+(.+)/i)
      const exe = match?.[1]?.trim().replace(/^"|"$/g, '')
      if (exe === undefined || exe.length === 0) continue
      const cli = join(dirname(exe), 'bin', `${base}.cmd`)
      if (existsSync(cli)) return cli
      if (existsSync(exe)) return exe
    } catch {
      // Key missing or `reg` unavailable — try the next root.
    }
  }
  return null
}

/**
 * Resolves a known VSCode launcher to an absolute path on Windows. `code` is a
 * per-user `.cmd` shim that is often missing from the packaged app's PATH, so we
 * look it up against the standard install folders and, failing that, the Windows
 * `App Paths` registration. Commands that already carry a path, target a
 * different editor, or resolve normally are returned untouched, preserving the
 * existing fallback behavior.
 */
export function resolveEditorCommand(command: string, platform: string): string {
  if (platform !== 'win32') return command
  const trimmed = command.trim()
  if (trimmed.includes('/') || trimmed.includes('\\')) return trimmed
  const base = trimmed.replace(/\.(exe|cmd)$/i, '').toLowerCase()
  if (VSCODE_STANDARD[base] === undefined) return trimmed
  const fromStandard = resolveFromStandardLocations(base)
  if (fromStandard !== null) return fromStandard
  const appPathFile = VSCODE_APP_PATHS[base]
  if (appPathFile !== undefined) {
    const fromAppPaths = resolveFromAppPaths(base, appPathFile)
    if (fromAppPaths !== null) return fromAppPaths
  }
  return trimmed
}

export function nativePath(path: string): string {
  return process.platform === 'win32' ? path.replace(/\//g, '\\') : path
}

/**
 * Launches the configured editor CLI and resolves `ok: false` when the command is
 * unavailable (shell exit without success); the caller falls back to revealing the
 * entry in the OS file manager. A command still running past the timeout counts as
 * launched — some editors block until their window closes.
 */
export async function openInEditor(
  path: string,
  line: number | undefined,
  command: string
): Promise<{ ok: boolean }> {
  const resolvedCommand = resolveEditorCommand(command, process.platform)
  const ok = await launch(buildEditorCommand(resolvedCommand, path, line, process.platform), dirname(path))
  if (!ok) shell.showItemInFolder(nativePath(path))
  return { ok }
}

/** Runs a fully built shell command line detached from the app (external tools). */
export function launchShell(commandLine: string, cwd: string): Promise<boolean> {
  return launch(commandLine, cwd)
}

function launch(commandLine: string, cwd: string): Promise<boolean> {
  return new Promise((resolveDone) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (value: boolean): void => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      resolveDone(value)
    }

    let child
    try {
      child = spawn(commandLine, { shell: true, detached: true, stdio: 'ignore', cwd })
    } catch {
      finish(false)
      return
    }
    child.once('error', () => finish(false))
    child.once('exit', (code) => finish(code === 0))
    timer = setTimeout(() => finish(true), LAUNCH_TIMEOUT_MS)
    child.unref()
  })
}

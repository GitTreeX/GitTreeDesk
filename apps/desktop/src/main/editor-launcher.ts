import { spawn } from 'node:child_process'
import { dirname } from 'node:path'
import { shell } from 'electron'
import { buildEditorCommand } from './editor-command'

const LAUNCH_TIMEOUT_MS = 4000

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
  const ok = await launch(buildEditorCommand(command, path, line, process.platform), dirname(path))
  if (!ok) shell.showItemInFolder(nativePath(path))
  return { ok }
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

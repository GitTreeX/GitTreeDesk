import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, join, posix } from 'node:path'
import type { TerminalProfileInfo } from '@gitreedesk/shared'

/** Probes used by detection; tests override them to stay off the real machine. */
export interface DetectShellOptions {
  platform: NodeJS.Platform
  env: Record<string, string | undefined>
  /** Git installation root derived from `git --exec-path` (Windows Git Bash profile). */
  gitInstallRoot?: string | null
  pathExists?: (path: string) => Promise<boolean>
  /** Lists installed WSL distributions; defaults to running `wsl.exe -l -q`. */
  listWslDistros?: () => Promise<string[]>
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

/** Scans `PATH` for an executable, honoring Windows `PATHEXT`; `null` when missing. */
export async function findExecutable(
  name: string,
  options: { platform: NodeJS.Platform; env: Record<string, string | undefined>; pathExists?: (path: string) => Promise<boolean> }
): Promise<string | null> {
  const probe = options.pathExists ?? exists
  // The list separator follows the simulated platform; the Windows branch then joins with
  // the host path module, because a simulated Windows environment (tests on macOS, say)
  // still hands over paths in the host's spelling. POSIX detection is posix-only.
  const listSeparator = options.platform === 'win32' ? ';' : ':'
  const path = options.env['PATH'] ?? options.env['Path'] ?? ''
  const dirs = path.split(listSeparator).filter((entry) => entry.length > 0)

  if (options.platform === 'win32') {
    const exts = (options.env['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD').split(';')
    const hasExt = /\.[^\\/]+$/.test(name)
    for (const dir of dirs) {
      if (hasExt) {
        const candidate = join(dir, name)
        if (await probe(candidate)) return candidate
        continue
      }
      for (const ext of exts) {
        const candidate = join(dir, `${name}${ext.toLowerCase()}`)
        if (await probe(candidate)) return candidate
      }
    }
    return null
  }

  for (const dir of dirs) {
    const candidate = posix.join(dir, name)
    if (await probe(candidate)) return candidate
  }
  return null
}

/** Windows `wsl.exe -l -q` output decode: UTF-16LE with NULs, or plain UTF-8. */
export function parseWslList(output: Buffer): string[] {
  const text = output.includes(0) ? output.toString('utf16le') : output.toString('utf8')
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\0/g, '').trim())
    .filter(
      (line) =>
        line.length > 0 &&
        !/^(usage|用法|copyright|版权所有)/i.test(line) &&
        !/wsl\.exe/i.test(line)
    )
}

function wslDistros(): Promise<string[]> {
  return new Promise((resolve) => {
    const child = spawn('wsl.exe', ['-l', '-q'], { windowsHide: true })
    const chunks: Buffer[] = []
    const timer = setTimeout(() => {
      child.kill()
      resolve([])
    }, 5_000)
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.on('error', () => {
      clearTimeout(timer)
      resolve([])
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve(code === 0 ? parseWslList(Buffer.concat(chunks)) : [])
    })
  })
}

/** Detected default profiles, ordered by preference. */
export async function detectShellProfiles(options: DetectShellOptions): Promise<TerminalProfileInfo[]> {
  return options.platform === 'win32' ? detectWindows(options) : detectUnix(options)
}

async function detectWindows(options: DetectShellOptions): Promise<TerminalProfileInfo[]> {
  const find = (name: string): Promise<string | null> => findExecutable(name, options)
  const profiles: TerminalProfileInfo[] = []
  const base = { env: {}, cwd: null, icon: null, color: null, origin: 'detected' } as const

  const pwsh = await find('pwsh.exe')
  if (pwsh !== null) {
    profiles.push({ ...base, id: 'pwsh', name: 'PowerShell 7', shell: pwsh, args: ['-NoLogo'] })
  }
  const windowsPowerShell = await find('powershell.exe')
  if (windowsPowerShell !== null) {
    profiles.push({
      ...base,
      id: 'powershell',
      name: 'Windows PowerShell',
      shell: windowsPowerShell,
      args: ['-NoLogo']
    })
  }
  const comspec = options.env['ComSpec'] ?? (await find('cmd.exe'))
  if (comspec !== undefined && comspec !== null) {
    profiles.push({ ...base, id: 'cmd', name: 'Command Prompt', shell: comspec, args: [] })
  }

  const gitBash = await findGitBash(options)
  if (gitBash !== null) {
    profiles.push({ ...base, id: 'git-bash', name: 'Git Bash', shell: gitBash, args: ['--login', '-i'] })
  }

  const distros = await (options.listWslDistros ?? wslDistros)()
  for (const distro of distros) {
    profiles.push({
      ...base,
      id: `wsl:${distro}`,
      name: `${distro} (WSL)`,
      shell: 'wsl.exe',
      args: ['-d', distro]
    })
  }

  return profiles
}

async function findGitBash(options: DetectShellOptions): Promise<string | null> {
  const root = options.gitInstallRoot
  if (root === null || root === undefined || root.length === 0) return null
  const probe = options.pathExists ?? exists
  const candidates = [join(root, 'bin', 'bash.exe'), join(root, 'usr', 'bin', 'bash.exe')]
  for (const candidate of candidates) {
    if (await probe(candidate)) return candidate
  }
  return null
}

const LOGIN_SHELLS = new Set(['bash', 'zsh', 'fish'])

async function detectUnix(options: DetectShellOptions): Promise<TerminalProfileInfo[]> {
  const base = { env: {}, cwd: null, icon: null, color: null, origin: 'detected' } as const
  const profiles: TerminalProfileInfo[] = []
  const seen = new Set<string>()

  const envShell = options.env['SHELL']
  const defaultShell =
    envShell !== undefined && envShell.length > 0
      ? envShell
      : ((await findExecutable('bash', options)) ?? '/bin/sh')
  seen.add(defaultShell)
  const defaultName = basename(defaultShell)
  profiles.push({
    ...base,
    id: 'default',
    name: defaultName,
    shell: defaultShell,
    args: LOGIN_SHELLS.has(defaultName) ? ['-l'] : []
  })

  for (const name of ['bash', 'zsh', 'fish']) {
    const found = await findExecutable(name, options)
    if (found === null || seen.has(found)) continue
    seen.add(found)
    profiles.push({ ...base, id: name, name, shell: found, args: ['-l'] })
  }

  return profiles
}

import { readFile } from 'node:fs/promises'
import { parse as parseJsonc, printParseErrorCode, type ParseError } from 'jsonc-parser'
import type { TerminalProfileInfo, TerminalQuickCommandInfo, TerminalResolutionInfo } from '@gitreedesk/shared'

/** The three tokens allowed in `cwd` templates. */
export const CWD_TOKENS = ['dir', 'repoRoot', 'workspaceRoot'] as const
export type CwdToken = (typeof CWD_TOKENS)[number]

/** A profile as declared in `terminal.json`; `name` doubles as the id. */
export interface TerminalConfigProfile {
  name: string
  shell: string
  args: string[]
  env: Record<string, string>
  cwd: string | null
  icon: string | null
  color: string | null
}

/** One parsed `terminal.json`, already validated. */
export interface TerminalConfig {
  defaultProfile: string | null
  profiles: TerminalConfigProfile[]
  quickCommands: TerminalQuickCommandInfo[]
}

export interface TerminalConfigEntry {
  /** Forward-slashed absolute path of the config file. */
  path: string
  config: TerminalConfig
}

export interface TerminalConfigWalk {
  entries: TerminalConfigEntry[]
  /** Unreadable or invalid files, as human-readable notes. */
  issues: string[]
}

export function normalizePath(path: string): string {
  const forward = path.replace(/\\/g, '/')
  return forward.length > 1 && forward.endsWith('/') ? forward.slice(0, -1) : forward
}

function isInside(path: string, root: string): boolean {
  const target = process.platform === 'win32' ? path.toLowerCase() : path
  const base = process.platform === 'win32' ? root.toLowerCase() : root
  return target === base || target.startsWith(`${base}/`)
}

/** Reads `terminal.json` files from the workspace root down to `dir`; deepest last. */
export async function collectTerminalConfigs(input: {
  dir: string
  workspaceRoot: string
  readFile?: (path: string) => Promise<string | null>
}): Promise<TerminalConfigWalk> {
  const root = normalizePath(input.workspaceRoot)
  const target = normalizePath(input.dir)
  const entries: TerminalConfigEntry[] = []
  const issues: string[] = []
  if (!isInside(target, root)) return { entries, issues }

  const relative = target.slice(root.length).split('/').filter((segment) => segment.length > 0)
  let current = root
  const directories = [root]
  for (const segment of relative) {
    current = `${current}/${segment}`
    directories.push(current)
  }

  for (const directory of directories) {
    const path = `${directory}/.gitreedesk/terminal.json`
    const text = await (input.readFile ?? readOptionalFile)(path)
    if (text === null) continue
    const parsed = parseTerminalConfig(text)
    if (parsed.config === null) {
      issues.push(...parsed.errors.map((error) => `${path}: ${error}`))
      continue
    }
    entries.push({ path, config: parsed.config })
  }

  return { entries, issues }
}

async function readOptionalFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

/** Tolerant JSONC parse; syntax errors skip the file, empty content means "no settings". */
export function parseTerminalConfig(text: string): { config: TerminalConfig | null; errors: string[] } {
  const parseErrors: ParseError[] = []
  const value: unknown = parseJsonc(text.replace(/^\uFEFF/, ''), parseErrors, {
    allowTrailingComma: true,
    allowEmptyContent: true
  })
  if (parseErrors.length > 0) {
    return {
      config: null,
      errors: parseErrors.map((error) => `${printParseErrorCode(error.error)} at offset ${String(error.offset)}`)
    }
  }
  if (value === undefined) return { config: { defaultProfile: null, profiles: [], quickCommands: [] }, errors: [] }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { config: null, errors: ['the file must contain a JSON object'] }
  }

  const record = value as Record<string, unknown>
  const errors: string[] = []
  const defaultProfile = optionalString(record['defaultProfile'])
  const profiles: TerminalConfigProfile[] = []
  for (const [index, entry] of list(record['profiles']).entries()) {
    const profile = parseProfile(entry)
    if (profile === null) errors.push(`profiles[${index}] needs a name and a shell`)
    else profiles.push(profile)
  }
  const quickCommands: TerminalQuickCommandInfo[] = []
  for (const [index, entry] of list(record['quickCommands']).entries()) {
    const command = parseQuickCommand(entry)
    if (command === null) errors.push(`quickCommands[${index}] needs a name and a command`)
    else quickCommands.push(command)
  }

  return { config: { defaultProfile, profiles, quickCommands }, errors }
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

function stringRecord(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const result: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') result[key] = entry
  }
  return result
}

function parseProfile(value: unknown): TerminalConfigProfile | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const name = optionalString(record['name'])
  const shell = optionalString(record['shell'])
  if (name === null || shell === null) return null
  return {
    name,
    shell,
    args: stringList(record['args']),
    env: stringRecord(record['env']),
    cwd: optionalString(record['cwd']),
    icon: optionalString(record['icon']),
    color: optionalString(record['color'])
  }
}

function parseQuickCommand(value: unknown): TerminalQuickCommandInfo | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const name = optionalString(record['name'])
  const command = optionalString(record['command'])
  if (name === null || command === null) return null
  return {
    name,
    command,
    args: stringList(record['args']),
    cwd: optionalString(record['cwd']),
    shellCommand: record['shellCommand'] === true
  }
}

export interface TerminalResolutionInput {
  entries: readonly TerminalConfigEntry[]
  detectedProfiles: readonly TerminalProfileInfo[]
  /** `terminal.defaultProfile` from workspace settings, then user settings. */
  settingsDefaultProfile: string | null
  /** Quick commands are dropped entirely in an untrusted workspace. */
  quickCommandsAllowed: boolean
}

/** Merges the cascade: deeper files win per key; profiles and quick commands merge by name. */
export function resolveTerminal(input: TerminalResolutionInput): Pick<
  TerminalResolutionInfo,
  'defaultProfile' | 'profiles' | 'quickCommands'
> {
  const profiles = new Map<string, TerminalProfileInfo>()
  for (const detected of input.detectedProfiles) profiles.set(detected.id, detected)
  const commands = new Map<string, TerminalQuickCommandInfo>()
  let defaultProfile: string | null = null

  for (const { config } of input.entries) {
    if (config.defaultProfile !== null) defaultProfile = config.defaultProfile
    for (const profile of config.profiles) {
      profiles.set(profile.name, {
        id: profile.name,
        name: profile.name,
        shell: profile.shell,
        args: profile.args,
        env: profile.env,
        cwd: profile.cwd,
        icon: profile.icon,
        color: profile.color,
        origin: 'config'
      })
    }
    for (const command of config.quickCommands) commands.set(command.name, command)
  }
  if (defaultProfile === null) defaultProfile = input.settingsDefaultProfile

  return {
    defaultProfile,
    profiles: [...profiles.values()],
    quickCommands: input.quickCommandsAllowed ? [...commands.values()] : []
  }
}

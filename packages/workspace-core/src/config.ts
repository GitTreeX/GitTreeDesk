import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { WorkspaceConfig, WorkspaceGroup, WorkspaceScanConfig } from '@gitreedesk/shared'

export const WORKSPACE_DIR = '.gitreedesk'
export const WORKSPACE_CONFIG_FILE = 'workspace.json'

export const DEFAULT_SCAN: WorkspaceScanConfig = Object.freeze({
  maxDepth: 8,
  maxEntries: 200_000,
  followSymlinks: false
})

export function defaultWorkspaceConfig(name: string | null): WorkspaceConfig {
  return { name, exclude: [], scan: { ...DEFAULT_SCAN }, groups: null }
}

export interface LoadedWorkspaceConfig {
  config: WorkspaceConfig
  /** Problems found while reading `workspace.json`; the defaults apply where values were unusable. */
  issues: string[]
}

function parseScan(raw: unknown, issues: string[]): WorkspaceScanConfig {
  const scan = { ...DEFAULT_SCAN }
  if (raw === undefined) return scan

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    issues.push('workspace.json: "scan" must be an object; using defaults')
    return scan
  }

  const record = raw as Record<string, unknown>
  if (record['maxDepth'] !== undefined) {
    const value = record['maxDepth']
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) scan.maxDepth = value
    else issues.push('workspace.json: "scan.maxDepth" must be a positive integer; using default')
  }
  if (record['maxEntries'] !== undefined) {
    const value = record['maxEntries']
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) scan.maxEntries = value
    else issues.push('workspace.json: "scan.maxEntries" must be a positive integer; using default')
  }
  if (record['followSymlinks'] !== undefined) {
    const value = record['followSymlinks']
    if (typeof value === 'boolean') scan.followSymlinks = value
    else issues.push('workspace.json: "scan.followSymlinks" must be a boolean; using default')
  }
  return scan
}

function parseExclude(raw: unknown, issues: string[]): string[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) {
    issues.push('workspace.json: "exclude" must be an array of glob strings; ignored')
    return []
  }
  const patterns: string[] = []
  for (const entry of raw) {
    if (typeof entry === 'string' && entry.length > 0) patterns.push(entry)
    else issues.push('workspace.json: "exclude" entries must be non-empty strings; entry ignored')
  }
  return patterns
}

function parseGroups(raw: unknown, issues: string[]): WorkspaceGroup[] | null {
  if (raw === undefined) return null
  if (!Array.isArray(raw)) {
    issues.push('workspace.json: "groups" must be an array; ignored')
    return null
  }

  const groups: WorkspaceGroup[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) {
      issues.push('workspace.json: group entries must be objects with "name" and "match"; entry ignored')
      continue
    }
    const record = entry as Record<string, unknown>
    const name = record['name']
    const match = record['match']
    if (typeof name !== 'string' || name.length === 0 || !Array.isArray(match)) {
      issues.push('workspace.json: group entries must be objects with "name" and "match"; entry ignored')
      continue
    }
    const patterns = match.filter((pattern): pattern is string => typeof pattern === 'string' && pattern.length > 0)
    if (patterns.length !== match.length) {
      issues.push(`workspace.json: group "${name}" has non-string patterns; those entries were ignored`)
    }
    if (patterns.length === 0) continue
    groups.push({ name, match: patterns })
  }
  return groups.length > 0 ? groups : null
}

/** Tolerant parse: unusable values fall back to defaults and are reported in `issues`. */
export function parseWorkspaceConfig(raw: unknown, fallbackName: string): LoadedWorkspaceConfig {
  const issues: string[] = []
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    issues.push('workspace.json must contain a JSON object; using defaults')
    return { config: defaultWorkspaceConfig(fallbackName), issues }
  }

  const record = raw as Record<string, unknown>
  const nameRaw = record['name']
  let name = fallbackName
  if (nameRaw !== undefined) {
    if (typeof nameRaw === 'string' && nameRaw.length > 0) name = nameRaw
    else issues.push('workspace.json: "name" must be a non-empty string; using folder name')
  }

  return {
    config: {
      name,
      exclude: parseExclude(record['exclude'], issues),
      scan: parseScan(record['scan'], issues),
      groups: parseGroups(record['groups'], issues)
    },
    issues
  }
}

export async function loadWorkspaceConfig(root: string): Promise<LoadedWorkspaceConfig> {
  const fallbackName = basename(root)
  const filePath = join(root, WORKSPACE_DIR, WORKSPACE_CONFIG_FILE)

  let content: string
  try {
    content = await readFile(filePath, 'utf8')
  } catch {
    return { config: defaultWorkspaceConfig(fallbackName), issues: [] }
  }

  let raw: unknown
  try {
    raw = JSON.parse(content) as unknown
  } catch {
    return {
      config: defaultWorkspaceConfig(fallbackName),
      issues: [`workspace.json is not valid JSON; using defaults (${filePath})`]
    }
  }

  return parseWorkspaceConfig(raw, fallbackName)
}

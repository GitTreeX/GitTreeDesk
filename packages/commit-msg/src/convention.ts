import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { ConventionProfile, ConventionSource, SubjectLanguage } from './types'

/** The conventional-commits types `@commitlint/config-conventional` allows. */
export const CONVENTIONAL_TYPES = [
  'build',
  'chore',
  'ci',
  'docs',
  'feat',
  'fix',
  'perf',
  'refactor',
  'revert',
  'style',
  'test'
] as const

const JSON_RC_FILES = ['.commitlintrc', '.commitlintrc.json'] as const
const OPAQUE_RC_FILES = [
  '.commitlintrc.yml',
  '.commitlintrc.yaml',
  '.commitlintrc.js',
  '.commitlintrc.cjs',
  '.commitlintrc.mjs',
  '.commitlintrc.ts',
  'commitlint.config.js',
  'commitlint.config.cjs',
  'commitlint.config.mjs',
  'commitlint.config.ts'
] as const

const CONVENTIONAL_SUBJECT = /^[a-zA-Z][a-zA-Z0-9-]*(\([^()]+\))?!?:(\s|$)/
const CONVENTIONAL_PREFIX = /^[a-zA-Z][a-zA-Z0-9-]*(\([^()]+\))?!?:\s*/

/** Commit types and scopes a commitlint configuration pins down, when known. */
export interface CommitlintInfo {
  types: readonly string[] | null
  scopes: readonly string[] | null
}

export interface ConventionInput {
  /** Parsed commitlint info; `null` when no commitlint configuration exists. */
  commitlint: CommitlintInfo | null
  /** Content of the resolved commit template (`commit.template`), when any. */
  template: string | null
  /** Recent non-merge subjects, newest first. */
  subjects: readonly string[]
}

/** Finds the repository's commitlint configuration and extracts its type and scope lists. */
export async function discoverCommitlint(repoRoot: string): Promise<CommitlintInfo | null> {
  for (const name of JSON_RC_FILES) {
    const text = await readOptional(join(repoRoot, name))
    if (text !== null) return parseCommitlintConfig(safeJson(text))
  }
  for (const name of OPAQUE_RC_FILES) {
    if (await exists(join(repoRoot, name))) return { types: null, scopes: null }
  }
  const pkg = safeJson((await readOptional(join(repoRoot, 'package.json'))) ?? '')
  if (pkg !== null && typeof pkg === 'object' && (pkg as Record<string, unknown>)['commitlint'] !== undefined) {
    return parseCommitlintConfig((pkg as Record<string, unknown>)['commitlint'])
  }
  return null
}

/** Reads `type-enum` / `scope-enum` values; `extends: config-conventional` supplies the standard types. */
export function parseCommitlintConfig(raw: unknown): CommitlintInfo {
  if (raw === null || typeof raw !== 'object') return { types: null, scopes: null }
  const record = raw as Record<string, unknown>
  const extended = toArray(record['extends']).filter((entry): entry is string => typeof entry === 'string')
  const standard = extended.some((entry) => entry.includes('config-conventional'))
  return {
    types: standard ? [...CONVENTIONAL_TYPES] : readEnumRule(record, 'type-enum'),
    scopes: readEnumRule(record, 'scope-enum')
  }
}

/** True when the template's first editable line is a `type(scope): …` skeleton. */
export function templateLooksConventional(template: string | null): boolean {
  if (template === null) return false
  for (const rawLine of template.split('\n')) {
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith('#')) continue
    return CONVENTIONAL_SUBJECT.test(line)
  }
  return false
}

/** Subject style of the sampled history: conventional ratio, language, casing, length. */
export interface SubjectStyle {
  conventional: boolean
  sample: number
  language: SubjectLanguage
  casing: 'lower' | 'upper' | 'unknown'
  averageLength: number | null
}

export function analyzeSubjects(subjects: readonly string[]): SubjectStyle {
  const usable = subjects
    .map((subject) => subject.trim().split('\n')[0]?.trim() ?? '')
    .filter((subject) => subject.length > 0)
  if (usable.length === 0) {
    return { conventional: false, sample: 0, language: 'unknown', casing: 'unknown', averageLength: null }
  }
  const matched = usable.filter((subject) => CONVENTIONAL_SUBJECT.test(subject)).length
  const conventional = matched / usable.length >= 0.5

  let cjk = 0
  let letters = 0
  const cases: ('lower' | 'upper')[] = []
  let lengthSum = 0
  for (const subject of usable) {
    lengthSum += [...subject].length
    for (const character of subject) {
      if (/[\u3400-\u9fff]/.test(character)) cjk += 1
      else if (/[a-zA-Z]/.test(character)) letters += 1
    }
    const body = subject.replace(CONVENTIONAL_PREFIX, '')
    const letter = /[a-zA-Z]/.exec(body)
    if (letter !== null) cases.push(letter[0] === letter[0].toLowerCase() ? 'lower' : 'upper')
  }
  const total = cjk + letters
  const language: SubjectLanguage = total === 0 ? 'unknown' : cjk / total >= 0.3 ? 'zh' : 'en'
  const lower = cases.filter((entry) => entry === 'lower').length
  const casing: 'lower' | 'upper' | 'unknown' =
    cases.length === 0 || lower / cases.length === 0.5 ? 'unknown' : lower / cases.length > 0.5 ? 'lower' : 'upper'
  return {
    conventional,
    sample: usable.length,
    language,
    casing,
    averageLength: Math.round(lengthSum / usable.length)
  }
}

/** Merges commitlint, template and history signals into one profile. */
export function detectConvention(input: ConventionInput): ConventionProfile {
  const sources: ConventionSource[] = []
  if (input.commitlint !== null) sources.push('commitlint')
  const fromTemplate = templateLooksConventional(input.template)
  if (fromTemplate) sources.push('template')
  const style = analyzeSubjects(input.subjects)
  if (style.sample > 0) sources.push('subjects')
  return {
    conventional: input.commitlint !== null || fromTemplate || style.conventional,
    types: input.commitlint?.types ?? null,
    scopes: input.commitlint?.scopes ?? null,
    language: style.language,
    casing: style.casing,
    averageLength: style.averageLength,
    sources
  }
}

function readEnumRule(record: Record<string, unknown>, rule: string): readonly string[] | null {
  const rules = record['rules']
  if (rules === null || typeof rules !== 'object') return null
  const entry = (rules as Record<string, unknown>)[rule]
  if (!Array.isArray(entry)) return null
  const values = entry.length >= 3 ? entry[2] : null
  if (!Array.isArray(values)) return null
  const strings = values.filter((value): value is string => typeof value === 'string' && value.length > 0)
  return strings.length > 0 ? strings : null
}

function toArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value : [value]
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

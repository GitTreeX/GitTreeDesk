import type { ConventionProfile, DraftResult, DraftVariant, StagedFile, StagedSummary } from './types'

const TYPE_FALLBACK_ORDER = [
  'feat',
  'fix',
  'chore',
  'docs',
  'refactor',
  'test',
  'build',
  'ci',
  'style',
  'perf',
  'revert'
] as const

const GENERIC_SCOPE_SEGMENTS = new Set(['src', 'lib', 'app', 'source', 'packages', 'apps', 'test', 'tests', 'spec', 'specs'])

const ZH_VERBS = { add: '新增', remove: '删除', update: '更新' } as const

type Verb = keyof typeof ZH_VERBS
type Category = 'docs' | 'test' | 'ci' | 'build' | 'chore' | 'style'
type Language = 'en' | 'zh'

/** Builds the draft variants for a staged change-set under a detected convention. */
export function buildDrafts(input: { summary: StagedSummary; profile: ConventionProfile }): DraftResult {
  const { files } = input.summary
  const profile = input.profile
  if (files.length === 0) throw new Error('No staged files to describe')
  const { type, ambiguous } = inferType(files, profile.types)
  const scope = inferScope(files, profile.scopes)
  const language: Language = profile.language === 'zh' ? 'zh' : 'en'
  const body = buildBody(files, language)

  const subjects = buildSubjects(files, scope, language)
  const variants: DraftVariant[] = [
    { message: assemble(type, scope, subjects.primary, body, profile), primary: true }
  ]
  if (ambiguous && profile.conventional && (type === 'feat' || type === 'fix')) {
    const other = type === 'feat' ? 'fix' : 'feat'
    if (profile.types === null || profile.types.includes(other)) {
      variants.push({ message: assemble(other, scope, subjects.primary, body, profile), primary: false })
    }
  }
  if (subjects.alternative !== null && subjects.alternative !== subjects.primary) {
    variants.push({
      message: assemble(type, scope, subjects.alternative, body, profile),
      primary: false
    })
  }
  return { variants, weak: !profile.conventional || ambiguous }
}

/** Type from the file mix, restricted to the commitlint `type-enum` when present. */
function inferType(files: readonly StagedFile[], types: readonly string[] | null): { type: string; ambiguous: boolean } {
  const allOf = (category: Category): boolean => files.every((file) => classify(file.path) === category)
  let candidate: string
  let ambiguous = false
  if (allOf('docs')) candidate = 'docs'
  else if (allOf('test')) candidate = 'test'
  else if (allOf('ci')) candidate = 'ci'
  else if (allOf('build')) candidate = 'build'
  else if (allOf('chore')) candidate = 'chore'
  else if (allOf('style')) candidate = 'style'
  else {
    const added = files.filter((file) => file.kind === 'added').length
    const touched = files.length - added
    candidate = added > 0 && added >= touched ? 'feat' : 'fix'
    ambiguous = true
  }
  return { type: restrictType(candidate, types), ambiguous }
}

function restrictType(candidate: string, types: readonly string[] | null): string {
  if (types === null || types.length === 0 || types.includes(candidate)) return candidate
  for (const fallback of TYPE_FALLBACK_ORDER) {
    if (types.includes(fallback)) return fallback
  }
  return types[0] ?? candidate
}

/** Deepest shared directory segment of the paths, skipping generic ones. */
function inferScope(files: readonly StagedFile[], scopes: readonly string[] | null): string | null {
  const directories = files.map((file) => file.path.split('/').slice(0, -1))
  const first = directories[0] ?? []
  const common: string[] = []
  for (let index = 0; index < first.length; index += 1) {
    const segment = first[index]
    if (segment === undefined || !directories.every((dir) => dir[index] === segment)) break
    common.push(segment)
  }
  if (common.length === 0) return null
  let candidate = common[common.length - 1]
  if (candidate !== undefined && GENERIC_SCOPE_SEGMENTS.has(candidate.toLowerCase()) && common.length >= 2) {
    candidate = common[common.length - 2]
  }
  if (candidate === undefined || GENERIC_SCOPE_SEGMENTS.has(candidate.toLowerCase())) return null
  const slug = candidate
    .toLowerCase()
    .replace(/[^a-z0-9-_.]/g, '')
    .replace(/^[._-]+|[._-]+$/g, '')
  if (slug.length === 0) return null
  if (scopes === null || scopes.length === 0) return slug
  const allowed = scopes.find((scope) => scope.toLowerCase() === slug)
  return allowed ?? null
}

interface Subjects {
  primary: string
  alternative: string | null
}

function buildSubjects(files: readonly StagedFile[], scope: string | null, language: Language): Subjects {
  const verb = dominantVerb(files)
  const primaryTarget = primaryTargetOf(files, scope, language)
  const alternativeTarget = alternativeTargetOf(files, scope, language)
  return {
    primary: phrase(verb, primaryTarget, language),
    alternative: alternativeTarget === null || alternativeTarget === primaryTarget ? null : phrase(verb, alternativeTarget, language)
  }
}

function dominantVerb(files: readonly StagedFile[]): Verb {
  const added = files.filter((file) => file.kind === 'added').length
  const deleted = files.filter((file) => file.kind === 'deleted').length
  if (added > deleted && added > files.length - added - deleted) return 'add'
  if (deleted > added && deleted > files.length - added - deleted) return 'remove'
  return 'update'
}

function primaryTargetOf(files: readonly StagedFile[], scope: string | null, language: Language): string {
  const single = files.length === 1 ? files[0] : undefined
  if (single !== undefined) return humanize(basename(single.path))
  if (scope !== null) return humanize(scope)
  return countFiles(files.length, language)
}

function alternativeTargetOf(files: readonly StagedFile[], scope: string | null, language: Language): string | null {
  if (files.length === 1) {
    const single = files[0]
    if (single === undefined) return null
    const parent = parentSegment(single.path)
    if (parent !== null) return humanize(parent)
    return scope !== null ? humanize(scope) : null
  }
  const largest = files.reduce((best, file) => (churn(file) > churn(best) ? file : best))
  const name = humanize(basename(largest.path))
  return name.length > 0 ? name : countFiles(files.length, language)
}

function phrase(verb: Verb, target: string, language: Language): string {
  if (language === 'zh') return `${ZH_VERBS[verb]} ${target}`
  return `${verb} ${target}`
}

function buildBody(files: readonly StagedFile[], language: Language): string[] {
  if (files.length < 2) return []
  const groups = new Map<string, { count: number; additions: number; deletions: number }>()
  for (const file of files) {
    const segments = file.path.split('/').slice(0, -1).slice(0, 2)
    const key = segments.join('/') || (language === 'zh' ? '根目录' : '(root)')
    const group = groups.get(key) ?? { count: 0, additions: 0, deletions: 0 }
    group.count += 1
    group.additions += file.additions ?? 0
    group.deletions += file.deletions ?? 0
    groups.set(key, group)
  }
  const sorted = [...groups.entries()].sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
  const shown = sorted.slice(0, 6)
  const bullets = shown.map(([label, group]) => {
    const stats = `+${group.additions} −${group.deletions}`
    return language === 'zh'
      ? `- ${label}：${group.count} 个文件（${stats}）`
      : `- ${label}: ${group.count} ${group.count === 1 ? 'file' : 'files'} (${stats})`
  })
  const hidden = sorted.length - shown.length
  if (hidden > 0) bullets.push(language === 'zh' ? `……还有 ${hidden} 个` : `… and ${hidden} more`)
  return bullets
}

function assemble(
  type: string,
  scope: string | null,
  subject: string,
  body: readonly string[],
  profile: ConventionProfile
): string {
  let subjectLine: string
  if (profile.conventional) {
    const casing = profile.casing === 'upper' ? 'upper' : profile.casing === 'lower' ? 'lower' : 'keep'
    subjectLine = `${type}${scope !== null ? `(${scope})` : ''}: ${applyCasing(subject, casing)}`
  } else {
    subjectLine = applyCasing(subject, profile.casing === 'lower' ? 'lower' : 'upper')
  }
  return body.length === 0 ? subjectLine : `${subjectLine}\n\n${body.join('\n')}`
}

/** Applies the history's casing to the first Latin letter; `keep` leaves it as built. */
function applyCasing(text: string, mode: 'lower' | 'upper' | 'keep'): string {
  if (mode === 'keep') return text
  return text.replace(/[a-zA-Z]/, (letter) => (mode === 'upper' ? letter.toUpperCase() : letter.toLowerCase()))
}

function classify(path: string): Category | null {
  const lower = path.toLowerCase()
  const base = lower.split('/').pop() ?? lower
  if (
    /^(readme|changelog|license|contributing|authors|notice)/.test(base) ||
    /\.(md|mdx|rst|adoc)$/.test(base) ||
    lower.startsWith('docs/')
  ) {
    return 'docs'
  }
  if (/(^|\/)(test|tests|__tests__|spec|e2e)\//.test(lower) || /\.(test|spec)\.[a-z0-9]+$/.test(base)) return 'test'
  if (lower.startsWith('.github/') || lower.startsWith('.gitlab/') || lower.startsWith('.circleci/')) return 'ci'
  if (base === 'jenkinsfile' || base === 'azure-pipelines.yml') return 'ci'
  if (/^(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb|cargo\.lock|poetry\.lock|composer\.lock)$/.test(base)) {
    return 'build'
  }
  if (
    base === 'package.json' ||
    /\.config\.[a-z]+$/.test(base) ||
    /^tsconfig(\..*)?\.json$/.test(base) ||
    /^\.(gitignore|gitattributes|editorconfig|npmrc|nvmrc|prettierrc|eslintrc|stylelintrc)/.test(base) ||
    lower.startsWith('.husky/') ||
    lower.startsWith('.vscode/') ||
    base === 'dockerfile' ||
    lower.startsWith('docker-compose') ||
    base === 'pnpm-workspace.yaml'
  ) {
    return 'chore'
  }
  if (/\.(css|scss|sass|less)$/.test(base)) return 'style'
  return null
}

function churn(file: StagedFile): number {
  return (file.additions ?? 0) + (file.deletions ?? 0)
}

function basename(path: string): string {
  return path.split('/').pop() ?? path
}

function parentSegment(path: string): string | null {
  const segments = path.split('/')
  const parent = segments[segments.length - 2]
  return parent !== undefined && parent.length > 0 ? parent : null
}

function humanize(name: string): string {
  return name
    .replace(/\.[A-Za-z0-9]+$/, '')
    .replace(/[-_.]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

function countFiles(count: number, language: Language): string {
  return language === 'zh' ? `${count} 个文件` : `${count} ${count === 1 ? 'file' : 'files'}`
}

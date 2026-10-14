import type { ConventionProfile, StagedSummary } from './types'

/** Diff text handed to the model; larger patches are truncated with a marker. */
export const DEFAULT_MAX_DIFF_CHARS = 40_000

export interface PromptInput {
  summary: StagedSummary
  profile: ConventionProfile
  maxDiffChars?: number
}

export interface PromptMessages {
  system: string
  user: string
}

/** Builds the chat messages: convention profile plus the capped staged diff. */
export function buildPrompt(input: PromptInput): PromptMessages {
  const { summary, profile } = input
  const cap = input.maxDiffChars ?? DEFAULT_MAX_DIFF_CHARS

  const rules: string[] = [
    'You write Git commit messages.',
    'Reply with the commit message only: no code fences, no quotes, no explanations.'
  ]
  if (profile.conventional) {
    const types = profile.types !== null && profile.types.length > 0 ? `: ${profile.types.join(', ')}` : ''
    rules.push(`Use conventional commits — a "type(scope): subject" first line, with the type from this set${types}.`)
    if (profile.scopes !== null && profile.scopes.length > 0) {
      rules.push(`Allowed scopes: ${profile.scopes.join(', ')}. Omit the scope when no listed one fits.`)
    }
  } else {
    rules.push('No strict prefix convention was detected: write a plain descriptive subject line.')
  }
  const language = profile.language === 'zh' ? 'Chinese' : profile.language === 'en' ? 'English' : 'the language of the change-set'
  rules.push(`Write the subject line in ${language}.`)
  if (profile.averageLength !== null) {
    rules.push(`Keep the subject line near ${String(Math.min(profile.averageLength, 72))} characters.`)
  } else {
    rules.push('Keep the subject line under 72 characters.')
  }
  if (profile.casing === 'lower') rules.push('Start the subject with a lowercase letter.')
  if (profile.casing === 'upper') rules.push('Start the subject with a capital letter.')
  rules.push('Add a short body with bullet points only when the change touches several files or areas.')

  const stats = summary.files.map((file) => {
    const churn = file.additions === null ? 'binary' : `+${String(file.additions)} −${String(file.deletions ?? 0)}`
    return `${file.kind} ${file.path}${file.origPath !== undefined ? ` (from ${file.origPath})` : ''} ${churn}`
  })

  const patch =
    summary.patch.length > cap
      ? `${summary.patch.slice(0, cap)}\n… (diff truncated)`
      : summary.patch

  const user = [
    'Staged files:',
    stats.join('\n'),
    '',
    'Staged diff:',
    patch.length > 0 ? patch : '(no textual diff)'
  ].join('\n')

  return { system: rules.join('\n'), user }
}

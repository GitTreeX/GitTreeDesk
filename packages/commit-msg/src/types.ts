export type { StagedFile, StagedSummary } from '@gitreedesk/shared'

export type SubjectLanguage = 'en' | 'zh' | 'unknown'

export type ConventionSource = 'commitlint' | 'template' | 'subjects'

/** The repository's commit-message habits, inferred from configuration and history. */
export interface ConventionProfile {
  conventional: boolean
  /** Allowed commit types from a commitlint `type-enum` rule; `null` when unknown. */
  types: readonly string[] | null
  /** Allowed scopes from a commitlint `scope-enum` rule; `null` when unknown. */
  scopes: readonly string[] | null
  language: SubjectLanguage
  casing: 'lower' | 'upper' | 'unknown'
  /** Average subject length of the sampled history; `null` without history. */
  averageLength: number | null
  sources: readonly ConventionSource[]
}

/** One draft variant; `primary` marks the generator's best guess. */
export interface DraftVariant {
  message: string
  primary: boolean
}

export interface DraftResult {
  variants: readonly DraftVariant[]
  /** True when the draft is a guess: no convention detected or an ambiguous type. */
  weak: boolean
}

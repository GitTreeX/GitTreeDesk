import type { ChangeKind } from '@gitreedesk/shared'

/** One staged file with its churn stats; binary files carry `null` counts. */
export interface StagedFile {
  path: string
  origPath?: string
  kind: ChangeKind
  additions: number | null
  deletions: number | null
}

/** The staged change-set the generators describe. */
export interface StagedSummary {
  files: readonly StagedFile[]
  /** Unified diff of the staged changes, already byte-capped by the producer. */
  patch: string
  patchTruncated: boolean
}

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

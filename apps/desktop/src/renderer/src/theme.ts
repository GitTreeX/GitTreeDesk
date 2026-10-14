import { ACCENT_VALUES, DENSITY_VALUES, type AccentValue, type DensityValue } from '@gitreedesk/shared'

export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

const PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark']

export function normalizeTheme(value: unknown): ThemePreference {
  return typeof value === 'string' && (PREFERENCES as readonly string[]).includes(value)
    ? (value as ThemePreference)
    : 'system'
}

export function normalizeDensity(value: unknown): DensityValue {
  return typeof value === 'string' && (DENSITY_VALUES as readonly string[]).includes(value)
    ? (value as DensityValue)
    : 'comfortable'
}

export function normalizeAccent(value: unknown): AccentValue {
  return typeof value === 'string' && (ACCENT_VALUES as readonly string[]).includes(value)
    ? (value as AccentValue)
    : 'blue'
}

/** List row height in pixels per density (spec: 22 compact / 28 comfortable). */
export function rowHeightFor(density: DensityValue): number {
  return density === 'compact' ? 22 : 28
}

export function resolveTheme(preference: ThemePreference, prefersDark: boolean): ResolvedTheme {
  if (preference === 'system') return prefersDark ? 'dark' : 'light'
  return preference
}

/** Cycles system → light → dark → system. */
export function nextTheme(preference: ThemePreference): ThemePreference {
  const index = PREFERENCES.indexOf(preference)
  return PREFERENCES[(index + 1) % PREFERENCES.length] ?? 'system'
}

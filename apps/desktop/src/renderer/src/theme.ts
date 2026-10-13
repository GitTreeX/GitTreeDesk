export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

const PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark']

export function normalizeTheme(value: unknown): ThemePreference {
  return typeof value === 'string' && (PREFERENCES as readonly string[]).includes(value)
    ? (value as ThemePreference)
    : 'system'
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

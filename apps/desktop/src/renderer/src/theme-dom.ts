import { resolveTheme, type ThemePreference } from './theme'

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')

export function applyThemePreference(preference: ThemePreference): void {
  document.documentElement.classList.toggle('dark', resolveTheme(preference, darkQuery.matches) === 'dark')
}

/** Re-applies the theme when the OS switches while `system` is selected. */
export function watchSystemTheme(preference: ThemePreference, apply: () => void): () => void {
  if (preference !== 'system') return () => undefined
  const listener = (): void => apply()
  darkQuery.addEventListener('change', listener)
  return () => darkQuery.removeEventListener('change', listener)
}

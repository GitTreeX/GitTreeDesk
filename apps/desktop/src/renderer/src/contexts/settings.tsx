import { createContext, useCallback, useContext, useEffect, useMemo, useState, type JSX, type ReactNode } from 'react'
import { api } from '../api'
import { i18n, normalizeLocale } from '../i18n'
import { normalizeTheme, type ThemePreference } from '../theme'
import { applyThemePreference, watchSystemTheme } from '../theme-dom'

export interface InitialSettings {
  theme: ThemePreference
  locale: string
}

interface SettingsContextValue {
  theme: ThemePreference
  locale: string
  setTheme: (theme: ThemePreference) => Promise<void>
  setLocale: (locale: string) => Promise<void>
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

const THEME_KEY = ['appearance', 'theme']
const LOCALE_KEY = ['locale']

export function SettingsProvider({
  initial,
  children
}: {
  initial: InitialSettings
  children: ReactNode
}): JSX.Element {
  const [theme, setThemeState] = useState<ThemePreference>(initial.theme)
  const [locale, setLocaleState] = useState<string>(initial.locale)

  useEffect(() => {
    applyThemePreference(theme)
    return watchSystemTheme(theme, () => applyThemePreference(theme))
  }, [theme])

  useEffect(() => {
    void i18n.changeLanguage(locale)
    document.documentElement.lang = locale
  }, [locale])

  // External edits (settings.json on disk) re-resolve the effective values.
  useEffect(() => {
    return api.on('settings:changed', (change) => {
      const key = change.keyPath.join('.')
      if (key === THEME_KEY.join('.')) {
        void api.invoke('settings:getEffective', { keyPath: THEME_KEY }).then(
          ({ value }) => setThemeState(normalizeTheme(value)),
          () => undefined
        )
      } else if (key === LOCALE_KEY.join('.')) {
        void api.invoke('settings:getEffective', { keyPath: LOCALE_KEY }).then(
          ({ value }) => setLocaleState(normalizeLocale(value)),
          () => undefined
        )
      }
    })
  }, [])

  const setTheme = useCallback(async (next: ThemePreference) => {
    setThemeState(next)
    await api.invoke('settings:set', { scope: 'user', keyPath: THEME_KEY, value: next })
  }, [])

  const setLocale = useCallback(async (next: string) => {
    setLocaleState(next)
    await api.invoke('settings:set', { scope: 'user', keyPath: LOCALE_KEY, value: next })
  }, [])

  const value = useMemo(
    () => ({ theme, locale, setTheme, setLocale }),
    [theme, locale, setTheme, setLocale]
  )

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext)
  if (value === null) throw new Error('useSettings requires a SettingsProvider')
  return value
}

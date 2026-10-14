import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { api } from './api'
import type { InitialSettings } from './contexts/settings'
import { initI18n, normalizeLocale } from './i18n'
import { normalizeAccent, normalizeDensity, normalizeTheme } from './theme'
import { applyAccentPreference, applyThemePreference } from './theme-dom'
import './styles/index.css'

async function loadInitialSettings(): Promise<InitialSettings> {
  try {
    const [theme, locale, density, accent] = await Promise.all([
      api.invoke('settings:getEffective', { keyPath: ['appearance', 'theme'] }),
      api.invoke('settings:getEffective', { keyPath: ['locale'] }),
      api.invoke('settings:getEffective', { keyPath: ['appearance', 'density'] }),
      api.invoke('settings:getEffective', { keyPath: ['appearance', 'accent'] })
    ])
    return {
      theme: normalizeTheme(theme.value),
      locale: normalizeLocale(locale.value),
      density: normalizeDensity(density.value),
      accent: normalizeAccent(accent.value)
    }
  } catch {
    return { theme: 'system', locale: 'en', density: 'comfortable', accent: 'blue' }
  }
}

async function bootstrap(): Promise<void> {
  const container = document.getElementById('root')
  if (container === null) throw new Error('Root container is missing')

  const initialSettings = await loadInitialSettings()
  applyThemePreference(initialSettings.theme)
  applyAccentPreference(initialSettings.accent)
  initI18n(initialSettings.locale)

  createRoot(container).render(
    <StrictMode>
      <App initialSettings={initialSettings} />
    </StrictMode>
  )
}

void bootstrap()

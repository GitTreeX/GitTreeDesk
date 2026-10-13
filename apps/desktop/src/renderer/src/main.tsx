import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { api } from './api'
import { initI18n, normalizeLocale } from './i18n'
import { normalizeTheme, type ThemePreference } from './theme'
import { applyThemePreference } from './theme-dom'
import './styles/index.css'

async function loadInitialSettings(): Promise<{ theme: ThemePreference; locale: string }> {
  try {
    const [theme, locale] = await Promise.all([
      api.invoke('settings:getEffective', { keyPath: ['appearance', 'theme'] }),
      api.invoke('settings:getEffective', { keyPath: ['locale'] })
    ])
    return { theme: normalizeTheme(theme.value), locale: normalizeLocale(locale.value) }
  } catch {
    return { theme: 'system', locale: 'en' }
  }
}

async function bootstrap(): Promise<void> {
  const container = document.getElementById('root')
  if (container === null) throw new Error('Root container is missing')

  const initialSettings = await loadInitialSettings()
  applyThemePreference(initialSettings.theme)
  initI18n(initialSettings.locale)

  createRoot(container).render(
    <StrictMode>
      <App initialSettings={initialSettings} />
    </StrictMode>
  )
}

void bootstrap()

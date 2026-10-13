import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { enResource, type TranslationResource } from './locales/en'
import { zhHansResource } from './locales/zh-Hans'
import { pseudoLocalizeTree } from './locales/pseudo'

export const SUPPORTED_LOCALES = ['en', 'zh-Hans'] as const
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]

/** Pseudo-locale for spot-checking translation coverage; development builds only. */
export const PSEUDO_LOCALE = 'en-XA'

export function normalizeLocale(value: unknown): string {
  if (typeof value !== 'string') return 'en'
  const lower = value.toLowerCase()
  if (lower.startsWith('zh')) return 'zh-Hans'
  if (lower === PSEUDO_LOCALE.toLowerCase() && import.meta.env.DEV) return PSEUDO_LOCALE
  return 'en'
}

export function initI18n(locale: string): void {
  const resources: Record<string, { translation: TranslationResource }> = {
    en: { translation: enResource },
    'zh-Hans': { translation: zhHansResource }
  }
  if (import.meta.env.DEV) {
    resources[PSEUDO_LOCALE] = { translation: pseudoLocalizeTree(enResource) }
  }

  void i18n.use(initReactI18next).init({
    resources,
    lng: locale,
    fallbackLng: 'en',
    interpolation: { escapeValue: false }
  })
}

export { i18n }

import { useEffect, useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppInfo } from '@gitreedesk/shared'
import { api } from '../api'
import { useSettings } from '../contexts/settings'
import { useWorkspace } from '../contexts/workspace'
import { nextTheme, type ThemePreference } from '../theme'
import { AlertTriangleIcon, GlobeIcon, MonitorIcon, MoonIcon, SunIcon } from './icons'

const THEME_ICONS: Record<ThemePreference, typeof SunIcon> = {
  system: MonitorIcon,
  light: SunIcon,
  dark: MoonIcon
}

export function StatusBar(): JSX.Element {
  const { t } = useTranslation()
  const settings = useSettings()
  const workspace = useWorkspace()
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)

  useEffect(() => {
    let live = true
    void api.invoke('app:info').then(
      (info) => {
        if (live) setAppInfo(info)
      },
      () => undefined
    )
    return () => {
      live = false
    }
  }, [])

  const ThemeIcon = THEME_ICONS[settings.theme]
  const themeLabel = t(
    settings.theme === 'system'
      ? 'statusbar.themeSystem'
      : settings.theme === 'light'
        ? 'statusbar.themeLight'
        : 'statusbar.themeDark'
  )
  const languageLabel = settings.locale === 'en' ? 'English' : '中文'

  const gitVersion = appInfo?.gitVersion ?? null
  const gitText =
    gitVersion === null ? t('statusbar.gitMissing') : gitVersion.raw.replace(/^git version /, '')
  const gitTitle =
    gitVersion === null
      ? t('statusbar.gitMissing')
      : gitVersion.supported && !gitVersion.warn
        ? gitVersion.raw
        : t('statusbar.gitOutdated')

  const workspaceName =
    workspace.descriptor?.config.name ?? workspace.descriptor?.root.split('/').pop() ?? null

  return (
    <footer className="flex h-6 shrink-0 items-center justify-between gap-3 border-t border-line bg-panel px-2 text-xs text-muted">
      <div className="flex min-w-0 items-center gap-3">
        {workspaceName !== null && <span className="truncate text-ink">{workspaceName}</span>}
        {workspace.opening ? (
          <span>{t('statusbar.opening')}</span>
        ) : workspace.refreshing ? (
          <span>{t('statusbar.refreshing')}</span>
        ) : null}
        {workspace.lastError !== null && (
          <button
            type="button"
            className="flex min-w-0 items-center gap-1 text-danger hover:underline"
            title={workspace.lastError}
            onClick={() => workspace.clearError()}
          >
            <AlertTriangleIcon className="size-3.5 shrink-0" />
            <span className="truncate">{workspace.lastError}</span>
          </button>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {workspace.degraded.length > 0 && (
          <span
            className="flex items-center gap-1 px-1 text-warn"
            title={workspace.degraded.map((entry) => entry.dir).join('\n')}
          >
            <AlertTriangleIcon className="size-3.5" />
            {t('statusbar.degraded')}
          </span>
        )}
        <button
          type="button"
          className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-ink/5 hover:text-ink"
          title={t('statusbar.theme', { theme: themeLabel })}
          onClick={() => void settings.setTheme(nextTheme(settings.theme))}
        >
          <ThemeIcon className="size-3.5" />
          {themeLabel}
        </button>
        <button
          type="button"
          className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-ink/5 hover:text-ink"
          title={t('statusbar.language', { language: languageLabel })}
          onClick={() => void settings.setLocale(settings.locale === 'en' ? 'zh-Hans' : 'en')}
        >
          <GlobeIcon className="size-3.5" />
          {languageLabel}
        </button>
        <span className={gitVersion !== null && !gitVersion.supported ? 'text-danger' : ''} title={gitTitle}>
          {gitText}
        </span>
      </div>
    </footer>
  )
}

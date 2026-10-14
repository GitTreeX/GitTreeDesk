import type { TerminalResolutionInfo, TerminalSessionInfo } from '@gitreedesk/shared'

/** Scrollback lines when no setting overrides them. */
export const DEFAULT_SCROLLBACK = 5_000
const MAX_SCROLLBACK = 200_000

export const DEFAULT_PANEL_HEIGHT = 240
export const MIN_PANEL_HEIGHT = 120
export const MAX_PANEL_HEIGHT = 800

/** Short tab label: the quick command name, else the last segment of the cwd. */
export function sessionLabel(session: TerminalSessionInfo): string {
  if (session.quickName !== null) return session.quickName
  const trimmed = session.cwd.replace(/\/+$/, '')
  const name = trimmed.slice(trimmed.lastIndexOf('/') + 1)
  return name.length > 0 ? name : trimmed
}

/** The profile a plain `+` starts: the settings default when present, else the first. */
export function defaultProfileId(info: TerminalResolutionInfo): string | null {
  const preferred = info.profiles.find((profile) => profile.id === info.defaultProfile)
  return (preferred ?? info.profiles[0])?.id ?? null
}

export function normalizeScrollback(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return DEFAULT_SCROLLBACK
  return Math.min(MAX_SCROLLBACK, Math.floor(value))
}

export function sanitizePanelHeight(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return clampPanelHeight(Math.round(value))
}

export function clampPanelHeight(value: number): number {
  return Math.min(MAX_PANEL_HEIGHT, Math.max(MIN_PANEL_HEIGHT, value))
}

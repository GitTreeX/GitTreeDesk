import { describe, expect, it } from 'vitest'
import type { TerminalProfileInfo, TerminalResolutionInfo, TerminalSessionInfo } from '@gitreedesk/shared'
import {
  DEFAULT_PANEL_HEIGHT,
  DEFAULT_SCROLLBACK,
  clampPanelHeight,
  defaultProfileId,
  normalizeScrollback,
  sanitizePanelHeight,
  sessionLabel
} from '../src/renderer/src/lib/terminal'

function session(overrides: Partial<TerminalSessionInfo>): TerminalSessionInfo {
  return {
    id: 's1',
    cwd: 'C:/work/app',
    profileId: 'pwsh',
    profileName: 'PowerShell',
    icon: null,
    color: null,
    quickName: null,
    running: true,
    exitCode: null,
    ...overrides
  }
}

function profile(id: string): TerminalProfileInfo {
  return {
    id,
    name: id,
    shell: id,
    args: [],
    env: {},
    cwd: null,
    icon: null,
    color: null,
    origin: 'detected'
  }
}

function resolution(overrides: Partial<TerminalResolutionInfo>): TerminalResolutionInfo {
  return {
    dir: 'C:/work/app',
    defaultProfile: null,
    profiles: [profile('pwsh'), profile('cmd')],
    quickCommands: [],
    ...overrides
  }
}

describe('sessionLabel', () => {
  it('prefers the quick command name', () => {
    expect(sessionLabel(session({ quickName: 'pnpm dev' }))).toBe('pnpm dev')
  })

  it('falls back to the last cwd segment', () => {
    expect(sessionLabel(session({ cwd: 'C:/work/app' }))).toBe('app')
  })

  it('ignores trailing slashes on the cwd', () => {
    expect(sessionLabel(session({ cwd: 'C:/work/app/' }))).toBe('app')
  })
})

describe('defaultProfileId', () => {
  it('uses the named default profile when it exists', () => {
    expect(defaultProfileId(resolution({ defaultProfile: 'cmd' }))).toBe('cmd')
  })

  it('falls back to the first profile when the default is unknown or absent', () => {
    expect(defaultProfileId(resolution({ defaultProfile: 'nope' }))).toBe('pwsh')
    expect(defaultProfileId(resolution({}))).toBe('pwsh')
  })

  it('returns null without profiles', () => {
    expect(defaultProfileId(resolution({ profiles: [] }))).toBeNull()
  })
})

describe('normalizeScrollback', () => {
  it('keeps valid numbers and floors them', () => {
    expect(normalizeScrollback(1200.7)).toBe(1200)
  })

  it('falls back to the default for missing or invalid values', () => {
    expect(normalizeScrollback(undefined)).toBe(DEFAULT_SCROLLBACK)
    expect(normalizeScrollback('many')).toBe(DEFAULT_SCROLLBACK)
    expect(normalizeScrollback(-1)).toBe(DEFAULT_SCROLLBACK)
    expect(normalizeScrollback(Number.NaN)).toBe(DEFAULT_SCROLLBACK)
    expect(normalizeScrollback(Number.POSITIVE_INFINITY)).toBe(DEFAULT_SCROLLBACK)
  })

  it('caps huge values', () => {
    expect(normalizeScrollback(1_000_000)).toBe(200_000)
  })
})

describe('clampPanelHeight', () => {
  it('keeps in-range values and clamps outliers', () => {
    expect(clampPanelHeight(DEFAULT_PANEL_HEIGHT)).toBe(DEFAULT_PANEL_HEIGHT)
    expect(clampPanelHeight(10)).toBe(120)
    expect(clampPanelHeight(10_000)).toBe(800)
  })
})

describe('sanitizePanelHeight', () => {
  it('rounds stored numbers', () => {
    expect(sanitizePanelHeight(300.6)).toBe(301)
  })

  it('rejects non-numbers so the default applies', () => {
    expect(sanitizePanelHeight('tall')).toBeNull()
    expect(sanitizePanelHeight(Number.NaN)).toBeNull()
    expect(sanitizePanelHeight(null)).toBeNull()
  })
})

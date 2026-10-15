import { describe, expect, it } from 'vitest'
import {
  ACCENT_VALUES,
  DENSITY_VALUES,
  GRAPH_DENSITY_VALUES,
  LOG_LEVEL_VALUES,
  SETTINGS_SURFACE,
  THEME_VALUES,
  findSettingDescriptor,
  isSettingValueUsable,
  sanitizeSettingValue,
  settingDefault,
  settingDescriptorsFor
} from '../src/settings-surface'

describe('SETTINGS_SURFACE', () => {
  it('keys every descriptor uniquely and resolves them by key path', () => {
    const ids = SETTINGS_SURFACE.map((descriptor) => descriptor.keyPath.join('.'))
    expect(new Set(ids).size).toBe(ids.length)
    for (const descriptor of SETTINGS_SURFACE) {
      expect(findSettingDescriptor(descriptor.keyPath)).toBe(descriptor)
    }
    expect(findSettingDescriptor(['not', 'a', 'key'])).toBeNull()
  })

  it('keeps defaults inside the declared bounds', () => {
    for (const descriptor of SETTINGS_SURFACE) {
      if (descriptor.type === 'number') {
        expect(descriptor.default).toBeGreaterThanOrEqual(descriptor.min)
        expect(descriptor.default).toBeLessThanOrEqual(descriptor.max)
      }
      if (descriptor.type === 'enum') {
        expect(descriptor.options).toContain(descriptor.default)
      }
    }
  })

  it('groups descriptors for rendering and exposes defaults by key path', () => {
    expect(settingDescriptorsFor('appearance').map((descriptor) => descriptor.keyPath.join('.'))).toEqual([
      'appearance.theme',
      'appearance.density',
      'appearance.graphDensity',
      'appearance.accent',
      'locale'
    ])
    expect(settingDefault(['density'])).toBeUndefined()
    expect(settingDefault(['appearance', 'density'])).toBe('comfortable')
    expect(settingDefault(['appearance', 'graphDensity'])).toBe('normal')
    expect(settingDefault(['git', 'pollIntervalSec'])).toBe(60)
  })

  it('publishes the visual preset value lists', () => {
    expect(THEME_VALUES).toEqual(['system', 'light', 'dark'])
    expect(DENSITY_VALUES).toEqual(['comfortable', 'compact'])
    expect(GRAPH_DENSITY_VALUES).toEqual(['compact', 'normal', 'comfortable'])
    expect(ACCENT_VALUES).toEqual(['blue', 'green', 'violet', 'amber', 'rose'])
    expect(LOG_LEVEL_VALUES).toEqual(['error', 'warn', 'info', 'debug'])
  })
})

describe('sanitizeSettingValue', () => {
  const accent = findSettingDescriptor(['appearance', 'accent'])
  const fontSize = findSettingDescriptor(['editor', 'fontSize'])
  const insertSpaces = findSettingDescriptor(['editor', 'insertSpaces'])
  const gitPath = findSettingDescriptor(['git', 'path'])
  const temperature = findSettingDescriptor(['commitMessage', 'temperature'])

  it('accepts only declared enum members', () => {
    expect(accent).not.toBeNull()
    expect(sanitizeSettingValue(accent!, 'rose')).toBe('rose')
    expect(sanitizeSettingValue(accent!, 'pink')).toBeUndefined()
    expect(sanitizeSettingValue(accent!, 3)).toBeUndefined()
  })

  it('clamps and rounds numeric values', () => {
    expect(fontSize).not.toBeNull()
    expect(sanitizeSettingValue(fontSize!, 100)).toBe(32)
    expect(sanitizeSettingValue(fontSize!, 2)).toBe(8)
    expect(sanitizeSettingValue(fontSize!, 14.6)).toBe(15)
    expect(sanitizeSettingValue(fontSize!, Number.NaN)).toBeUndefined()
    expect(sanitizeSettingValue(fontSize!, '14')).toBeUndefined()
    expect(temperature).not.toBeNull()
    expect(sanitizeSettingValue(temperature!, 1.75)).toBe(1.75)
  })

  it('keeps booleans and rejects everything else', () => {
    expect(insertSpaces).not.toBeNull()
    expect(sanitizeSettingValue(insertSpaces!, false)).toBe(false)
    expect(sanitizeSettingValue(insertSpaces!, 'false')).toBeUndefined()
    expect(sanitizeSettingValue(insertSpaces!, 0)).toBeUndefined()
  })

  it('normalizes nullable strings', () => {
    expect(gitPath).not.toBeNull()
    expect(sanitizeSettingValue(gitPath!, 'C:\\tools\\git.exe')).toBe('C:\\tools\\git.exe')
    expect(sanitizeSettingValue(gitPath!, '')).toBeNull()
    expect(sanitizeSettingValue(gitPath!, null)).toBeNull()
    expect(sanitizeSettingValue(gitPath!, 7)).toBeUndefined()
  })

  it('flags usable values and rejects values that sanitizing would change', () => {
    expect(isSettingValueUsable(accent!, 'blue')).toBe(true)
    expect(isSettingValueUsable(accent!, 'pink')).toBe(false)
    expect(isSettingValueUsable(fontSize!, 14)).toBe(true)
    expect(isSettingValueUsable(fontSize!, 100)).toBe(false)
    expect(isSettingValueUsable(gitPath!, undefined)).toBe(false)
    expect(isSettingValueUsable(gitPath!, null)).toBe(true)
  })
})

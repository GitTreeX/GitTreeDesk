import { describe, expect, it } from 'vitest'
import {
  nextTheme,
  normalizeGraphCurve,
  normalizeTheme,
  resolveTheme
} from '../src/renderer/src/theme'

describe('resolveTheme', () => {
  it('follows the system when set to system', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })

  it('honors explicit preferences regardless of the system', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })
})

describe('nextTheme', () => {
  it('cycles system → light → dark → system', () => {
    expect(nextTheme('system')).toBe('light')
    expect(nextTheme('light')).toBe('dark')
    expect(nextTheme('dark')).toBe('system')
  })
})

describe('normalizeTheme', () => {
  it('accepts known values and falls back to system', () => {
    expect(normalizeTheme('dark')).toBe('dark')
    expect(normalizeTheme('light')).toBe('light')
    expect(normalizeTheme('system')).toBe('system')
    expect(normalizeTheme('solarized')).toBe('system')
    expect(normalizeTheme(undefined)).toBe('system')
  })
})

describe('normalizeGraphCurve', () => {
  it('accepts known values and rejects everything else', () => {
    expect(normalizeGraphCurve('smooth')).toBe('smooth')
    expect(normalizeGraphCurve('straight')).toBe('straight')
    expect(normalizeGraphCurve('wavy')).toBeNull()
    expect(normalizeGraphCurve(undefined)).toBeNull()
  })
})

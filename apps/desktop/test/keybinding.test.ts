import { describe, expect, it } from 'vitest'
import {
  formatAccelerator,
  isEditableTarget,
  matchesAccelerator,
  parseAccelerator,
  type KeyEventLike
} from '../src/renderer/src/commands/keybinding'
import { buildBindings } from '../src/renderer/src/commands/defaults'

function event(partial: Partial<KeyEventLike> & { key: string }): KeyEventLike {
  return {
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...partial
  }
}

describe('parseAccelerator', () => {
  it('parses modifiers and normalizes the key', () => {
    expect(parseAccelerator('Mod+Shift+P')).toEqual({
      key: 'p',
      mod: true,
      ctrl: false,
      meta: false,
      shift: true,
      alt: false
    })
    expect(parseAccelerator('mod+shift+p')).toEqual(parseAccelerator('Mod+Shift+P'))
  })

  it('accepts aliases and symbolic keys', () => {
    expect(parseAccelerator('Esc')?.key).toBe('escape')
    expect(parseAccelerator('Up')?.key).toBe('arrowup')
    expect(parseAccelerator('Ctrl+`')?.key).toBe('`')
    expect(parseAccelerator('Space')?.key).toBe('space')
    expect(parseAccelerator('Cmd+Alt+Left')?.meta).toBe(true)
  })

  it('rejects malformed accelerators', () => {
    expect(parseAccelerator('')).toBeNull()
    expect(parseAccelerator('Shift')).toBeNull()
    expect(parseAccelerator('Foo+P')).toBeNull()
  })
})

describe('matchesAccelerator', () => {
  const palette = parseAccelerator('Mod+Shift+P')
  const esc = parseAccelerator('Escape')

  it('treats Mod as Ctrl on Windows and Linux', () => {
    const onWindows = event({ key: 'P', ctrlKey: true, shiftKey: true })
    expect(palette !== null && matchesAccelerator(onWindows, palette, 'win32')).toBe(true)
    const withoutShift = event({ key: 'P', ctrlKey: true })
    expect(palette !== null && matchesAccelerator(withoutShift, palette, 'win32')).toBe(false)
  })

  it('treats Mod as Cmd on macOS and rejects Ctrl there', () => {
    const withCmd = event({ key: 'P', metaKey: true, shiftKey: true })
    expect(palette !== null && matchesAccelerator(withCmd, palette, 'darwin')).toBe(true)
    const withCtrl = event({ key: 'P', ctrlKey: true, shiftKey: true })
    expect(palette !== null && matchesAccelerator(withCtrl, palette, 'darwin')).toBe(false)
  })

  it('requires an exact modifier match', () => {
    const extra = event({ key: 'P', ctrlKey: true, shiftKey: true, altKey: true })
    expect(palette !== null && matchesAccelerator(extra, palette, 'win32')).toBe(false)
  })

  it('matches named keys case-insensitively', () => {
    expect(esc !== null && matchesAccelerator(event({ key: 'Escape' }), esc, 'win32')).toBe(true)
    expect(esc !== null && matchesAccelerator(event({ key: 'Esc' }), esc, 'win32')).toBe(true)
    const up = parseAccelerator('Alt+Up')
    expect(up !== null && matchesAccelerator(event({ key: 'ArrowUp', altKey: true }), up, 'win32')).toBe(true)
  })
})

describe('formatAccelerator', () => {
  it('formats per platform', () => {
    const palette = parseAccelerator('Mod+Shift+P')
    expect(palette !== null && formatAccelerator(palette, 'win32')).toBe('Ctrl+Shift+P')
    expect(palette !== null && formatAccelerator(palette, 'darwin')).toBe('⇧⌘P')
  })

  it('uses friendly names for named keys', () => {
    const escape = parseAccelerator('Escape')
    expect(escape !== null && formatAccelerator(escape, 'win32')).toBe('Esc')
    const up = parseAccelerator('Alt+Up')
    expect(up !== null && formatAccelerator(up, 'win32')).toBe('Alt+↑')
  })
})

describe('isEditableTarget', () => {
  it('detects text-entry targets', () => {
    expect(isEditableTarget({ tagName: 'INPUT' })).toBe(true)
    expect(isEditableTarget({ tagName: 'TEXTAREA' })).toBe(true)
    expect(isEditableTarget({ tagName: 'select' })).toBe(true)
    expect(isEditableTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true)
    expect(isEditableTarget({ tagName: 'BUTTON' })).toBe(false)
    expect(isEditableTarget(null)).toBe(false)
  })
})

describe('buildBindings', () => {
  it('resolves defaults with display strings', () => {
    const resolved = buildBindings('win32')
    const palette = resolved.find((binding) => binding.command === 'view.commandPalette')
    expect(palette?.display).toBe('Ctrl+Shift+P')
    expect(palette?.allowInInput).toBe(true)
    expect(resolved.find((binding) => binding.command === 'view.dismiss')?.display).toBe('Esc')
  })

  it('skips malformed entries', () => {
    const resolved = buildBindings('win32', [
      { command: 'a', keys: 'Nope+Nope+X2' },
      { command: 'b', keys: 'Ctrl+K' }
    ])
    expect(resolved.map((binding) => binding.command)).toEqual(['b'])
  })
})

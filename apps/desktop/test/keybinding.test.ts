import { describe, expect, it } from 'vitest'
import {
  acceleratorFromEvent,
  formatAccelerator,
  isEditableTarget,
  matchesAccelerator,
  parseAccelerator,
  type KeyEventLike
} from '../src/renderer/src/commands/keybinding'
import {
  buildBindings,
  DEFAULT_BINDINGS,
  KeyBindingService,
  mergeBindings
} from '../src/renderer/src/commands/defaults'
import { CommandRegistry } from '../src/renderer/src/commands/registry'

function event(partial: Partial<KeyEventLike> & { key: string }): KeyEventLike {
  return {
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...partial
  }
}

function bindingService(
  overrides: Readonly<Record<string, string | null>> = {},
  platform = 'win32'
): KeyBindingService {
  return new KeyBindingService(
    new CommandRegistry(),
    platform,
    buildBindings(platform, mergeBindings(DEFAULT_BINDINGS, overrides))
  )
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

describe('acceleratorFromEvent', () => {
  it('captures modifiers in a stable order', () => {
    expect(
      acceleratorFromEvent(event({ key: 'k', ctrlKey: true, altKey: true, shiftKey: true }), 'win32')
    ).toBe('Ctrl+Alt+Shift+K')
    expect(acceleratorFromEvent(event({ key: 'p', ctrlKey: true, shiftKey: true }), 'win32')).toBe(
      'Ctrl+Shift+P'
    )
  })

  it('uses storage spellings for named keys that parse back', () => {
    const captured = acceleratorFromEvent(event({ key: 'ArrowLeft', altKey: true }), 'win32')
    expect(captured).toBe('Alt+ArrowLeft')
    expect(captured !== null ? parseAccelerator(captured) : null).toEqual(parseAccelerator('Alt+Left'))
  })

  it('normalizes letter and named key spellings', () => {
    expect(acceleratorFromEvent(event({ key: 's' }), 'win32')).toBe('S')
    expect(acceleratorFromEvent(event({ key: 'f2' }), 'win32')).toBe('F2')
    expect(acceleratorFromEvent(event({ key: ' ' }), 'win32')).toBe('Space')
    expect(acceleratorFromEvent(event({ key: 'Delete' }), 'win32')).toBe('Delete')
  })

  it('maps the primary modifier per platform', () => {
    expect(acceleratorFromEvent(event({ key: 'k', metaKey: true }), 'darwin')).toBe('Cmd+K')
    expect(acceleratorFromEvent(event({ key: 'k', metaKey: true }), 'win32')).toBe('Win+K')
  })

  it('returns null while only modifiers or nothing are held', () => {
    expect(acceleratorFromEvent(event({ key: 'Control', ctrlKey: true }), 'win32')).toBeNull()
    expect(acceleratorFromEvent(event({ key: 'Shift', shiftKey: true }), 'win32')).toBeNull()
    expect(acceleratorFromEvent(event({ key: 'Unidentified' }), 'win32')).toBeNull()
    expect(acceleratorFromEvent(event({ key: '' }), 'win32')).toBeNull()
  })
})

describe('mergeBindings', () => {
  it('replaces keys while keeping other fields', () => {
    const merged = mergeBindings(DEFAULT_BINDINGS, { 'editor.quickOpen': 'Mod+Alt+K' })
    const quickOpen = merged.find((binding) => binding.command === 'editor.quickOpen')
    expect(quickOpen?.keys).toBe('Mod+Alt+K')
    expect(quickOpen?.allowInInput).toBe(true)
  })

  it('removes entries unbound with null', () => {
    const merged = mergeBindings(DEFAULT_BINDINGS, { 'editor.save': null })
    expect(merged.some((binding) => binding.command === 'editor.save')).toBe(false)
  })

  it('keeps default order for untouched commands', () => {
    const merged = mergeBindings(DEFAULT_BINDINGS, { 'editor.save': null })
    expect(merged.map((binding) => binding.command)).toEqual(
      DEFAULT_BINDINGS.filter((binding) => binding.command !== 'editor.save').map(
        (binding) => binding.command
      )
    )
  })

  it('sorts overridden commands first', () => {
    const merged = mergeBindings(DEFAULT_BINDINGS, { 'explorer.delete': 'Ctrl+D' })
    expect(merged[0]?.command).toBe('explorer.delete')
  })

  it('puts override-only commands ahead of the defaults', () => {
    const merged = mergeBindings(DEFAULT_BINDINGS, { 'custom.wave': 'Ctrl+Alt+Y' })
    expect(merged[0]?.command).toBe('custom.wave')
    expect(merged.slice(1).map((binding) => binding.command)).toEqual(
      DEFAULT_BINDINGS.map((binding) => binding.command)
    )
  })

  it('keeps malformed override text for buildBindings to drop', () => {
    const merged = mergeBindings(DEFAULT_BINDINGS, { 'editor.save': 'Nope+Nope+X2' })
    expect(merged.find((binding) => binding.command === 'editor.save')?.keys).toBe('Nope+Nope+X2')
    const resolved = buildBindings('win32', merged)
    expect(resolved.some((binding) => binding.command === 'editor.save')).toBe(false)
    expect(resolved.length).toBe(DEFAULT_BINDINGS.length - 1)
  })
})

describe('findConflict', () => {
  it('reports the other command that owns the pressed combo', () => {
    const service = bindingService()
    const conflict = service.findConflict(
      event({ key: 'P', ctrlKey: true, shiftKey: true }),
      'editor.quickOpen'
    )
    expect(conflict?.command).toBe('view.commandPalette')
  })

  it("ignores the command's own binding", () => {
    const service = bindingService()
    expect(
      service.findConflict(event({ key: 'P', ctrlKey: true, shiftKey: true }), 'view.commandPalette')
    ).toBeNull()
  })

  it('stops claiming a combo for commands unbound with null', () => {
    const service = bindingService({ 'view.commandPalette': null })
    expect(
      service.findConflict(event({ key: 'P', ctrlKey: true, shiftKey: true }), 'editor.quickOpen')
    ).toBeNull()
  })

  it('recognizes a remapped command by its new keys', () => {
    const service = bindingService({ 'editor.quickOpen': 'Ctrl+Alt+K' })
    const conflict = service.findConflict(event({ key: 'k', ctrlKey: true, altKey: true }), 'editor.save')
    expect(conflict?.command).toBe('editor.quickOpen')
    expect(service.findConflict(event({ key: 'p', ctrlKey: true }), 'editor.save')).toBeNull()
  })

  it('lets an overridden binding outrank a default sharing its keys', () => {
    const service = bindingService({ 'commit.commitStaged': 'Mod+Shift+P' })
    const conflict = service.findConflict(
      event({ key: 'P', ctrlKey: true, shiftKey: true }),
      'editor.quickOpen'
    )
    expect(conflict?.command).toBe('commit.commitStaged')
  })

  it('returns null for combos no binding matches', () => {
    const service = bindingService()
    expect(
      service.findConflict(event({ key: 'j', ctrlKey: true, altKey: true }), 'editor.save')
    ).toBeNull()
  })
})

/**
 * Accelerator parsing and matching. Pure and DOM-free so it runs (and is tested)
 * outside the renderer; the event parameter is a plain object with the fields a
 * `KeyboardEvent` provides.
 */

export interface KeyEventLike {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
}

export interface ParsedAccelerator {
  /** Normalized key name, e.g. `p`, `escape`, `arrowup`, `space`. */
  key: string
  /** The platform-adaptive `Mod` modifier (Cmd on macOS, Ctrl elsewhere). */
  mod: boolean
  ctrl: boolean
  meta: boolean
  shift: boolean
  alt: boolean
}

const KEY_ALIASES: Record<string, string> = {
  esc: 'escape',
  escape: 'escape',
  up: 'arrowup',
  arrowup: 'arrowup',
  down: 'arrowdown',
  arrowdown: 'arrowdown',
  left: 'arrowleft',
  arrowleft: 'arrowleft',
  right: 'arrowright',
  arrowright: 'arrowright',
  space: 'space',
  spacebar: 'space',
  ' ': 'space',
  return: 'enter',
  enter: 'enter',
  del: 'delete',
  delete: 'delete',
  backquote: '`',
  '`': '`',
  backspace: 'backspace',
  tab: 'tab',
  home: 'home',
  end: 'end',
  pageup: 'pageup',
  pagedown: 'pagedown'
}

const MODIFIER_NAMES = new Set(['mod', 'ctrl', 'control', 'cmd', 'command', 'meta', 'alt', 'option', 'shift'])

function normalizeKeyName(raw: string): string {
  const lower = raw.toLowerCase()
  return KEY_ALIASES[lower] ?? lower
}

/** Parses `Mod+Shift+P` into a comparable form; returns null when malformed. */
export function parseAccelerator(text: string): ParsedAccelerator | null {
  const segments = text
    .split('+')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
  if (segments.length === 0) return null

  const keySegment = segments[segments.length - 1]
  if (keySegment === undefined || MODIFIER_NAMES.has(keySegment.toLowerCase())) return null

  const parsed: ParsedAccelerator = {
    key: normalizeKeyName(keySegment),
    mod: false,
    ctrl: false,
    meta: false,
    shift: false,
    alt: false
  }

  for (const segment of segments.slice(0, -1)) {
    switch (segment.toLowerCase()) {
      case 'mod':
        parsed.mod = true
        break
      case 'ctrl':
      case 'control':
        parsed.ctrl = true
        break
      case 'cmd':
      case 'command':
      case 'meta':
        parsed.meta = true
        break
      case 'alt':
      case 'option':
        parsed.alt = true
        break
      case 'shift':
        parsed.shift = true
        break
      default:
        return null
    }
  }
  return parsed
}

export function isMacPlatform(platform: string): boolean {
  return platform === 'darwin'
}

/** Exact modifier match plus key equality, honoring `Mod` per platform. */
export function matchesAccelerator(
  event: KeyEventLike,
  accelerator: ParsedAccelerator,
  platform: string
): boolean {
  const mac = isMacPlatform(platform)
  const expectedMeta = accelerator.meta || (accelerator.mod && mac)
  const expectedCtrl = accelerator.ctrl || (accelerator.mod && !mac)
  if (event.metaKey !== expectedMeta) return false
  if (event.ctrlKey !== expectedCtrl) return false
  if (event.shiftKey !== accelerator.shift) return false
  if (event.altKey !== accelerator.alt) return false
  return normalizeKeyName(event.key) === accelerator.key
}

const DISPLAY_KEYS: Record<string, string> = {
  escape: 'Esc',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  space: 'Space',
  enter: 'Enter',
  delete: 'Del',
  backspace: 'Backspace',
  tab: 'Tab',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown'
}

/** Storage spellings that read better than plain capitalization (`ArrowUp`). */
const CANONICAL_KEYS: Record<string, string> = {
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  pageup: 'PageUp',
  pagedown: 'PageDown'
}

/** Keys pressed on their own that never form a shortcut. */
const MODIFIER_ONLY_KEYS = new Set([
  'control',
  'shift',
  'alt',
  'meta',
  'altgraph',
  'capslock',
  'numlock',
  'scrolllock',
  'dead',
  'os',
  'unidentified',
  'contextmenu'
])

/**
 * Renders a captured key event as accelerator text that {@link parseAccelerator}
 * reads back, e.g. `Ctrl+Shift+P` or `Alt+ArrowLeft`. Returns null while only
 * modifiers are held.
 */
export function acceleratorFromEvent(event: KeyEventLike, platform: string): string | null {
  const key = normalizeKeyName(event.key)
  if (key.length === 0 || MODIFIER_ONLY_KEYS.has(key)) return null

  const parts: string[] = []
  if (event.ctrlKey) parts.push('Ctrl')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  if (event.metaKey) parts.push(isMacPlatform(platform) ? 'Cmd' : 'Win')

  const named = CANONICAL_KEYS[key]
  if (named !== undefined) parts.push(named)
  else if (key.length === 1) parts.push(key.toUpperCase())
  else parts.push(key.charAt(0).toUpperCase() + key.slice(1))
  return parts.join('+')
}

function displayKey(accelerator: ParsedAccelerator): string {
  const named = DISPLAY_KEYS[accelerator.key]
  if (named !== undefined) return named
  if (accelerator.key.length === 1) return accelerator.key.toUpperCase()
  return accelerator.key.charAt(0).toUpperCase() + accelerator.key.slice(1)
}

/** Human-readable form for the palette and tooltips. */
export function formatAccelerator(accelerator: ParsedAccelerator, platform: string): string {
  const key = displayKey(accelerator)
  if (isMacPlatform(platform)) {
    let prefix = ''
    if (accelerator.ctrl) prefix += '⌃'
    if (accelerator.alt) prefix += '⌥'
    if (accelerator.shift) prefix += '⇧'
    if (accelerator.mod || accelerator.meta) prefix += '⌘'
    return `${prefix}${key}`
  }

  const parts: string[] = []
  if (accelerator.ctrl || accelerator.mod) parts.push('Ctrl')
  if (accelerator.alt) parts.push('Alt')
  if (accelerator.shift) parts.push('Shift')
  if (accelerator.meta) parts.push('Win')
  parts.push(key)
  return parts.join('+')
}

export interface EditableTargetLike {
  tagName?: string
  isContentEditable?: boolean
}

export function isEditableTarget(target: EditableTargetLike | null): boolean {
  if (target === null) return false
  if (target.isContentEditable === true) return true
  const tag = typeof target.tagName === 'string' ? target.tagName.toLowerCase() : ''
  return tag === 'input' || tag === 'textarea' || tag === 'select'
}

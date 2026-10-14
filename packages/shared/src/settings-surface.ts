/**
 * The settings surface the app exposes through its UI: one descriptor per key,
 * shared by the settings form (rendering + validation) and the JSON schema that
 * ships for hand-edited files. Purely declarative; runtime consumers keep their
 * own fallbacks for unset keys.
 */

export type SettingGroupId = 'appearance' | 'editor' | 'git' | 'terminal' | 'commitMessage' | 'advanced'

export interface EnumSettingDescriptor {
  type: 'enum'
  keyPath: readonly string[]
  group: SettingGroupId
  default: string
  options: readonly string[]
}

export interface NumberSettingDescriptor {
  type: 'number'
  keyPath: readonly string[]
  group: SettingGroupId
  default: number
  min: number
  max: number
  /** Rounds edited values to whole numbers. */
  integer?: boolean
}

export interface BooleanSettingDescriptor {
  type: 'boolean'
  keyPath: readonly string[]
  group: SettingGroupId
  default: boolean
}

export interface StringSettingDescriptor {
  type: 'string'
  keyPath: readonly string[]
  group: SettingGroupId
  default: string | null
  /** `null` clears the key back to its unset default. */
  nullable: boolean
}

export type SettingDescriptor =
  | EnumSettingDescriptor
  | NumberSettingDescriptor
  | BooleanSettingDescriptor
  | StringSettingDescriptor

export const THEME_VALUES = ['system', 'light', 'dark'] as const
export const DENSITY_VALUES = ['comfortable', 'compact'] as const
export const ACCENT_VALUES = ['blue', 'green', 'violet', 'amber', 'rose'] as const
export const LOCALE_VALUES = ['en', 'zh-Hans'] as const
export const PULL_STRATEGY_VALUES = ['ff-only', 'merge', 'rebase'] as const
export const UNTRACKED_STRATEGY_VALUES = ['normal', 'all'] as const
export const COMMIT_PROVIDER_VALUES = ['offline', 'openai-compatible'] as const
export const LOG_LEVEL_VALUES = ['error', 'warn', 'info', 'debug'] as const

export type AccentValue = (typeof ACCENT_VALUES)[number]
export type DensityValue = (typeof DENSITY_VALUES)[number]
export type LogLevelValue = (typeof LOG_LEVEL_VALUES)[number]

export const TERMINAL_SCROLLBACK_DEFAULT = 5_000
export const TERMINAL_SCROLLBACK_MAX = 200_000

export const SETTINGS_SURFACE: readonly SettingDescriptor[] = [
  {
    type: 'enum',
    keyPath: ['appearance', 'theme'],
    group: 'appearance',
    default: 'system',
    options: THEME_VALUES
  },
  {
    type: 'enum',
    keyPath: ['appearance', 'density'],
    group: 'appearance',
    default: 'comfortable',
    options: DENSITY_VALUES
  },
  {
    type: 'enum',
    keyPath: ['appearance', 'accent'],
    group: 'appearance',
    default: 'blue',
    options: ACCENT_VALUES
  },
  { type: 'enum', keyPath: ['locale'], group: 'appearance', default: 'en', options: LOCALE_VALUES },
  { type: 'number', keyPath: ['editor', 'fontSize'], group: 'editor', default: 13, min: 8, max: 32, integer: true },
  { type: 'string', keyPath: ['editor', 'fontFamily'], group: 'editor', default: null, nullable: true },
  { type: 'number', keyPath: ['editor', 'tabSize'], group: 'editor', default: 2, min: 1, max: 16, integer: true },
  { type: 'boolean', keyPath: ['editor', 'insertSpaces'], group: 'editor', default: true },
  { type: 'boolean', keyPath: ['editor', 'wordWrap'], group: 'editor', default: false },
  { type: 'boolean', keyPath: ['editor', 'minimap'], group: 'editor', default: false },
  { type: 'string', keyPath: ['git', 'path'], group: 'git', default: null, nullable: true },
  { type: 'number', keyPath: ['git', 'concurrency'], group: 'git', default: 6, min: 1, max: 16, integer: true },
  {
    type: 'number',
    keyPath: ['git', 'pollIntervalSec'],
    group: 'git',
    default: 60,
    min: 5,
    max: 3_600,
    integer: true
  },
  {
    type: 'enum',
    keyPath: ['git', 'defaultPullStrategy'],
    group: 'git',
    default: 'ff-only',
    options: PULL_STRATEGY_VALUES
  },
  {
    type: 'enum',
    keyPath: ['git', 'untrackedStrategy'],
    group: 'git',
    default: 'normal',
    options: UNTRACKED_STRATEGY_VALUES
  },
  { type: 'string', keyPath: ['terminal', 'defaultProfile'], group: 'terminal', default: null, nullable: true },
  {
    type: 'number',
    keyPath: ['terminal', 'scrollback'],
    group: 'terminal',
    default: TERMINAL_SCROLLBACK_DEFAULT,
    min: 100,
    max: TERMINAL_SCROLLBACK_MAX,
    integer: true
  },
  {
    type: 'enum',
    keyPath: ['commitMessage', 'provider'],
    group: 'commitMessage',
    default: 'offline',
    options: COMMIT_PROVIDER_VALUES
  },
  { type: 'string', keyPath: ['commitMessage', 'baseUrl'], group: 'commitMessage', default: null, nullable: true },
  { type: 'string', keyPath: ['commitMessage', 'model'], group: 'commitMessage', default: null, nullable: true },
  {
    type: 'number',
    keyPath: ['commitMessage', 'temperature'],
    group: 'commitMessage',
    default: 0.2,
    min: 0,
    max: 2
  },
  {
    type: 'enum',
    keyPath: ['advanced', 'logLevel'],
    group: 'advanced',
    default: 'info',
    options: LOG_LEVEL_VALUES
  }
]

function sameKeyPath(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((segment, index) => segment === b[index])
}

export function findSettingDescriptor(keyPath: readonly string[]): SettingDescriptor | null {
  return SETTINGS_SURFACE.find((descriptor) => sameKeyPath(descriptor.keyPath, keyPath)) ?? null
}

export function settingDescriptorsFor(group: SettingGroupId): SettingDescriptor[] {
  return SETTINGS_SURFACE.filter((descriptor) => descriptor.group === group)
}

/** The default value of a key; `undefined` when the key is not on the surface. */
export function settingDefault(keyPath: readonly string[]): unknown {
  return findSettingDescriptor(keyPath)?.default
}

/**
 * Coerces an edited value to the descriptor's shape: enum members only, numbers
 * clamped (and rounded when integer), booleans kept, strings (or `null` for
 * nullable ones) trimmed as-is. Returns `undefined` when the value is invalid,
 * so callers can reject the edit rather than persist garbage.
 */
export function sanitizeSettingValue(descriptor: SettingDescriptor, value: unknown): unknown {
  switch (descriptor.type) {
    case 'enum':
      return typeof value === 'string' && descriptor.options.includes(value) ? value : undefined
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
      const clamped = Math.min(descriptor.max, Math.max(descriptor.min, value))
      return descriptor.integer === true ? Math.round(clamped) : clamped
    }
    case 'boolean':
      return typeof value === 'boolean' ? value : undefined
    case 'string':
      if (typeof value === 'string') {
        return value.length === 0 && descriptor.nullable ? null : value
      }
      return value === null && descriptor.nullable ? null : undefined
  }
}

/** A setting read from a settings file is usable when sanitizing keeps it equal to itself. */
export function isSettingValueUsable(descriptor: SettingDescriptor, value: unknown): boolean {
  if (value === undefined) return false
  const sanitized = sanitizeSettingValue(descriptor, value)
  return sanitized !== undefined && JSON.stringify(sanitized) === JSON.stringify(value)
}

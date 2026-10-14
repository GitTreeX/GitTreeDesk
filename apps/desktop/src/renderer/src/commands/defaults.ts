import type { CommandRegistry } from './registry'
import {
  formatAccelerator,
  isEditableTarget,
  matchesAccelerator,
  parseAccelerator,
  type EditableTargetLike,
  type ParsedAccelerator
} from './keybinding'

export interface DefaultBinding {
  command: string
  /** Accelerator text, e.g. `Mod+Shift+P`. */
  keys: string
  /** Allows the binding to fire while a text field has focus. */
  allowInInput?: boolean
}

/**
 * Defaults shipped with the shell. The keyboard surface grows together with the
 * features behind it; entries here are the complete set the app currently honors.
 */
export const DEFAULT_BINDINGS: readonly DefaultBinding[] = [
  { command: 'view.commandPalette', keys: 'Mod+Shift+P', allowInInput: true },
  { command: 'view.dismiss', keys: 'Escape', allowInInput: true },
  { command: 'view.showScm', keys: 'Mod+Shift+G', allowInInput: true },
  { command: 'view.goToRepo', keys: 'Mod+R', allowInInput: true },
  { command: 'editor.save', keys: 'Mod+S', allowInInput: true },
  { command: 'editor.closeTab', keys: 'Mod+W', allowInInput: true },
  { command: 'editor.quickOpen', keys: 'Mod+P', allowInInput: true },
  { command: 'git.fetchRepo', keys: 'Mod+Shift+F', allowInInput: true },
  { command: 'explorer.rename', keys: 'F2' },
  { command: 'explorer.delete', keys: 'Delete' }
]

export interface ResolvedBinding {
  command: string
  accelerator: ParsedAccelerator
  display: string
  allowInInput: boolean
}

export function buildBindings(
  platform: string,
  bindings: readonly DefaultBinding[] = DEFAULT_BINDINGS
): ResolvedBinding[] {
  const resolved: ResolvedBinding[] = []
  for (const binding of bindings) {
    const accelerator = parseAccelerator(binding.keys)
    if (accelerator === null) continue
    resolved.push({
      command: binding.command,
      accelerator,
      display: formatAccelerator(accelerator, platform),
      allowInInput: binding.allowInInput === true
    })
  }
  return resolved
}

/**
 * Routes keyboard shortcuts to commands. A key matching a disabled or
 * input-restricted binding is swallowed rather than falling through, so a
 * half-applicable shortcut never leaks into plain text.
 */
export class KeyBindingService {
  readonly #registry: CommandRegistry
  readonly #bindings: readonly ResolvedBinding[]
  readonly #platform: string

  constructor(registry: CommandRegistry, platform: string, bindings: readonly ResolvedBinding[]) {
    this.#registry = registry
    this.#platform = platform
    this.#bindings = bindings
  }

  bindingsFor(command: string): ResolvedBinding[] {
    return this.#bindings.filter((binding) => binding.command === command)
  }

  formatFor(command: string): string | null {
    return this.bindingsFor(command)[0]?.display ?? null
  }

  attach(target: Window): () => void {
    const onKeyDown = (event: KeyboardEvent): void => {
      for (const binding of this.#bindings) {
        if (!matchesAccelerator(event, binding.accelerator, this.#platform)) continue
        if (!binding.allowInInput && isEditableTarget(event.target as EditableTargetLike | null)) return
        event.preventDefault()
        void this.#registry.execute(binding.command).catch((error: unknown) => {
          console.error(`[commands] ${binding.command} failed`, error)
        })
        return
      }
    }
    target.addEventListener('keydown', onKeyDown)
    return () => target.removeEventListener('keydown', onKeyDown)
  }
}

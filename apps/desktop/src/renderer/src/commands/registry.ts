/**
 * Command registry: the single dispatch point for palette entries, keybindings,
 * the application menu, and future UI affordances. DOM-free and i18n-free: it
 * stores translation *keys* and callers resolve them.
 */

export interface CommandDefinition {
  id: string
  /** i18n key of the display title; allows runtime titles to omit it. */
  titleKey?: string
  /** Literal display title (already localized); wins over `titleKey`. */
  title?: string
  /** i18n key of the palette category. */
  categoryKey: string
  run: () => void | Promise<void>
  /** When false the command is listed as disabled and does not run. */
  enabled?: () => boolean
  hiddenInPalette?: boolean
}

export interface PaletteItem {
  id: string
  title: string
  category: string
}

export class CommandRegistry {
  readonly #commands = new Map<string, CommandDefinition>()

  register(definition: CommandDefinition): void {
    this.#commands.set(definition.id, definition)
  }

  unregister(id: string): boolean {
    return this.#commands.delete(id)
  }

  get(id: string): CommandDefinition | undefined {
    return this.#commands.get(id)
  }

  list(): CommandDefinition[] {
    return [...this.#commands.values()]
  }

  isEnabled(id: string): boolean {
    const definition = this.#commands.get(id)
    if (definition === undefined) return false
    return definition.enabled?.() !== false
  }

  /** Runs the command; resolves false when unknown or currently disabled. */
  async execute(id: string): Promise<boolean> {
    const definition = this.#commands.get(id)
    if (definition === undefined) return false
    if (definition.enabled?.() === false) return false
    await definition.run()
    return true
  }
}

/** Case-insensitive, token-based filter over title, category, and id. */
export function filterCommands<T extends PaletteItem>(items: readonly T[], query: string): T[] {
  const tokens = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 0)
  if (tokens.length === 0) return [...items]
  return items.filter((item) => {
    const haystack = `${item.title}\n${item.category}\n${item.id}`.toLowerCase()
    return tokens.every((token) => haystack.includes(token))
  })
}

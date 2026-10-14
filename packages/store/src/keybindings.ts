import { join } from 'node:path'
import { readJsonFile, removeJsonValue, setJsonValue } from './json'

export const USER_KEYBINDINGS_FILE = 'keybindings.json'

export interface KeybindingChange {
  command: string
  /** The new accelerator text; `null` unbinds the command, `undefined` removes the override. */
  keys: string | null | undefined
}

export interface KeybindingsStoreOptions {
  userDataDir: string
}

/**
 * User shortcut overrides in `<userData>/keybindings.json`: a map of command id →
 * accelerator text, `null` to unbind a default. `$schema`-style meta keys are ignored.
 */
export class KeybindingsStore {
  readonly #userDataDir: string
  readonly #listeners = new Set<(change: KeybindingChange) => void>()

  constructor(options: KeybindingsStoreOptions) {
    this.#userDataDir = options.userDataDir
  }

  file(): string {
    return join(this.#userDataDir, USER_KEYBINDINGS_FILE)
  }

  /** All overrides; unreadable or non-object files read as empty. */
  async getAll(): Promise<Record<string, string | null>> {
    const { value } = await readJsonFile(this.file())
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
    const entries: Record<string, string | null> = {}
    for (const [key, entry] of Object.entries(value)) {
      if (key.startsWith('$')) continue
      if (typeof entry === 'string' || entry === null) entries[key] = entry
    }
    return entries
  }

  /** Writes an override; `null` records an explicit unbind. */
  async set(command: string, keys: string | null): Promise<void> {
    if ((await this.getAll())[command] === keys) return
    await setJsonValue(this.file(), [command], keys)
    this.#emit({ command, keys })
  }

  /** Removes the override so the default binding applies again. */
  async remove(command: string): Promise<void> {
    if (!(command in (await this.getAll()))) return
    await removeJsonValue(this.file(), [command])
    this.#emit({ command, keys: undefined })
  }

  onDidChange(listener: (change: KeybindingChange) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  #emit(change: KeybindingChange): void {
    for (const listener of this.#listeners) listener(change)
  }
}

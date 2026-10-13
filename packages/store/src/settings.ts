import { join } from 'node:path'
import type { SettingsScope } from '@gitreedesk/shared'
import { readJsonFile, readKeyPath, removeJsonValue, setJsonValue } from './json'

export const WORKSPACE_META_DIR = '.gitreedesk'
export const USER_SETTINGS_FILE = 'settings.json'
export const WORKSPACE_SETTINGS_FILE = 'settings.json'

export type { SettingsScope }

export interface SettingsChange {
  scope: SettingsScope
  /** Workspace root for workspace-scope changes; `null` otherwise. */
  root: string | null
  keyPath: string[]
  /** The new value; `undefined` when the key was removed. */
  value: unknown
}

export interface SettingsStoreOptions {
  userDataDir: string
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Scoped settings over comment-preserving JSONC files: user scope in
 * `<userData>/settings.json`, workspace scope in `<root>/.gitreedesk/settings.json`.
 * An effective read prefers the workspace value and falls back to the user value.
 */
export class SettingsStore {
  readonly #userDataDir: string
  readonly #listeners = new Set<(change: SettingsChange) => void>()

  constructor(options: SettingsStoreOptions) {
    this.#userDataDir = options.userDataDir
  }

  userFile(): string {
    return join(this.#userDataDir, USER_SETTINGS_FILE)
  }

  workspaceFile(root: string): string {
    return join(root, WORKSPACE_META_DIR, WORKSPACE_SETTINGS_FILE)
  }

  async getUser(keyPath: readonly string[]): Promise<unknown> {
    return readKeyPath((await readJsonFile(this.userFile())).value, keyPath)
  }

  async getUserAll(): Promise<unknown> {
    return (await readJsonFile(this.userFile())).value
  }

  async setUser(keyPath: readonly string[], value: unknown): Promise<void> {
    if (sameValue(await this.getUser(keyPath), value)) return
    await setJsonValue(this.userFile(), keyPath, value)
    this.#emit({ scope: 'user', root: null, keyPath: [...keyPath], value })
  }

  async removeUser(keyPath: readonly string[]): Promise<void> {
    if ((await this.getUser(keyPath)) === undefined) return
    await removeJsonValue(this.userFile(), keyPath)
    this.#emit({ scope: 'user', root: null, keyPath: [...keyPath], value: undefined })
  }

  async getWorkspace(root: string, keyPath: readonly string[]): Promise<unknown> {
    return readKeyPath((await readJsonFile(this.workspaceFile(root))).value, keyPath)
  }

  async getWorkspaceAll(root: string): Promise<unknown> {
    return (await readJsonFile(this.workspaceFile(root))).value
  }

  async setWorkspace(root: string, keyPath: readonly string[], value: unknown): Promise<void> {
    if (sameValue(await this.getWorkspace(root, keyPath), value)) return
    await setJsonValue(this.workspaceFile(root), keyPath, value)
    this.#emit({ scope: 'workspace', root, keyPath: [...keyPath], value })
  }

  async removeWorkspace(root: string, keyPath: readonly string[]): Promise<void> {
    if ((await this.getWorkspace(root, keyPath)) === undefined) return
    await removeJsonValue(this.workspaceFile(root), keyPath)
    this.#emit({ scope: 'workspace', root, keyPath: [...keyPath], value: undefined })
  }

  async effective(root: string | null, keyPath: readonly string[]): Promise<unknown> {
    if (root !== null) {
      const workspace = await this.getWorkspace(root, keyPath)
      if (workspace !== undefined) return workspace
    }
    return this.getUser(keyPath)
  }

  onDidChange(listener: (change: SettingsChange) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  #emit(change: SettingsChange): void {
    for (const listener of this.#listeners) listener(change)
  }
}

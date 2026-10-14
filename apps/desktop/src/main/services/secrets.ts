import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/** OS-backed encryption for stored secrets. */
export interface SecretCodec {
  /** False when the platform offers no real encryption (e.g. a Linux session without a keyring). */
  readonly available: boolean
  /** Encrypts to a base64 token; throws when the OS facility fails. */
  encrypt(text: string): string
  /** Decrypts a token produced by {@link SecretCodec.encrypt}; throws on failure. */
  decrypt(token: string): string
}

export interface SecretsStoreOptions {
  userDataDir: string
  codec: SecretCodec
}

export interface SecretStatus {
  stored: boolean
  encrypted: boolean
}

/** Name of the commit-message provider API key. */
export const API_KEY_SECRET = 'commitMessage.apiKey'

const SECRETS_FILE = 'secrets.json'

/**
 * Keeps named secrets (currently the LLM provider API key). Values persist to
 * `<userData>/secrets.json` only when the codec offers real OS encryption;
 * otherwise they stay in memory for the session, so plaintext never touches
 * the disk.
 */
export class SecretsStore {
  readonly #file: string
  readonly #codec: SecretCodec
  readonly #values = new Map<string, string>()
  #loaded = false

  constructor(options: SecretsStoreOptions) {
    this.#file = join(options.userDataDir, SECRETS_FILE)
    this.#codec = options.codec
  }

  async get(name: string): Promise<string | null> {
    const memory = this.#values.get(name)
    if (memory !== undefined) return memory
    if (!this.#codec.available) return null
    await this.#load()
    return this.#values.get(name) ?? null
  }

  async set(name: string, secret: string): Promise<SecretStatus> {
    if (this.#codec.available) await this.#load()
    this.#values.set(name, secret)
    if (this.#codec.available) await this.#persist()
    return { stored: true, encrypted: this.#codec.available }
  }

  async remove(name: string): Promise<SecretStatus> {
    if (this.#codec.available) await this.#load()
    this.#values.delete(name)
    if (this.#codec.available) await this.#persist()
    return { stored: false, encrypted: this.#codec.available }
  }

  async status(name: string): Promise<SecretStatus> {
    if (this.#codec.available) await this.#load()
    return { stored: this.#values.has(name), encrypted: this.#codec.available }
  }

  async #load(): Promise<void> {
    if (this.#loaded) return
    this.#loaded = true
    let raw: string
    try {
      raw = await readFile(this.#file, 'utf8')
    } catch {
      return
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return
    }
    if (parsed === null || typeof parsed !== 'object') return
    for (const [name, token] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof token !== 'string') continue
      try {
        this.#values.set(name, this.#codec.decrypt(token))
      } catch {
        // An unreadable token (keyring rotated, file corrupted) is dropped.
      }
    }
  }

  async #persist(): Promise<void> {
    const entries: Record<string, string> = {}
    for (const [name, value] of this.#values) entries[name] = this.#codec.encrypt(value)
    await mkdir(dirname(this.#file), { recursive: true })
    await writeFile(this.#file, `${JSON.stringify(entries, null, 2)}\n`, 'utf8')
  }
}

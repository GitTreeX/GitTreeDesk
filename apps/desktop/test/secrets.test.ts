import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { API_KEY_SECRET, SecretsStore, type SecretCodec } from '../src/main/services/secrets'

let dirs: string[] = []

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  const pending = dirs
  dirs = []
  for (const dir of pending) await rm(dir, { recursive: true, force: true })
})

/** Base64 round-trip standing in for OS encryption. */
const fakeCodec: SecretCodec = {
  available: true,
  encrypt: (text) => Buffer.from(text, 'utf8').toString('base64'),
  decrypt: (token) => Buffer.from(token, 'base64').toString('utf8')
}

const sessionCodec: SecretCodec = {
  available: false,
  encrypt: () => {
    throw new Error('no OS encryption')
  },
  decrypt: () => {
    throw new Error('no OS encryption')
  }
}

/** Rejects tokens that are not valid base64 round-trips, like a real decryptor. */
const strictCodec: SecretCodec = {
  available: true,
  encrypt: (text) => Buffer.from(text, 'utf8').toString('base64'),
  decrypt: (token) => {
    const decoded = Buffer.from(token, 'base64').toString('utf8')
    if (Buffer.from(decoded, 'utf8').toString('base64') !== token) {
      throw new Error('unreadable token')
    }
    return decoded
  }
}

describe('SecretsStore', () => {
  it('persists encrypted values and reloads them through a fresh store', async () => {
    const userData = await tempDir('gtd-secrets-')
    const store = new SecretsStore({ userDataDir: userData, codec: fakeCodec })

    await expect(store.status(API_KEY_SECRET)).resolves.toEqual({ stored: false, encrypted: true })
    await expect(store.get(API_KEY_SECRET)).resolves.toBeNull()
    await expect(store.set(API_KEY_SECRET, 'sk-test-123')).resolves.toEqual({
      stored: true,
      encrypted: true
    })

    const raw = await readFile(join(userData, 'secrets.json'), 'utf8')
    expect(raw).not.toContain('sk-test-123')
    expect(JSON.parse(raw)).toEqual({
      [API_KEY_SECRET]: Buffer.from('sk-test-123', 'utf8').toString('base64')
    })

    const second = new SecretsStore({ userDataDir: userData, codec: fakeCodec })
    await expect(second.get(API_KEY_SECRET)).resolves.toBe('sk-test-123')
    await expect(second.status(API_KEY_SECRET)).resolves.toEqual({ stored: true, encrypted: true })

    await expect(second.remove(API_KEY_SECRET)).resolves.toEqual({ stored: false, encrypted: true })
    expect(JSON.parse(await readFile(join(userData, 'secrets.json'), 'utf8'))).toEqual({})
    await expect(second.get(API_KEY_SECRET)).resolves.toBeNull()
  })

  it('keeps secrets in memory only when the codec offers no encryption', async () => {
    const userData = await tempDir('gtd-secrets-')
    const store = new SecretsStore({ userDataDir: userData, codec: sessionCodec })

    await expect(store.set(API_KEY_SECRET, 'sk-session')).resolves.toEqual({
      stored: true,
      encrypted: false
    })
    await expect(store.get(API_KEY_SECRET)).resolves.toBe('sk-session')
    await expect(store.status(API_KEY_SECRET)).resolves.toEqual({ stored: true, encrypted: false })

    await expect(readFile(join(userData, 'secrets.json'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT'
    })

    const second = new SecretsStore({ userDataDir: userData, codec: sessionCodec })
    await expect(second.get(API_KEY_SECRET)).resolves.toBeNull()
    await expect(second.set(API_KEY_SECRET, 'sk-session-2')).resolves.toEqual({
      stored: true,
      encrypted: false
    })
    await expect(readFile(join(userData, 'secrets.json'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('drops unreadable persisted tokens and survives a corrupted file', async () => {
    const userData = await tempDir('gtd-secrets-')
    await writeFile(
      join(userData, 'secrets.json'),
      JSON.stringify({ [API_KEY_SECRET]: 'not-a-real-token', other: 42 })
    )
    const store = new SecretsStore({ userDataDir: userData, codec: strictCodec })
    await expect(store.get(API_KEY_SECRET)).resolves.toBeNull()
    await expect(store.status(API_KEY_SECRET)).resolves.toEqual({ stored: false, encrypted: true })

    await writeFile(join(userData, 'secrets.json'), '{ not json')
    const second = new SecretsStore({ userDataDir: userData, codec: strictCodec })
    await expect(second.status(API_KEY_SECRET)).resolves.toEqual({ stored: false, encrypted: true })
  })
})

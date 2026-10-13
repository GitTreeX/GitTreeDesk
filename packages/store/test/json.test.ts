import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readJsonFile, readKeyPath, removeJsonValue, setJsonValue, writeJsonFile } from '../src/json'

let dirs: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'gtd-json-'))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true })
  dirs = []
})

describe('readJsonFile', () => {
  it('returns null without issues for a missing file', async () => {
    const dir = await tempDir()
    const result = await readJsonFile(join(dir, 'missing.json'))
    expect(result.value).toBeNull()
    expect(result.issues).toEqual([])
  })

  it('parses comments, trailing commas and a BOM', async () => {
    const dir = await tempDir()
    const file = join(dir, 'settings.json')
    await writeFile(file, '\uFEFF{\n  // a comment\n  "name": "acme",\n  "list": [1, 2,],\n}\n', 'utf8')

    const result = await readJsonFile(file)
    expect(result.issues).toEqual([])
    expect(result.value).toEqual({ name: 'acme', list: [1, 2] })
  })

  it('reports issues for invalid JSON but keeps what parsed', async () => {
    const dir = await tempDir()
    const file = join(dir, 'broken.json')
    await writeFile(file, '{ "name": "acme", ', 'utf8')

    const result = await readJsonFile(file)
    expect(result.issues.length).toBeGreaterThan(0)
    expect(result.issues[0]).toContain('broken.json')
  })
})

describe('readKeyPath', () => {
  it('walks nested values and returns undefined for missing segments', () => {
    const value = { view: { badges: { dirty: true } } }
    expect(readKeyPath(value, ['view', 'badges', 'dirty'])).toBe(true)
    expect(readKeyPath(value, ['view', 'missing'])).toBeUndefined()
    expect(readKeyPath(value, ['view', 'badges', 'dirty', 'deep'])).toBeUndefined()
    expect(readKeyPath(null, ['a'])).toBeUndefined()
  })
})

describe('setJsonValue', () => {
  it('creates missing files and parent directories', async () => {
    const dir = await tempDir()
    const file = join(dir, '.gitreedesk', 'settings.json')

    await setJsonValue(file, ['view', 'badges', 'dirty'], true)
    const result = await readJsonFile(file)
    expect(result.value).toEqual({ view: { badges: { dirty: true } } })
  })

  it('preserves comments and unrelated keys', async () => {
    const dir = await tempDir()
    const file = join(dir, 'settings.json')
    await writeFile(file, '{\n  // keep me\n  "keep": true,\n  "change": 1\n}\n', 'utf8')

    await setJsonValue(file, ['change'], 2)
    const text = await readFile(file, 'utf8')
    expect(text).toContain('// keep me')
    expect(await readJsonFile(file)).toMatchObject({ value: { keep: true, change: 2 } })
  })

  it('skips the write when the value is unchanged', async () => {
    const dir = await tempDir()
    const file = join(dir, 'settings.json')
    await writeFile(file, '{"a": 1}', 'utf8')

    await setJsonValue(file, ['a'], 1)
    expect(await readFile(file, 'utf8')).toBe('{"a": 1}')
  })
})

describe('removeJsonValue', () => {
  it('removes a key while keeping keys and comments elsewhere in the file', async () => {
    const dir = await tempDir()
    const file = join(dir, 'settings.json')
    await writeFile(file, '{\n  "a": 1,\n  "b": 2,\n  // unrelated note\n  "c": 3\n}\n', 'utf8')

    await removeJsonValue(file, ['a'])
    const text = await readFile(file, 'utf8')
    expect(text).toContain('// unrelated note')
    expect(await readJsonFile(file)).toMatchObject({ value: { b: 2, c: 3 } })
  })

  it('removes a comment that documents the removed key', async () => {
    const dir = await tempDir()
    const file = join(dir, 'settings.json')
    await writeFile(file, '{\n  // note about a\n  "a": 1,\n  "b": 2\n}\n', 'utf8')

    await removeJsonValue(file, ['a'])
    expect(await readFile(file, 'utf8')).not.toContain('note about a')
    expect(await readJsonFile(file)).toMatchObject({ value: { b: 2 } })
  })
})

describe('writeJsonFile', () => {
  it('writes pretty JSON without leaving temporary files behind', async () => {
    const dir = await tempDir()
    const file = join(dir, 'cache.json')
    await writeJsonFile(file, { name: 'acme' })

    expect(await readFile(file, 'utf8')).toBe('{\n  "name": "acme"\n}\n')
    const entries = await readdir(dir)
    expect(entries).toEqual(['cache.json'])
  })
})

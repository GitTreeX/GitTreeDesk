import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { KeybindingsStore, type KeybindingChange } from '../src/keybindings'

let dirs: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'gtd-keybindings-'))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true })
  dirs = []
})

describe('KeybindingsStore', () => {
  it('reads an empty override map from a missing file', async () => {
    const store = new KeybindingsStore({ userDataDir: await tempDir() })
    await expect(store.getAll()).resolves.toEqual({})
  })

  it('writes, overwrites and reads back overrides', async () => {
    const store = new KeybindingsStore({ userDataDir: await tempDir() })
    const changes: KeybindingChange[] = []
    store.onDidChange((change) => changes.push(change))

    await store.set('view.scm', 'Ctrl+Alt+S')
    await expect(store.getAll()).resolves.toEqual({ 'view.scm': 'Ctrl+Alt+S' })

    await store.set('view.scm', 'Ctrl+Alt+M')
    await expect(store.getAll()).resolves.toEqual({ 'view.scm': 'Ctrl+Alt+M' })

    await store.set('view.scm', 'Ctrl+Alt+M')
    expect(changes).toEqual([
      { command: 'view.scm', keys: 'Ctrl+Alt+S' },
      { command: 'view.scm', keys: 'Ctrl+Alt+M' }
    ])
  })

  it('records an explicit unbind as null and restores defaults on remove', async () => {
    const dir = await tempDir()
    const store = new KeybindingsStore({ userDataDir: dir })

    await store.set('view.terminal', null)
    await expect(store.getAll()).resolves.toEqual({ 'view.terminal': null })

    await store.set('view.scm', 'Ctrl+Alt+S')
    await store.remove('view.terminal')
    await expect(store.getAll()).resolves.toEqual({ 'view.scm': 'Ctrl+Alt+S' })

    await store.remove('view.terminal')
    await store.remove('view.missing')
    await expect(store.getAll()).resolves.toEqual({ 'view.scm': 'Ctrl+Alt+S' })
  })

  it('skips meta keys and entries with unsupported value types', async () => {
    const dir = await tempDir()
    await writeFile(
      join(dir, 'keybindings.json'),
      '{\n  // user overrides\n  "$schema": "./keybindings.schema.json",\n  "view.scm": "Ctrl+Alt+S",\n  "view.graph": null,\n  "view.dirty": 42,\n  "view.list": ["a"]\n}\n',
      'utf8'
    )
    const store = new KeybindingsStore({ userDataDir: dir })
    await expect(store.getAll()).resolves.toEqual({ 'view.scm': 'Ctrl+Alt+S', 'view.graph': null })
  })

  it('treats non-object files as empty', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'keybindings.json'), '["view.scm"]\n', 'utf8')
    const store = new KeybindingsStore({ userDataDir: dir })
    await expect(store.getAll()).resolves.toEqual({})
  })
})

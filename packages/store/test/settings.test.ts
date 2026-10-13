import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SettingsStore, WORKSPACE_META_DIR, type SettingsChange } from '../src/settings'

let dirs: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'gtd-settings-'))
  dirs.push(dir)
  return dir
}

async function build(): Promise<{ store: SettingsStore; userDataDir: string; root: string }> {
  const dir = await tempDir()
  const userDataDir = join(dir, 'userData')
  const root = join(dir, 'acme')
  await mkdir(root, { recursive: true })
  return { store: new SettingsStore({ userDataDir }), userDataDir, root }
}

afterEach(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true })
  dirs = []
})

describe('SettingsStore', () => {
  it('creates the user file on first write and reads values back', async () => {
    const { store } = await build()
    expect(await store.getUser(['editor', 'fontSize'])).toBeUndefined()

    await store.setUser(['editor', 'fontSize'], 14)
    expect(await store.getUser(['editor', 'fontSize'])).toBe(14)
    expect(await store.getUserAll()).toEqual({ editor: { fontSize: 14 } })
  })

  it('keeps user and workspace scopes in separate files', async () => {
    const { store, root } = await build()
    expect(store.workspaceFile(root)).toBe(join(root, WORKSPACE_META_DIR, 'settings.json'))

    await store.setUser(['view', 'badges', 'dirty'], false)
    await store.setWorkspace(root, ['view', 'badges', 'dirty'], true)

    expect(await store.getUser(['view', 'badges', 'dirty'])).toBe(false)
    expect(await store.getWorkspace(root, ['view', 'badges', 'dirty'])).toBe(true)
  })

  it('resolves effective values with workspace precedence', async () => {
    const { store, root } = await build()
    expect(await store.effective(root, ['graph', 'laneWidth'])).toBeUndefined()

    await store.setUser(['graph', 'laneWidth'], 12)
    expect(await store.effective(root, ['graph', 'laneWidth'])).toBe(12)

    await store.setWorkspace(root, ['graph', 'laneWidth'], 20)
    expect(await store.effective(root, ['graph', 'laneWidth'])).toBe(20)
    expect(await store.effective(null, ['graph', 'laneWidth'])).toBe(12)
  })

  it('preserves comments and formatting when writing into a workspace file', async () => {
    const { store, root } = await build()
    await mkdir(join(root, WORKSPACE_META_DIR), { recursive: true })
    const file = join(root, WORKSPACE_META_DIR, 'settings.json')
    await writeFile(
      file,
      '{\n  // terminal profiles live in terminal.json\n  "view": {\n    "badges": { "dirty": true }\n  }\n}\n',
      'utf8'
    )

    await store.setWorkspace(root, ['view', 'badges', 'stash'], false)
    const text = await readFile(file, 'utf8')
    expect(text).toContain('// terminal profiles live in terminal.json')
    expect(text).toContain('"dirty": true')
    expect(await store.getWorkspace(root, ['view', 'badges', 'stash'])).toBe(false)
  })

  it('removes keys while keeping the rest of the file', async () => {
    const { store } = await build()
    await store.setUser(['a'], 1)
    await store.setUser(['b'], 2)

    await store.removeUser(['a'])
    expect(await store.getUser(['a'])).toBeUndefined()
    expect(await store.getUser(['b'])).toBe(2)

    await store.removeUser(['missing'])
    expect(await store.getUser(['b'])).toBe(2)
  })

  it('notifies listeners about real changes only', async () => {
    const { store, root } = await build()
    const changes: SettingsChange[] = []
    const unsubscribe = store.onDidChange((change) => changes.push(change))

    await store.setUser(['editor', 'fontSize'], 14)
    await store.setUser(['editor', 'fontSize'], 14)
    await store.setWorkspace(root, ['view', 'badges', 'stash'], true)
    await store.removeUser(['editor', 'fontSize'])

    expect(changes).toEqual([
      { scope: 'user', root: null, keyPath: ['editor', 'fontSize'], value: 14 },
      { scope: 'workspace', root, keyPath: ['view', 'badges', 'stash'], value: true },
      { scope: 'user', root: null, keyPath: ['editor', 'fontSize'], value: undefined }
    ])

    unsubscribe()
    await store.setUser(['editor', 'fontSize'], 16)
    expect(changes).toHaveLength(3)
  })
})

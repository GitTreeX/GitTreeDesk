import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_SCAN, loadWorkspaceConfig, parseWorkspaceConfig } from '../src/config'

let dirs: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'gtd-cfg-'))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true })
  dirs = []
})

describe('parseWorkspaceConfig', () => {
  it('applies documented defaults when fields are absent', () => {
    const { config, issues } = parseWorkspaceConfig({}, 'acme')
    expect(config.name).toBe('acme')
    expect(config.exclude).toEqual([])
    expect(config.groups).toBeNull()
    expect(config.scan).toEqual(DEFAULT_SCAN)
    expect(issues).toEqual([])
  })

  it('accepts the documented workspace.json shape', () => {
    const { config, issues } = parseWorkspaceConfig(
      {
        $schema: 'https://gitreedesk.dev/schemas/workspace.json',
        name: 'acme',
        exclude: ['content/中文文档', '**/fixtures/**'],
        scan: { maxDepth: 4, followSymlinks: true, maxEntries: 500 },
        groups: [{ name: 'Backend', match: ['backend/*'] }]
      },
      'fallback'
    )
    expect(config).toEqual({
      name: 'acme',
      exclude: ['content/中文文档', '**/fixtures/**'],
      scan: { maxDepth: 4, followSymlinks: true, maxEntries: 500 },
      groups: [{ name: 'Backend', match: ['backend/*'] }]
    })
    expect(issues).toEqual([])
  })

  it('falls back per field and reports what was unusable', () => {
    const { config, issues } = parseWorkspaceConfig(
      {
        name: '',
        exclude: ['ok', 42],
        scan: { maxDepth: 'eight', followSymlinks: 'yes' },
        groups: [{ name: 'Bad' }, { name: 'Backend', match: ['backend/*'] }]
      },
      'acme'
    )
    expect(config.name).toBe('acme')
    expect(config.exclude).toEqual(['ok'])
    expect(config.scan.maxDepth).toBe(DEFAULT_SCAN.maxDepth)
    expect(config.scan.followSymlinks).toBe(false)
    expect(config.groups).toEqual([{ name: 'Backend', match: ['backend/*'] }])
    expect(issues.length).toBeGreaterThanOrEqual(4)
  })

  it('rejects non-object roots', () => {
    const { config, issues } = parseWorkspaceConfig([1, 2], 'acme')
    expect(config.name).toBe('acme')
    expect(config.scan).toEqual(DEFAULT_SCAN)
    expect(issues).toHaveLength(1)
  })
})

describe('loadWorkspaceConfig', () => {
  it('returns defaults when the file is missing', async () => {
    const dir = await tempDir()
    const { config, issues } = await loadWorkspaceConfig(dir)
    expect(config.name).toBe(dir.split(/[\\/]/).pop())
    expect(issues).toEqual([])
  })

  it('reads and parses .gitreedesk/workspace.json', async () => {
    const dir = await tempDir()
    await mkdir(join(dir, '.gitreedesk'))
    await writeFile(
      join(dir, '.gitreedesk', 'workspace.json'),
      JSON.stringify({ name: 'acme', exclude: ['vendor/**'] })
    )
    const { config, issues } = await loadWorkspaceConfig(dir)
    expect(config.name).toBe('acme')
    expect(config.exclude).toEqual(['vendor/**'])
    expect(issues).toEqual([])
  })

  it('reports invalid JSON and keeps defaults', async () => {
    const dir = await tempDir()
    await mkdir(join(dir, '.gitreedesk'))
    await writeFile(join(dir, '.gitreedesk', 'workspace.json'), '{ not json')
    const { config, issues } = await loadWorkspaceConfig(dir)
    expect(config.exclude).toEqual([])
    expect(issues).toHaveLength(1)
    expect(issues[0]).toContain('not valid JSON')
  })
})

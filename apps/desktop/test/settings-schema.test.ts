import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'jsonc-parser'
import { afterEach, describe, expect, it } from 'vitest'
import { SETTINGS_SURFACE } from '@gitreedesk/shared'
import { buildSettingsSchema, syncSettingsFiles } from '../src/main/settings-schema'

let dirs: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'gtd-schema-'))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true })
  dirs = []
})

type JsonObject = Record<string, unknown>

function propertiesOf(schema: JsonObject): JsonObject {
  return schema['properties'] as JsonObject
}

describe('buildSettingsSchema', () => {
  it('nests every surface key under its group with its value shape', async () => {
    const schema = buildSettingsSchema()
    expect(schema['$schema']).toBe('http://json-schema.org/draft-07/schema#')
    expect(schema['additionalProperties']).toBe(true)

    const properties = propertiesOf(schema)
    const git = properties['git'] as JsonObject
    const gitProps = propertiesOf(git)
    expect(gitProps['concurrency']).toEqual({ type: 'number', minimum: 1, maximum: 16, default: 6 })
    expect(gitProps['path']).toEqual({ type: ['string', 'null'], default: null })

    const appearance = propertiesOf(properties['appearance'] as JsonObject)
    expect(appearance['accent']).toEqual({
      type: 'string',
      enum: ['blue', 'green', 'violet', 'amber', 'rose'],
      default: 'blue'
    })
    // single-segment keys stay at the root
    expect(properties['locale']).toMatchObject({ type: 'string', default: 'en' })
  })

  it('covers every descriptor on the surface', () => {
    const schema = buildSettingsSchema()
    for (const descriptor of SETTINGS_SURFACE) {
      let node: JsonObject = schema
      for (const segment of descriptor.keyPath) {
        const child = (node['properties'] as JsonObject)[segment]
        expect(child, descriptor.keyPath.join('.')).toBeDefined()
        node = child as JsonObject
      }
    }
  })
})

describe('syncSettingsFiles', () => {
  it('writes the schema and creates a linked settings file', async () => {
    const dir = await tempDir()
    await syncSettingsFiles(dir)

    const schema = JSON.parse(await readFile(join(dir, 'settings.schema.json'), 'utf8')) as unknown
    expect(schema).toEqual(buildSettingsSchema())

    const settings = JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8')) as JsonObject
    expect(settings).toEqual({ $schema: './settings.schema.json' })
  })

  it('injects the schema reference while preserving comments and values', async () => {
    const dir = await tempDir()
    await writeFile(
      join(dir, 'settings.json'),
      '{\n  // bumped once\n  "editor": { "fontSize": 15 }\n}\n',
      'utf8'
    )
    await syncSettingsFiles(dir)

    const text = await readFile(join(dir, 'settings.json'), 'utf8')
    expect(text).toContain('// bumped once')
    expect(text).toContain('"fontSize": 15')
    const settings = parse(text, undefined, { allowTrailingComma: true }) as JsonObject
    expect(settings['$schema']).toBe('./settings.schema.json')
  })

  it('leaves a linked settings file untouched and keeps a custom reference', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'settings.json'), '{ "$schema": "./custom.json" }\n', 'utf8')
    await syncSettingsFiles(dir)
    await expect(readFile(join(dir, 'settings.json'), 'utf8')).resolves.toBe('{ "$schema": "./custom.json" }\n')
  })

  it('tolerates an empty settings file', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'settings.json'), '', 'utf8')
    await syncSettingsFiles(dir)
    const settings = JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8')) as JsonObject
    expect(settings['$schema']).toBe('./settings.schema.json')
  })
})

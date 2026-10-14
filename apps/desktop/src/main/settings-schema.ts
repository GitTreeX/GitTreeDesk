import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { applyEdits, modify, parse } from 'jsonc-parser'
import { SETTINGS_SURFACE, type SettingDescriptor } from '@gitreedesk/shared'
import { USER_SETTINGS_FILE } from '@gitreedesk/store'

export const SETTINGS_SCHEMA_FILE = 'settings.schema.json'

function leafSchema(descriptor: SettingDescriptor): Record<string, unknown> {
  switch (descriptor.type) {
    case 'enum':
      return { type: 'string', enum: [...descriptor.options], default: descriptor.default }
    case 'number':
      return { type: 'number', minimum: descriptor.min, maximum: descriptor.max, default: descriptor.default }
    case 'boolean':
      return { type: 'boolean', default: descriptor.default }
    case 'string':
      return {
        type: descriptor.nullable ? ['string', 'null'] : 'string',
        default: descriptor.default
      }
  }
}

/** Draft-07 schema for `settings.json`, generated from the shared settings surface. */
export function buildSettingsSchema(): Record<string, unknown> {
  const schema: Record<string, unknown> = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: 'GitTreeDesk settings',
    type: 'object',
    additionalProperties: true,
    properties: {}
  }
  const properties = schema['properties'] as Record<string, unknown>

  for (const descriptor of SETTINGS_SURFACE) {
    const segments = [...descriptor.keyPath]
    const last = segments.pop()
    if (last === undefined) continue

    let node = properties
    for (const segment of segments) {
      let child = node[segment]
      if (typeof child !== 'object' || child === null) {
        child = { type: 'object', additionalProperties: true, properties: {} }
        node[segment] = child
      }
      node = (child as { properties: Record<string, unknown> }).properties
    }
    node[last] = leafSchema(descriptor)
  }
  return schema
}

async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  const temp = join(dirname(filePath), `.${String(process.pid)}-${String(Date.now())}.tmp`)
  await writeFile(temp, content, 'utf8')
  await rename(temp, filePath)
}

async function readTextOrNull(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf8')
  } catch {
    return null
  }
}

/**
 * Regenerates the schema beside the user settings file and links it from the
 * settings file itself, preserving user comments and formatting.
 */
export async function syncSettingsFiles(userDataDir: string): Promise<void> {
  await writeFileAtomic(
    join(userDataDir, SETTINGS_SCHEMA_FILE),
    `${JSON.stringify(buildSettingsSchema(), null, 2)}\n`
  )

  const settingsPath = join(userDataDir, USER_SETTINGS_FILE)
  const text = await readTextOrNull(settingsPath)
  if (text === null) {
    await writeFileAtomic(settingsPath, `{\n  "$schema": "./${SETTINGS_SCHEMA_FILE}"\n}\n`)
    return
  }

  const value: unknown = parse(text.replace(/^\uFEFF/, ''), undefined, {
    allowTrailingComma: true,
    allowEmptyContent: true
  })
  if (value !== null && typeof value === 'object' && !Array.isArray(value) && '$schema' in value) return

  const edits = modify(text, ['$schema'], `./${SETTINGS_SCHEMA_FILE}`, {
    formattingOptions: { insertSpaces: true, tabSize: 2, eol: '\n' }
  })
  if (edits.length === 0) return
  const applied = applyEdits(text, edits)
  await writeFileAtomic(settingsPath, applied.endsWith('\n') ? applied : `${applied}\n`)
}

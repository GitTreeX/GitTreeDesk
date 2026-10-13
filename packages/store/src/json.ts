import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { applyEdits, modify, parse, printParseErrorCode, type ParseError } from 'jsonc-parser'

export interface JsonReadResult {
  /** Parsed value; `null` when the file is missing or unreadable. */
  value: unknown
  issues: string[]
}

function parseIssues(filePath: string, errors: ParseError[]): string[] {
  return errors.map(
    (error) => `Invalid JSON in ${filePath}: ${printParseErrorCode(error.error)} at offset ${String(error.offset)}`
  )
}

/** Reads user-authored JSONC (comments, trailing commas and BOM tolerated). */
export async function readJsonFile(filePath: string): Promise<JsonReadResult> {
  let text: string
  try {
    // jsonc-parser expects the caller to strip a byte-order mark.
    text = (await readFile(filePath, 'utf8')).replace(/^\uFEFF/, '')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { value: null, issues: [] }
    return { value: null, issues: [`Cannot read ${filePath}`] }
  }

  const errors: ParseError[] = []
  const value: unknown = parse(text, errors, { allowTrailingComma: true, allowEmptyContent: true })
  return { value: value ?? null, issues: parseIssues(filePath, errors) }
}

async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  const temp = join(dirname(filePath), `.${String(process.pid)}-${String(Date.now())}.tmp`)
  await writeFile(temp, content, 'utf8')
  await rename(temp, filePath)
}

/** App-owned JSON: a fresh serialization replaces the file atomically. */
export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await writeFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

async function readText(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, 'utf8')
  } catch {
    return '{}'
  }
}

async function applyValueEdit(filePath: string, keyPath: readonly string[], value: unknown): Promise<void> {
  const text = await readText(filePath)
  const edits = modify(text, [...keyPath], value, {
    formattingOptions: { insertSpaces: true, tabSize: 2, eol: '\n' }
  })
  if (edits.length === 0) return

  const applied = applyEdits(text, edits)
  if (applied === text) return
  const content = applied.endsWith('\n') ? applied : `${applied}\n`
  await writeFileAtomic(filePath, content)
}

/** Comment- and formatting-preserving single-value update for user-authored files. */
export async function setJsonValue(filePath: string, keyPath: readonly string[], value: unknown): Promise<void> {
  await applyValueEdit(filePath, keyPath, value)
}

export async function removeJsonValue(filePath: string, keyPath: readonly string[]): Promise<void> {
  await applyValueEdit(filePath, keyPath, undefined)
}

/** Walks a parsed JSON value by key path; `undefined` when any segment is missing. */
export function readKeyPath(value: unknown, keyPath: readonly string[]): unknown {
  let current: unknown = value
  for (const key of keyPath) {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

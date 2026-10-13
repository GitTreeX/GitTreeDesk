import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import type { FsFileKind, FsReadFileResponse } from '@gitreedesk/shared'

export interface ContentLimits {
  /** Sides at or below this size load without asking; beyond it the user confirms. */
  autoLimit: number
  /** Absolute ceiling; beyond it content is never loaded. */
  hardLimit: number
}

/** Diffs stay lightweight: hunks are small, and the viewer can ask for the full text. */
export const DIFF_LIMITS: ContentLimits = { autoLimit: 2 * 1024 * 1024, hardLimit: 20 * 1024 * 1024 }

/** The editor opens anything up to the read-only confirmation threshold directly. */
export const EDITOR_LIMITS: ContentLimits = { autoLimit: 10 * 1024 * 1024, hardLimit: 64 * 1024 * 1024 }

const IMAGE_LIMIT = 20 * 1024 * 1024

const IMAGE_MIME: Readonly<Record<string, string>> = Object.freeze({
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif'
})

export function imageMimeForPath(filePath: string): string | null {
  return IMAGE_MIME[path.extname(filePath).toLowerCase()] ?? null
}

/** Git's own heuristic: a NUL byte in the leading window means binary. */
function looksBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, 8000).includes(0)
}

export interface ContentClassification {
  kind: FsFileKind
  text: string | null
  dataUrl: string | null
}

export function classifyContent(
  buffer: Buffer,
  filePath: string,
  allowLarge: boolean,
  limits: ContentLimits
): ContentClassification {
  const mime = imageMimeForPath(filePath)
  if (mime !== null) {
    if (buffer.byteLength > IMAGE_LIMIT) return { kind: 'tooLarge', text: null, dataUrl: null }
    return { kind: 'image', text: null, dataUrl: `data:${mime};base64,${buffer.toString('base64')}` }
  }
  if (buffer.byteLength > limits.hardLimit || (buffer.byteLength > limits.autoLimit && !allowLarge)) {
    return { kind: 'tooLarge', text: null, dataUrl: null }
  }
  if (looksBinary(buffer)) return { kind: 'binary', text: null, dataUrl: null }
  return { kind: 'text', text: buffer.toString('utf8'), dataUrl: null }
}

/** Size threshold that decides whether `filePath` loads without an explicit user go-ahead. */
export function contentCapFor(filePath: string, allowLarge: boolean, limits: ContentLimits): number {
  if (imageMimeForPath(filePath) !== null) return IMAGE_LIMIT
  return allowLarge ? limits.hardLimit : limits.autoLimit
}

export async function readFileSnapshot(
  absolutePath: string,
  options: { allowLarge?: boolean; limits?: ContentLimits } = {}
): Promise<FsReadFileResponse> {
  const missing: FsReadFileResponse = {
    exists: false,
    kind: 'text',
    size: 0,
    mtimeMs: 0,
    text: null,
    dataUrl: null
  }
  let stats
  try {
    stats = await stat(absolutePath)
  } catch {
    return missing
  }
  if (!stats.isFile()) return missing

  const allowLarge = options.allowLarge === true
  const limits = options.limits ?? EDITOR_LIMITS
  const base = { exists: true, size: stats.size, mtimeMs: stats.mtimeMs }
  if (stats.size > contentCapFor(absolutePath, allowLarge, limits)) {
    return { ...base, kind: 'tooLarge', text: null, dataUrl: null }
  }
  const buffer = await readFile(absolutePath)
  return { ...base, ...classifyContent(buffer, absolutePath, allowLarge, limits) }
}

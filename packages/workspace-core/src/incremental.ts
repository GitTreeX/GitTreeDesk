import type { RepoRecord } from '@gitreedesk/shared'
import { linkRecordParents } from './discovery'
import { recordKey } from './registry'

const toPosix = (value: string): string => value.replace(/\\/g, '/')

function isInside(scopePosix: string, pathPosix: string): boolean {
  return pathPosix === scopePosix || pathPosix.startsWith(`${scopePosix}/`)
}

/**
 * Overlays the records of a scoped scan onto the current registry contents:
 * records outside the scanned subtree survive untouched, records inside it are
 * replaced by the scan result. Parent links are rebuilt across the merged set
 * because a parent may live outside the scanned subtree — or have disappeared
 * with it. Returns a new list; the inputs are not mutated.
 */
export function mergeScopedRecords(
  current: readonly RepoRecord[],
  scoped: readonly RepoRecord[],
  scopeDir: string
): RepoRecord[] {
  const scopePosix = toPosix(scopeDir)
  const merged = new Map<string, RepoRecord>()

  for (const record of current) {
    if (isInside(scopePosix, toPosix(record.path))) continue
    merged.set(recordKey(record), { ...record })
  }
  for (const record of scoped) {
    merged.set(recordKey(record), { ...record })
  }

  const records = [...merged.values()]
  for (const record of records) record.parentId = null
  linkRecordParents(records)
  records.sort((a, b) => a.relPath.localeCompare(b.relPath))
  return records
}

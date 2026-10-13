export interface PatchHunk {
  /** Zero-based position of the hunk inside the patch. */
  index: number
  /** First line of the new side, 1-based; insertions in an empty hunk report the previous line. */
  newStart: number
  newCount: number
  /** The `@@ … @@` header line. */
  header: string
  /** Hunk body: context, addition and deletion lines. */
  lines: string[]
}

export interface ParsedPatch {
  /** Everything above the first hunk: diff header, index line, --- / +++ paths. */
  header: string[]
  hunks: PatchHunk[]
  /** A trailing-newline-terminated form of the original patch. */
  text: string
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

export function parsePatch(patch: string): ParsedPatch {
  if (patch.length === 0) return { header: [], hunks: [], text: '' }
  const text = patch.endsWith('\n') ? patch : `${patch}\n`
  const header: string[] = []
  const hunks: PatchHunk[] = []
  let current: PatchHunk | null = null
  for (const line of text.split('\n')) {
    if (line.startsWith('@@')) {
      const match = HUNK_HEADER.exec(line)
      current = {
        index: hunks.length,
        newStart: match === null ? 1 : Number.parseInt(match[3] ?? '1', 10),
        newCount: match === null || match[4] === undefined ? 1 : Number.parseInt(match[4], 10),
        header: line,
        lines: []
      }
      hunks.push(current)
      continue
    }
    if (current === null) header.push(line)
    else current.lines.push(line)
  }
  // split('\n') leaves the empty tail of the trailing newline in the last hunk.
  const last = hunks[hunks.length - 1]
  if (last !== undefined && last.lines[last.lines.length - 1] === '') last.lines.pop()
  return { header, hunks, text }
}

/**
 * Rebuilds a single-hunk patch that `git apply` accepts: the file header, one
 * `@@` block, and a terminating newline.
 */
export function singleHunkPatch(parsed: ParsedPatch, index: number): string | null {
  const hunk = parsed.hunks[index]
  if (hunk === undefined) return null
  const lines = [...parsed.header, hunk.header, ...hunk.lines]
  const joined = lines.join('\n')
  return joined.endsWith('\n') ? joined : `${joined}\n`
}

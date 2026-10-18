export type PatchLineKind = 'context' | 'add' | 'delete' | 'meta'

export interface PatchLine {
  kind: PatchLineKind
  /** The body line exactly as the patch carries it, prefix included. */
  text: string
  /** 1-based position on the from side, or null when the line is absent there. */
  oldLine: number | null
  /** 1-based position on the to side, or null when the line is absent there. */
  newLine: number | null
}

export interface PatchHunk {
  /** Zero-based position of the hunk inside the patch. */
  index: number
  /** First line of the from side, 1-based; a count of 0 reports the preceding line. */
  oldStart: number
  oldCount: number
  /** First line of the to side, 1-based; a count of 0 reports the preceding line. */
  newStart: number
  newCount: number
  /** The `@@ … @@` header line. */
  header: string
  lines: PatchLine[]
}

export interface ParsedPatch {
  /** Everything above the first hunk: diff header, index line, --- / +++ paths. */
  header: string[]
  hunks: PatchHunk[]
  /** A trailing-newline-terminated form of the original patch. */
  text: string
}

/**
 * Which side of the patch the file being modified matches: `old` when the change is
 * applied forward (the file still holds the from side), `new` when it is applied in
 * reverse (the file already holds the to side).
 */
export type PatchSide = 'old' | 'new'

export interface SingleLinePatch {
  patch: string
  /** True when the rebuilt hunk has no context line at all, needing `--unidiff-zero`. */
  zeroContext: boolean
}

/** A changed line located inside the parsed patch. */
export interface LineTarget {
  hunkIndex: number
  lineIndex: number
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/
/** Neighbouring lines carried into a single-line hunk; matches the reader's `--unified=3`. */
const LINE_CONTEXT = 3

function countOf(raw: string | undefined): number {
  if (raw === undefined) return 1
  const parsed = Number.parseInt(raw, 10)
  return Number.isNaN(parsed) ? 1 : parsed
}

function kindOf(line: string): PatchLineKind {
  if (line.startsWith('\\')) return 'meta'
  if (line.startsWith('+')) return 'add'
  if (line.startsWith('-')) return 'delete'
  return 'context'
}

export function parsePatch(patch: string): ParsedPatch {
  if (patch.length === 0) return { header: [], hunks: [], text: '' }
  const text = patch.endsWith('\n') ? patch : `${patch}\n`
  const header: string[] = []
  const hunks: PatchHunk[] = []
  let current: PatchHunk | null = null
  /** Next unread line number on each side of the hunk being read. */
  let oldCursor = 0
  let newCursor = 0
  for (const raw of text.split('\n')) {
    if (raw.startsWith('@@')) {
      const match = HUNK_HEADER.exec(raw)
      current = {
        index: hunks.length,
        oldStart: match === null ? 1 : Number.parseInt(match[1] ?? '1', 10),
        oldCount: match === null ? 1 : countOf(match[2]),
        newStart: match === null ? 1 : Number.parseInt(match[3] ?? '1', 10),
        newCount: match === null ? 1 : countOf(match[4]),
        header: raw,
        lines: []
      }
      hunks.push(current)
      oldCursor = current.oldStart
      newCursor = current.newStart
      continue
    }
    if (current === null) {
      header.push(raw)
      continue
    }
    const kind = kindOf(raw)
    const line: PatchLine = { kind, text: raw, oldLine: null, newLine: null }
    if (kind === 'context' || kind === 'delete') {
      line.oldLine = oldCursor
      oldCursor += 1
    }
    if (kind === 'context' || kind === 'add') {
      line.newLine = newCursor
      newCursor += 1
    }
    current.lines.push(line)
  }
  // split('\n') leaves the empty tail of the trailing newline in the last hunk.
  const last = hunks[hunks.length - 1]
  if (last !== undefined && last.lines[last.lines.length - 1]?.text === '') last.lines.pop()
  return { header, hunks, text }
}

/**
 * Rebuilds a single-hunk patch that `git apply` accepts: the file header, one
 * `@@` block, and a terminating newline.
 */
export function singleHunkPatch(parsed: ParsedPatch, index: number): string | null {
  const hunk = parsed.hunks[index]
  if (hunk === undefined) return null
  const lines = [...parsed.header, hunk.header, ...hunk.lines.map((line) => line.text)]
  const joined = lines.join('\n')
  return joined.endsWith('\n') ? joined : `${joined}\n`
}

/** The line number directly above the window on one side of the hunk. */
function anchorBefore(hunk: PatchHunk, lineIndex: number, side: PatchSide): number {
  for (let i = lineIndex - 1; i >= 0; i -= 1) {
    const line = hunk.lines[i]
    if (line === undefined) continue
    const position = side === 'old' ? line.oldLine : line.newLine
    if (position !== null) return position
  }
  const start = side === 'old' ? hunk.oldStart : hunk.newStart
  const count = side === 'old' ? hunk.oldCount : hunk.newCount
  return count === 0 ? start : start - 1
}

/** Lines that survive untouched on the side being modified, so they can serve as context. */
function isNeighbour(line: PatchLine, side: PatchSide): boolean {
  if (line.kind === 'context') return true
  return side === 'old' ? line.kind === 'delete' : line.kind === 'add'
}

function isKind(line: PatchLine | undefined, kind: PatchLineKind): boolean {
  return line !== undefined && line.kind === kind
}

/** Marker-aware lookups: a `\ No newline` line sticks to the changed line before it. */
function changedBefore(hunk: PatchHunk, index: number, kind: PatchLineKind): number | null {
  if (isKind(hunk.lines[index - 1], kind)) return index - 1
  if (isKind(hunk.lines[index - 1], 'meta') && isKind(hunk.lines[index - 2], kind)) return index - 2
  return null
}

function changedAfter(hunk: PatchHunk, index: number, kind: PatchLineKind): number | null {
  if (isKind(hunk.lines[index + 1], kind)) return index + 1
  if (isKind(hunk.lines[index + 1], 'meta') && isKind(hunk.lines[index + 2], kind)) return index + 2
  return null
}

/**
 * The change one dot acts on: a new line stands in for the old lines it replaced, and git keeps no
 * context between them, so they can only be staged, unstaged or reverted together.
 */
function changeBlock(hunk: PatchHunk, lineIndex: number): { start: number; end: number } {
  let start = lineIndex
  let end = lineIndex
  const target = hunk.lines[lineIndex]
  if (target === undefined) return { start, end }
  for (;;) {
    const before = isKind(target, 'add') ? changedBefore(hunk, start, 'delete') : null
    if (before === null) break
    start = before
  }
  for (;;) {
    const after = isKind(target, 'delete') ? changedAfter(hunk, end, 'add') : null
    if (after === null) break
    end = after
  }
  return { start, end }
}

/** Path token of a `--- ` / `+++ ` header line, or null when it is `/dev/null`. */
function sideToken(header: readonly string[], marker: '---' | '+++'): string | null {
  const line = header.find((candidate) => candidate.startsWith(`${marker} `))
  if (line === undefined) return null
  const token = line.slice(marker.length + 1)
  return token === '/dev/null' ? null : token
}

/** Moves a path token from one side of the diff to the other, keeping any quoting. */
function flipToken(token: string, prefix: 'a' | 'b'): string {
  if (token.startsWith(`"${prefix === 'a' ? 'b' : 'a'}/`)) return `"${prefix}/${token.slice(3)}`
  if (token.startsWith(`${prefix === 'a' ? 'b' : 'a'}/`)) return `${prefix}/${token.slice(2)}`
  return `${prefix}/${token}`
}

/** Metadata that only describes whole-file creation, deletion, renames and mode changes. */
const FILE_LEVEL_HEADER =
  /^(new file mode|deleted file mode|old mode|new mode|rename (from|to)|copy (from|to)|similarity index|dissimilarity index|index )/

/**
 * A single line edits a file that exists on the side being modified, so the rebuilt
 * patch cannot carry creation, deletion, rename or mode metadata.
 */
function fileHeader(parsed: ParsedPatch, side: PatchSide): string[] | null {
  const from = sideToken(parsed.header, '---')
  const to = sideToken(parsed.header, '+++')
  // The side being modified must already hold the file.
  if (side === 'old' ? from === null : to === null) return null
  const other = from ?? to
  const out: string[] = []
  for (const line of parsed.header) {
    if (FILE_LEVEL_HEADER.test(line)) continue
    if (line.startsWith('--- ')) {
      out.push(`--- ${from ?? flipToken(other ?? '', 'a')}`)
      continue
    }
    if (line.startsWith('+++ ')) {
      out.push(`+++ ${to ?? flipToken(other ?? '', 'b')}`)
      continue
    }
    out.push(line)
  }
  return out
}

/**
 * Builds the smallest hunk that stages, unstages or reverts one changed line: the whole change
 * block that line belongs to, wrapped in the neighbouring lines the modified side already holds.
 */
export function singleLinePatch(
  parsed: ParsedPatch,
  hunkIndex: number,
  lineIndex: number,
  side: PatchSide
): SingleLinePatch | null {
  const hunk = parsed.hunks[hunkIndex]
  const target = hunk?.lines[lineIndex]
  if (hunk === undefined || target === undefined) return null
  if (target.kind !== 'add' && target.kind !== 'delete') return null
  const fileLines = fileHeader(parsed, side)
  if (fileLines === null) return null

  const block = changeBlock(hunk, lineIndex)
  let from = block.start
  let to = block.end
  while (from > 0 && block.start - from < LINE_CONTEXT) {
    const above = hunk.lines[from - 1]
    if (above === undefined || !isNeighbour(above, side)) break
    from -= 1
  }
  while (to + 1 < hunk.lines.length && to - block.end < LINE_CONTEXT) {
    const below = hunk.lines[to + 1]
    if (below === undefined || !isNeighbour(below, side)) break
    to += 1
  }

  /* Inside the block each line keeps its own side; outside it only lines both sides share remain. */
  const body: string[] = []
  let oldCount = 0
  let newCount = 0
  let shared = 0
  for (let index = from; index <= to; index += 1) {
    const line = hunk.lines[index]
    if (line === undefined || line.kind === 'meta') continue
    const own = index >= block.start && index <= block.end
    if (!own && line.kind !== 'context') {
      body.push(` ${line.text.slice(1)}`)
      oldCount += 1
      newCount += 1
      shared += 1
      continue
    }
    body.push(line.text)
    if (line.kind === 'add') {
      newCount += 1
      continue
    }
    if (line.kind === 'delete') {
      oldCount += 1
      continue
    }
    oldCount += 1
    newCount += 1
    shared += 1
  }
  // A trailing "\ No newline at end of file" marker belongs to the last line of the block.
  const marker = hunk.lines[to + 1]
  if (marker !== undefined && marker.kind === 'meta' && to === block.end) body.push(marker.text)

  const anchor = anchorBefore(hunk, from, side)
  const oldStart = oldCount === 0 ? anchor : anchor + 1
  const newStart = newCount === 0 ? anchor : anchor + 1

  const header = `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`
  const joined = [...fileLines, header, ...body].join('\n')
  return {
    patch: joined.endsWith('\n') ? joined : `${joined}\n`,
    zeroContext: shared === 0
  }
}

/** Every changed line on one side of the patch, keyed by its line number in that side's file. */
export function changedLines(parsed: ParsedPatch, side: PatchSide): Map<number, LineTarget> {
  const map = new Map<number, LineTarget>()
  for (const hunk of parsed.hunks) {
    for (const [lineIndex, line] of hunk.lines.entries()) {
      const wanted = side === 'old' ? 'delete' : 'add'
      if (line.kind !== wanted) continue
      const position = side === 'old' ? line.oldLine : line.newLine
      if (position === null) continue
      map.set(position, { hunkIndex: hunk.index, lineIndex })
    }
  }
  return map
}

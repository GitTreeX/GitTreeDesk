export type ConflictSide = 'ours' | 'theirs' | 'both'

/** One `<<<<<<< … >>>>>>>` block inside a file with conflict markers. */
export interface ConflictSection {
  /** Offset of the opening marker line. */
  start: number
  /** Offset just past the closing marker line (newline included). */
  end: number
  /** Side between the opening marker and the divider, newline-terminated. */
  ours: string
  /** Base between `|||||||` and the divider; `null` without a diff3 section. */
  base: string | null
  /** Side between the divider and the closing marker. */
  theirs: string
}

interface OpenSection {
  start: number
  ours: string[]
  base: string[] | null
  theirs: string[]
  phase: 'ours' | 'base' | 'theirs'
}

/**
 * Finds the conflict marker blocks of a file. Marker lines inside a section are
 * treated as content unless they appear in the phase where git would write them,
 * so nested lookalikes in code do not confuse the scan.
 */
export function findConflictSections(text: string): ConflictSection[] {
  const sections: ConflictSection[] = []
  let open: OpenSection | null = null
  let offset = 0

  while (offset <= text.length) {
    const newline = text.indexOf('\n', offset)
    const lineEnd = newline === -1 ? text.length : newline + 1
    const line = text.slice(offset, lineEnd)

    if (open === null) {
      if (line.startsWith('<<<<<<<')) {
        open = { start: offset, ours: [], base: null, theirs: [], phase: 'ours' }
      }
    } else if (line.startsWith('|||||||') && open.phase === 'ours') {
      open.phase = 'base'
      open.base = []
    } else if (line.startsWith('=======') && open.phase !== 'theirs') {
      open.phase = 'theirs'
    } else if (line.startsWith('>>>>>>>') && open.phase === 'theirs') {
      sections.push({
        start: open.start,
        end: lineEnd,
        ours: open.ours.join(''),
        base: open.base === null ? null : open.base.join(''),
        theirs: open.theirs.join('')
      })
      open = null
    } else if (open.phase === 'ours') {
      open.ours.push(line)
    } else if (open.phase === 'base') {
      open.base?.push(line)
    } else {
      open.theirs.push(line)
    }

    if (newline === -1) break
    offset = lineEnd
  }

  return sections
}

/** Replaces one section with the chosen side; `both` keeps ours then theirs. */
export function applyConflictResolution(
  text: string,
  section: ConflictSection,
  side: ConflictSide
): string {
  const replacement = sectionText(section, side)
  return text.slice(0, section.start) + replacement + text.slice(section.end)
}

/** Resolves every section in one pass, keeping the surrounding text intact. */
export function resolveConflictText(text: string, side: ConflictSide): string {
  const sections = findConflictSections(text)
  if (sections.length === 0) return text

  let result = ''
  let cursor = 0
  for (const section of sections) {
    result += text.slice(cursor, section.start)
    result += sectionText(section, side)
    cursor = section.end
  }
  return result + text.slice(cursor)
}

function sectionText(section: ConflictSection, side: ConflictSide): string {
  if (side === 'ours') return section.ours
  if (side === 'theirs') return section.theirs
  return section.ours + section.theirs
}

/** A standard git conflict hunk; all line numbers are 1-based and inclusive. */
export interface ConflictHunk {
  /** The `<<<<<<<` line. */
  startLine: number
  oursStart: number
  oursEnd: number
  /** The `=======` line. */
  sepLine: number
  theirsStart: number
  theirsEnd: number
  /** The `>>>>>>>` line. */
  endLine: number
  /** Whether a `|||||||` base section (diff3 style) is present. */
  hasBase: boolean
  baseStart: number
  baseEnd: number
  /** Label after the ours marker, e.g. `HEAD`; empty when the marker has none. */
  oursLabel: string
  /** Label after the theirs marker, e.g. a branch name. */
  theirsLabel: string
}

export type ConflictChoice = 'ours' | 'theirs' | 'both'

const OURS = '<<<<<<<'
const BASE = '|||||||'
const SEP = '======='
const THEIRS = '>>>>>>>'

/** The label on a `<<<<<<<` / `|||||||` / `>>>>>>>` marker line, or null when the line is not one. */
function labelAt(line: string, marker: string): string | null {
  if (!line.startsWith(marker)) return null
  const rest = line.slice(marker.length)
  if (rest === '') return ''
  if (!rest.startsWith(' ')) return null
  return rest.slice(1).trim()
}

/**
 * Finds conflict hunks in a file's lines. Marker lines must match git's own
 * output; malformed sequences are skipped rather than guessed at, so no action
 * is ever offered on text that only looks conflict-like.
 */
export function findConflictHunks(lines: readonly string[]): ConflictHunk[] {
  const hunks: ConflictHunk[] = []
  let startLine: number | null = null
  let oursLabel = ''
  let baseLine: number | null = null
  let sepLine: number | null = null

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    const lineNumber = index + 1

    const foundOurs = labelAt(line, OURS)
    if (foundOurs !== null) {
      startLine = lineNumber
      oursLabel = foundOurs
      baseLine = null
      sepLine = null
      continue
    }
    if (startLine === null) continue

    if (line === SEP) {
      if (sepLine !== null) startLine = null
      else sepLine = lineNumber
      continue
    }

    const foundTheirs = labelAt(line, THEIRS)
    if (foundTheirs !== null) {
      if (sepLine !== null) {
        hunks.push({
          startLine,
          oursStart: startLine + 1,
          oursEnd: (baseLine ?? sepLine) - 1,
          sepLine,
          theirsStart: sepLine + 1,
          theirsEnd: lineNumber - 1,
          endLine: lineNumber,
          hasBase: baseLine !== null,
          baseStart: baseLine === null ? 0 : baseLine + 1,
          baseEnd: baseLine === null ? 0 : sepLine - 1,
          oursLabel,
          theirsLabel: foundTheirs
        })
      }
      startLine = null
      continue
    }

    if (sepLine !== null) continue

    if (labelAt(line, BASE) !== null) {
      if (baseLine !== null) startLine = null
      else baseLine = lineNumber
    }
  }

  return hunks
}

/** The content lines that replace a hunk when it is resolved to `choice`. */
export function resolvedLines(
  lines: readonly string[],
  hunk: ConflictHunk,
  choice: ConflictChoice
): string[] {
  const ours = lines.slice(hunk.oursStart - 1, hunk.oursEnd)
  const theirs = lines.slice(hunk.theirsStart - 1, hunk.theirsEnd)
  if (choice === 'ours') return ours
  if (choice === 'theirs') return theirs
  const identical = ours.length === theirs.length && ours.every((line, index) => line === theirs[index])
  return identical ? ours : [...ours, ...theirs]
}

/** The full file lines with `hunk` resolved to `choice`, everything else untouched. */
export function applyConflictChoice(
  lines: readonly string[],
  hunk: ConflictHunk,
  choice: ConflictChoice
): string[] {
  return [
    ...lines.slice(0, hunk.startLine - 1),
    ...resolvedLines(lines, hunk, choice),
    ...lines.slice(hunk.endLine)
  ]
}

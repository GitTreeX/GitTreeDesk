import { describe, expect, it } from 'vitest'
import { changedLines, parsePatch, singleHunkPatch, singleLinePatch } from '../src/renderer/src/editor/patch'

/** `git diff --unified=3` for a 8-line file: one modified line and one inserted line. */
const PATCH = [
  'diff --git a/lines.txt b/lines.txt',
  'index 1111111..2222222 100644',
  '--- a/lines.txt',
  '+++ b/lines.txt',
  '@@ -2,6 +2,7 @@',
  ' two',
  '-three',
  '+THREE',
  ' four',
  ' five',
  '+new',
  ' six',
  ' seven',
  ''
].join('\n')

/** A one-line patch edits an existing file, so the rebuilt header drops file-level metadata. */
const FILE_HEADER = ['diff --git a/lines.txt b/lines.txt', '--- a/lines.txt', '+++ b/lines.txt']

/** The changed-line body index of each interesting line in the sample patch. */
const AT = { two: 0, three: 1, THREE: 2, four: 3, five: 4, added: 5, six: 6, seven: 7 } as const

describe('parsePatch', () => {
  it('numbers every body line on both sides', () => {
    const lines = parsePatch(PATCH).hunks[0]?.lines
    expect(lines).toBeDefined()
    expect(lines?.map((line) => [line.kind, line.oldLine, line.newLine])).toEqual([
      ['context', 2, 2],
      ['delete', 3, null],
      ['add', null, 3],
      ['context', 4, 4],
      ['context', 5, 5],
      ['add', null, 6],
      ['context', 6, 7],
      ['context', 7, 8]
    ])
  })

  it('keeps the hunk counts from the header', () => {
    const hunk = parsePatch(PATCH).hunks[0]
    expect(hunk?.oldStart).toBe(2)
    expect(hunk?.oldCount).toBe(6)
    expect(hunk?.newStart).toBe(2)
    expect(hunk?.newCount).toBe(7)
  })

  it('reports a round-tripped hunk unchanged', () => {
    expect(singleHunkPatch(parsePatch(PATCH), 0)).toBe(PATCH)
  })

  it('reads a zero-count header as the preceding line', () => {
    const hunk = parsePatch([...FILE_HEADER, '@@ -3,0 +4,2 @@', '+a', '+b', ''].join('\n')).hunks[0]
    expect(hunk?.oldCount).toBe(0)
    expect(hunk?.lines.map((line) => [line.oldLine, line.newLine])).toEqual([
      [null, 4],
      [null, 5]
    ])
  })
})

describe('singleLinePatch against the from side', () => {
  it('stages a modified line by replacing the line it changed', () => {
    const result = singleLinePatch(parsePatch(PATCH), 0, AT.THREE, 'old')
    expect(result?.patch).toBe(
      [...FILE_HEADER, '@@ -2,4 +2,4 @@', ' two', '-three', '+THREE', ' four', ' five', ''].join('\n')
    )
    expect(result?.zeroContext).toBe(false)
  })

  it('stages an inserted line without the change above it', () => {
    const result = singleLinePatch(parsePatch(PATCH), 0, AT.added, 'old')
    expect(result?.patch).toBe(
      [...FILE_HEADER, '@@ -4,4 +4,5 @@', ' four', ' five', '+new', ' six', ' seven', ''].join('\n')
    )
  })

  it('acts on the same replacement from the deleted side of it', () => {
    const fromAdd = singleLinePatch(parsePatch(PATCH), 0, AT.THREE, 'old')
    const fromDelete = singleLinePatch(parsePatch(PATCH), 0, AT.three, 'old')
    expect(fromDelete?.patch).toBe(fromAdd?.patch)
  })

  it('skips context lines and missing indexes', () => {
    const parsed = parsePatch(PATCH)
    expect(singleLinePatch(parsed, 0, AT.four, 'old')).toBeNull()
    expect(singleLinePatch(parsed, 0, 99, 'old')).toBeNull()
    expect(singleLinePatch(parsed, 7, AT.THREE, 'old')).toBeNull()
  })
})

describe('singleLinePatch against the to side', () => {
  it('reverts an inserted line and keeps the sibling addition as context', () => {
    const result = singleLinePatch(parsePatch(PATCH), 0, AT.added, 'new')
    expect(result?.patch).toBe(
      [...FILE_HEADER, '@@ -3,5 +3,6 @@', ' THREE', ' four', ' five', '+new', ' six', ' seven', ''].join('\n')
    )
  })

  it('reverts a replacement back to the line it replaced', () => {
    const result = singleLinePatch(parsePatch(PATCH), 0, AT.THREE, 'new')
    expect(result?.patch).toBe(
      [...FILE_HEADER, '@@ -2,5 +2,5 @@', ' two', '-three', '+THREE', ' four', ' five', ' new', ''].join('\n')
    )
  })

  it('acts on the same replacement from the deleted side of it', () => {
    const fromAdd = singleLinePatch(parsePatch(PATCH), 0, AT.THREE, 'new')
    const fromDelete = singleLinePatch(parsePatch(PATCH), 0, AT.three, 'new')
    expect(fromDelete?.patch).toBe(fromAdd?.patch)
  })
})

describe('singleLinePatch without context', () => {
  const bare = parsePatch([...FILE_HEADER, '@@ -3,0 +4,2 @@', '+a', '+b', ''].join('\n'))

  it('asks for --unidiff-zero when the patch shares no line', () => {
    const result = singleLinePatch(bare, 0, 0, 'old')
    expect(result?.zeroContext).toBe(true)
    expect(result?.patch).toBe([...FILE_HEADER, '@@ -3,0 +4,1 @@', '+a', ''].join('\n'))
  })

  it('keeps a sibling deletion as context instead of staging it too', () => {
    const parsed = parsePatch([...FILE_HEADER, '@@ -4,2 +5,0 @@', '-a', '-b', ''].join('\n'))
    const result = singleLinePatch(parsed, 0, 1, 'old')
    expect(result?.zeroContext).toBe(false)
    expect(result?.patch).toBe([...FILE_HEADER, '@@ -4,2 +4,1 @@', ' a', '-b', ''].join('\n'))
  })

  it('keeps a replacement together, needing --unidiff-zero in a file of its own', () => {
    const parsed = parsePatch([...FILE_HEADER, '@@ -4,1 +4,1 @@', '-a', '+b', ''].join('\n'))
    const result = singleLinePatch(parsed, 0, 0, 'old')
    expect(result?.zeroContext).toBe(true)
    expect(result?.patch).toBe([...FILE_HEADER, '@@ -4,1 +4,1 @@', '-a', '+b', ''].join('\n'))
  })

  it('carries a no-newline marker along with the line it annotates', () => {
    const parsed = parsePatch(
      [...FILE_HEADER, '@@ -1,2 +1,2 @@', ' a', '-b', '+c', '\\ No newline at end of file', ''].join('\n')
    )
    const result = singleLinePatch(parsed, 0, 2, 'old')
    expect(result?.patch).toBe(
      [...FILE_HEADER, '@@ -1,2 +1,2 @@', ' a', '-b', '+c', '\\ No newline at end of file', ''].join('\n')
    )
  })
})

describe('singleLinePatch file headers', () => {
  const created = parsePatch(
    [
      'diff --git a/fresh.txt b/fresh.txt',
      'new file mode 100644',
      'index 0000000..f9d9a01',
      '--- /dev/null',
      '+++ b/fresh.txt',
      '@@ -0,0 +1,3 @@',
      '+a',
      '+b',
      '+c',
      ''
    ].join('\n')
  )

  it('drops creation metadata and names both sides of the file', () => {
    const result = singleLinePatch(created, 0, 1, 'new')
    expect(result?.patch).toBe(
      [
        'diff --git a/fresh.txt b/fresh.txt',
        '--- a/fresh.txt',
        '+++ b/fresh.txt',
        '@@ -1,2 +1,3 @@',
        ' a',
        '+b',
        ' c',
        ''
      ].join('\n')
    )
  })

  it('refuses a line on a side where the file does not exist yet', () => {
    expect(singleLinePatch(created, 0, 1, 'old')).toBeNull()
  })

  it('refuses to revert a line back into a file the side no longer has', () => {
    const removed = parsePatch(
      [
        'diff --git a/gone.txt b/gone.txt',
        'deleted file mode 100644',
        'index f9d9a01..0000000',
        '--- a/gone.txt',
        '+++ /dev/null',
        '@@ -1,3 +0,0 @@',
        '-a',
        '-b',
        '-c',
        ''
      ].join('\n')
    )
    expect(singleLinePatch(removed, 0, 1, 'new')).toBeNull()
    const staged = singleLinePatch(removed, 0, 1, 'old')
    expect(staged?.patch).toContain('+++ b/gone.txt')
  })
})

describe('changedLines', () => {
  it('indexes additions by their line on the to side', () => {
    const map = changedLines(parsePatch(PATCH), 'new')
    expect([...map.entries()]).toEqual([
      [3, { hunkIndex: 0, lineIndex: AT.THREE }],
      [6, { hunkIndex: 0, lineIndex: AT.added }]
    ])
  })

  it('indexes deletions by their line on the from side', () => {
    expect(changedLines(parsePatch(PATCH), 'old').get(3)).toEqual({ hunkIndex: 0, lineIndex: AT.three })
  })
})

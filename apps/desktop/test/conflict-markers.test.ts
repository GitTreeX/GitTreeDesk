import { describe, expect, it } from 'vitest'
import {
  applyConflictChoice,
  findConflictHunks,
  resolvedLines,
  type ConflictChoice
} from '../src/renderer/src/editor/conflict-markers'

const MERGE = [
  'prefix',
  '<<<<<<< HEAD',
  'our line',
  '=======',
  'their line',
  '>>>>>>> feature/login',
  'suffix'
]

const DIFF3 = [
  '<<<<<<< HEAD',
  'our line',
  '||||||| merged common ancestors',
  'base line',
  '=======',
  'their line',
  '>>>>>>> feature/login'
]

describe('findConflictHunks', () => {
  it('finds a standard merge hunk with labels and section ranges', () => {
    const hunks = findConflictHunks(MERGE)
    expect(hunks).toEqual([
      {
        startLine: 2,
        oursStart: 3,
        oursEnd: 3,
        sepLine: 4,
        theirsStart: 5,
        theirsEnd: 5,
        endLine: 6,
        hasBase: false,
        baseStart: 0,
        baseEnd: 0,
        oursLabel: 'HEAD',
        theirsLabel: 'feature/login'
      }
    ])
  })

  it('carries the base section of a diff3 hunk', () => {
    const hunks = findConflictHunks(DIFF3)
    expect(hunks).toHaveLength(1)
    const hunk = hunks[0]
    expect(hunk?.hasBase).toBe(true)
    expect(hunk?.oursStart).toBe(2)
    expect(hunk?.oursEnd).toBe(2)
    expect(hunk?.baseStart).toBe(4)
    expect(hunk?.baseEnd).toBe(4)
    expect(hunk?.theirsStart).toBe(6)
  })

  it('finds multiple hunks in order', () => {
    const hunks = findConflictHunks([
      '<<<<<<< HEAD',
      'a',
      '=======',
      'b',
      '>>>>>>> br',
      'between',
      '<<<<<<< HEAD',
      'c',
      '=======',
      'd',
      '>>>>>>> br'
    ])
    expect(hunks.map((hunk) => hunk.startLine)).toEqual([1, 7])
  })

  it('accepts empty sides', () => {
    const oursEmpty = findConflictHunks(['<<<<<<< HEAD', '=======', 'theirs', '>>>>>>> br'])
    expect(oursEmpty[0]?.oursEnd).toBe(1)
    const theirsEmpty = findConflictHunks(['<<<<<<< HEAD', 'ours', '=======', '>>>>>>> br'])
    expect(theirsEmpty[0]?.theirsEnd).toBe(3)
  })

  it('accepts marker lines without labels', () => {
    const hunks = findConflictHunks(['<<<<<<<', 'a', '=======', 'b', '>>>>>>>'])
    expect(hunks).toHaveLength(1)
    expect(hunks[0]?.oursLabel).toBe('')
    expect(hunks[0]?.theirsLabel).toBe('')
  })

  it('ignores an unclosed marker at the end of the file', () => {
    expect(findConflictHunks(['<<<<<<< HEAD', 'a', '=======', 'b'])).toEqual([])
  })

  it('recovers a complete hunk after an unclosed one', () => {
    const hunks = findConflictHunks([
      '<<<<<<< HEAD',
      'stray',
      '<<<<<<< HEAD',
      'a',
      '=======',
      'b',
      '>>>>>>> br'
    ])
    expect(hunks).toHaveLength(1)
    expect(hunks[0]?.startLine).toBe(3)
  })

  it('ignores separator-like and closing lines outside a hunk', () => {
    expect(findConflictHunks(['=======', '>>>>>>> br', 'text'])).toEqual([])
  })

  it('does not treat longer marker runs or glued labels as markers', () => {
    expect(findConflictHunks(['<<<<<<<< HEAD', 'a', '=======', 'b', '>>>>>>> br'])).toEqual([])
    expect(findConflictHunks(['<<<<<<<HEAD', 'a', '=======', 'b', '>>>>>>> br'])).toEqual([])
  })

  it('requires the separator to be exactly seven equals signs', () => {
    expect(findConflictHunks(['<<<<<<< HEAD', 'a', '======= extra', 'b', '>>>>>>> br'])).toEqual([])
  })

  it('drops a hunk with two separators rather than guessing which is real', () => {
    expect(findConflictHunks(['<<<<<<< HEAD', 'a', '=======', 'b', '=======', 'c', '>>>>>>> br'])).toEqual([])
  })

  it('treats marker-like lines inside the incoming section as content', () => {
    const hunks = findConflictHunks([
      '<<<<<<< HEAD',
      'a',
      '=======',
      '||||||| not a base',
      'b',
      '>>>>>>> br'
    ])
    expect(hunks).toHaveLength(1)
    expect(hunks[0]?.theirsStart).toBe(4)
    expect(hunks[0]?.theirsEnd).toBe(5)
  })
})

describe('resolvedLines', () => {
  const hunk = findConflictHunks(MERGE)[0]
  const asChoice = (choice: ConflictChoice): string[] => {
    if (hunk === undefined) throw new Error('fixture did not parse')
    return resolvedLines(MERGE, hunk, choice)
  }

  it('returns each side for ours and theirs', () => {
    expect(asChoice('ours')).toEqual(['our line'])
    expect(asChoice('theirs')).toEqual(['their line'])
  })

  it('concatenates both sides for both', () => {
    expect(asChoice('both')).toEqual(['our line', 'their line'])
  })

  it('does not duplicate identical sides for both', () => {
    const lines = ['<<<<<<< HEAD', 'same', '=======', 'same', '>>>>>>> br']
    const parsed = findConflictHunks(lines)[0]
    if (parsed === undefined) throw new Error('fixture did not parse')
    expect(resolvedLines(lines, parsed, 'both')).toEqual(['same'])
  })

  it('resolves an empty side to no lines', () => {
    const lines = ['<<<<<<< HEAD', '=======', 'theirs', '>>>>>>> br']
    const parsed = findConflictHunks(lines)[0]
    if (parsed === undefined) throw new Error('fixture did not parse')
    expect(resolvedLines(lines, parsed, 'ours')).toEqual([])
    expect(resolvedLines(lines, parsed, 'theirs')).toEqual(['theirs'])
  })

  it('excludes the base section from resolutions', () => {
    const parsed = findConflictHunks(DIFF3)[0]
    if (parsed === undefined) throw new Error('fixture did not parse')
    expect(resolvedLines(DIFF3, parsed, 'ours')).toEqual(['our line'])
    expect(resolvedLines(DIFF3, parsed, 'both')).toEqual(['our line', 'their line'])
  })
})

describe('applyConflictChoice', () => {
  it('replaces the hunk and keeps the surrounding lines', () => {
    const hunk = findConflictHunks(MERGE)[0]
    if (hunk === undefined) throw new Error('fixture did not parse')
    expect(applyConflictChoice(MERGE, hunk, 'theirs')).toEqual(['prefix', 'their line', 'suffix'])
  })

  it('removes the hunk entirely when the chosen side is empty', () => {
    const lines = ['before', '<<<<<<< HEAD', '=======', 'theirs', '>>>>>>> br', 'after']
    const hunk = findConflictHunks(lines)[0]
    if (hunk === undefined) throw new Error('fixture did not parse')
    expect(applyConflictChoice(lines, hunk, 'ours')).toEqual(['before', 'after'])
  })

  it('resolves one hunk without touching the other', () => {
    const lines = [
      '<<<<<<< HEAD',
      'a',
      '=======',
      'b',
      '>>>>>>> br',
      'between',
      '<<<<<<< HEAD',
      'c',
      '=======',
      'd',
      '>>>>>>> br'
    ]
    const hunks = findConflictHunks(lines)
    const first = hunks[0]
    if (first === undefined) throw new Error('fixture did not parse')
    expect(applyConflictChoice(lines, first, 'ours')).toEqual([
      'a',
      'between',
      '<<<<<<< HEAD',
      'c',
      '=======',
      'd',
      '>>>>>>> br'
    ])
  })
})

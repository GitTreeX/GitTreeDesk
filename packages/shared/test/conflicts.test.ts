import { describe, expect, it } from 'vitest'
import { applyConflictResolution, findConflictSections, resolveConflictText } from '../src/conflicts'

const CONFLICTED = [
  'top',
  '<<<<<<< HEAD',
  'ours one',
  'ours two',
  '=======',
  'theirs one',
  '>>>>>>> feat/other',
  'middle',
  '<<<<<<< HEAD',
  'second ours',
  '=======',
  'second theirs',
  '>>>>>>> feat/other',
  'bottom',
  ''
].join('\n')

describe('findConflictSections', () => {
  it('finds both sections with their sides', () => {
    const sections = findConflictSections(CONFLICTED)
    expect(sections).toHaveLength(2)
    expect(sections[0]).toMatchObject({
      ours: 'ours one\nours two\n',
      base: null,
      theirs: 'theirs one\n'
    })
    expect(sections[1]).toMatchObject({ ours: 'second ours\n', theirs: 'second theirs\n' })
  })

  it('keeps the surrounding offsets aligned with the chosen sides', () => {
    const [first] = findConflictSections(CONFLICTED)
    expect(first).toBeDefined()
    const resolved = applyConflictResolution(CONFLICTED, first!, 'ours')
    expect(resolved).toBe(
      [
        'top',
        'ours one',
        'ours two',
        'middle',
        '<<<<<<< HEAD',
        'second ours',
        '=======',
        'second theirs',
        '>>>>>>> feat/other',
        'bottom',
        ''
      ].join('\n')
    )
  })

  it('reads diff3 sections with a base block', () => {
    const text = ['<<<<<<< HEAD', 'ours', '||||||| merged common ancestors', 'base', '=======', 'theirs', '>>>>>>> other', ''].join('\n')
    const [section] = findConflictSections(text)
    expect(section).toMatchObject({ ours: 'ours\n', base: 'base\n', theirs: 'theirs\n' })
  })

  it('ignores marker lookalikes outside their phase', () => {
    const text = [
      '<<<<<<< HEAD',
      'line that starts with ======= but is not the divider',
      '=======',
      'them',
      '>>>>>>> other',
      ''
    ].join('\n')
    const [section] = findConflictSections(text)
    expect(section?.ours).toBe('line that starts with ======= but is not the divider\n')
    expect(section?.theirs).toBe('them\n')
  })

  it('returns nothing for clean text and for unterminated blocks', () => {
    expect(findConflictSections('plain\n')).toEqual([])
    expect(findConflictSections('<<<<<<< HEAD\nours\n')).toEqual([])
  })
})

describe('resolveConflictText', () => {
  it('resolves every section onto one side', () => {
    const ours = resolveConflictText(CONFLICTED, 'ours')
    expect(ours).toBe('top\nours one\nours two\nmiddle\nsecond ours\nbottom\n')
    const theirs = resolveConflictText(CONFLICTED, 'theirs')
    expect(theirs).toBe('top\ntheirs one\nmiddle\nsecond theirs\nbottom\n')
  })

  it('joins ours then theirs for the union side', () => {
    expect(resolveConflictText(CONFLICTED, 'both')).toBe(
      'top\nours one\nours two\ntheirs one\nmiddle\nsecond ours\nsecond theirs\nbottom\n'
    )
  })

  it('leaves clean text untouched', () => {
    expect(resolveConflictText('# no conflicts\n', 'both')).toBe('# no conflicts\n')
  })

  it('handles a closing marker without a trailing newline', () => {
    const text = ['<<<<<<< HEAD', 'a', '=======', 'b', '>>>>>>> other'].join('\n')
    expect(resolveConflictText(text, 'theirs')).toBe('b\n')
  })
})

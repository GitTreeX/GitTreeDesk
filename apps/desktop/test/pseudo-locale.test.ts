import { describe, expect, it } from 'vitest'
import { pseudoLocalizeString, pseudoLocalizeTree } from '../src/renderer/src/i18n/locales/pseudo'

describe('pseudoLocalizeString', () => {
  it('wraps and accents the text', () => {
    const result = pseudoLocalizeString('Open Folder')
    expect(result.startsWith('⟦')).toBe(true)
    expect(result.endsWith('⟧')).toBe(true)
    expect(result).not.toBe('Open Folder')
    expect(result).not.toContain('Folder')
    expect(result).toContain('Ƒ')
  })

  it('keeps interpolation placeholders intact', () => {
    const result = pseudoLocalizeString('Theme: {{theme}}')
    expect(result).toContain('{{theme}}')
    expect(result).not.toContain('{{ţĥéɱé}}')
  })

  it('leaves empty strings alone', () => {
    expect(pseudoLocalizeString('')).toBe('')
  })
})

describe('pseudoLocalizeTree', () => {
  it('transforms nested strings but keeps the shape', () => {
    const tree = { a: { b: 'Hello' }, n: 3, list: ['One'] }
    const result = pseudoLocalizeTree(tree)
    expect(result.a.b).not.toBe('Hello')
    expect(result.n).toBe(3)
    expect(result.list[0]).not.toBe('One')
    expect(Object.keys(result)).toEqual(['a', 'n', 'list'])
    expect(Object.keys(result.a)).toEqual(['b'])
  })
})

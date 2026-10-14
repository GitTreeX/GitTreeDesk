import { describe, expect, it } from 'vitest'
import { findPathLinks, resolveLinkPath } from '../src/renderer/src/lib/terminal-links'

describe('findPathLinks', () => {
  it('parses path:line tokens with exact ranges', () => {
    expect(findPathLinks('done at src/app.ts:12')).toEqual([
      { text: 'src/app.ts:12', path: 'src/app.ts', line: 12, column: null, start: 8, end: 21 }
    ])
  })

  it('parses path:line:column tokens', () => {
    expect(findPathLinks('at src/app.ts:12:3 now')).toEqual([
      { text: 'src/app.ts:12:3', path: 'src/app.ts', line: 12, column: 3, start: 3, end: 18 }
    ])
  })

  it('keeps the drive letter on Windows paths', () => {
    expect(findPathLinks('C:\\src\\main.ts:42')).toEqual([
      { text: 'C:\\src\\main.ts:42', path: 'C:\\src\\main.ts', line: 42, column: null, start: 0, end: 17 }
    ])
    expect(findPathLinks('C:\\src\\main.ts:42:7')).toEqual([
      { text: 'C:\\src\\main.ts:42:7', path: 'C:\\src\\main.ts', line: 42, column: 7, start: 0, end: 19 }
    ])
  })

  it('skips URLs', () => {
    expect(findPathLinks('see https://example.com:8080 now')).toEqual([])
    expect(findPathLinks('see http://localhost/path:12 now')).toEqual([])
  })

  it('rejects tokens that do not look like paths', () => {
    expect(findPathLinks('started at 12:30')).toEqual([])
    expect(findPathLinks('a.ts:x')).toEqual([])
  })

  it('accepts a separator without an extension', () => {
    expect(findPathLinks('ran src/setup:12')).toEqual([
      { text: 'src/setup:12', path: 'src/setup', line: 12, column: null, start: 4, end: 16 }
    ])
  })

  it('finds every token in a line', () => {
    expect(findPathLinks('first src/a.ts:1:2 then src/b.ts:3')).toEqual([
      { text: 'src/a.ts:1:2', path: 'src/a.ts', line: 1, column: 2, start: 6, end: 18 },
      { text: 'src/b.ts:3', path: 'src/b.ts', line: 3, column: null, start: 24, end: 34 }
    ])
  })

  it('excludes trailing punctuation from the token', () => {
    expect(findPathLinks('see src/app.ts:12.')).toEqual([
      { text: 'src/app.ts:12', path: 'src/app.ts', line: 12, column: null, start: 4, end: 17 }
    ])
  })
})

describe('resolveLinkPath', () => {
  it('joins relative paths onto the cwd', () => {
    expect(resolveLinkPath('C:/w/app', 'src/main.ts')).toBe('C:/w/app/src/main.ts')
    expect(resolveLinkPath('C:/w/app/', 'src/main.ts')).toBe('C:/w/app/src/main.ts')
  })

  it('normalizes backslashes in relative paths', () => {
    expect(resolveLinkPath('C:/w/app', 'src\\main.ts')).toBe('C:/w/app/src/main.ts')
  })

  it('passes absolute paths through', () => {
    expect(resolveLinkPath('C:/w', '/usr/local/x.ts')).toBe('/usr/local/x.ts')
    expect(resolveLinkPath('C:/w', 'C:\\other\\file.ts')).toBe('C:/other/file.ts')
    expect(resolveLinkPath('C:/w', 'D:\\x.ts')).toBe('D:/x.ts')
  })

  it('resolves dot segments', () => {
    expect(resolveLinkPath('C:/w/app', './a.ts')).toBe('C:/w/app/a.ts')
    expect(resolveLinkPath('C:/w/app', '../lib/x.ts')).toBe('C:/w/lib/x.ts')
  })

  it('never climbs above the root', () => {
    expect(resolveLinkPath('C:/w', '../../x')).toBe('C:/x')
  })
})

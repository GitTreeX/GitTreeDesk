import { describe, expect, it } from 'vitest'
import type { FsFileKind, FsReadFileResponse } from '@gitreedesk/shared'
import { compareOrder, compareTabId, compareViewFor } from '../src/renderer/src/editor/compare'

function side(kind: FsFileKind, overrides: Partial<FsReadFileResponse> = {}): FsReadFileResponse {
  return {
    exists: true,
    kind,
    size: 12,
    mtimeMs: 1,
    text: kind === 'text' ? 'one\n' : null,
    dataUrl: kind === 'image' ? 'data:image/png;base64,aa' : null,
    ...overrides
  }
}

const PATHS = ['/ws/src/a.txt', '/ws/src/b.txt'] as const

describe('compare tab identity', () => {
  it('puts the earlier path on the left', () => {
    expect(compareOrder('/ws/src/b.txt', '/ws/src/a.txt')).toEqual(['/ws/src/a.txt', '/ws/src/b.txt'])
  })

  it('gives one pair a single tab id whichever way it is picked', () => {
    expect(compareTabId('/ws/src/b.txt', '/ws/src/a.txt')).toBe(compareTabId('/ws/src/a.txt', '/ws/src/b.txt'))
    expect(compareTabId('/ws/src/a.txt', '/ws/src/b.txt')).not.toBe(compareTabId('/ws/src/a.txt', '/ws/src/c.txt'))
  })
})

describe('compareViewFor', () => {
  it('compares two text files as a diff', () => {
    expect(compareViewFor(PATHS, [side('text'), side('text')])).toEqual({ kind: 'text' })
  })

  it('shows two images side by side', () => {
    expect(compareViewFor(PATHS, [side('image'), side('image')])).toEqual({ kind: 'images' })
  })

  it('refuses a pair it cannot render', () => {
    expect(compareViewFor(PATHS, [side('text'), side('image')])).toEqual({ kind: 'other' })
    expect(compareViewFor(PATHS, [side('binary'), side('binary')])).toEqual({ kind: 'other' })
  })

  it('names the file that went away first', () => {
    expect(compareViewFor(PATHS, [side('text'), side('binary', { exists: false })])).toEqual({
      kind: 'missing',
      paths: ['/ws/src/b.txt']
    })
  })

  it('asks before loading an oversized pair', () => {
    expect(compareViewFor(PATHS, [side('text'), side('tooLarge', { size: 9_000_000 })])).toEqual({
      kind: 'tooLarge'
    })
  })
})

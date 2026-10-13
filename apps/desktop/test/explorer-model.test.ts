import { describe, expect, it } from 'vitest'
import type { FsEntry } from '@gitreedesk/shared'
import { ancestorsWithin, sortEntries, visibleRows } from '../src/renderer/src/tree/explorer-model'

const entry = (name: string, kind: FsEntry['kind'], dir = '/ws'): FsEntry => ({
  name,
  kind,
  path: `${dir}/${name}`
})

describe('sortEntries', () => {
  it('puts folders first and sorts names with the collator', () => {
    const entries = [
      entry('zeta.txt', 'file'),
      entry('docs', 'dir'),
      entry('alpha.txt', 'file'),
      entry('lib', 'dir'),
      entry('link', 'symlink')
    ]
    const sorted = sortEntries(entries, new Intl.Collator('en'))
    expect(sorted.map((item) => item.name)).toEqual(['docs', 'lib', 'alpha.txt', 'link', 'zeta.txt'])
  })

  it('sorts numbers naturally', () => {
    const entries = [entry('file10.md', 'file'), entry('file2.md', 'file')]
    const sorted = sortEntries(entries, new Intl.Collator('en', { numeric: true }))
    expect(sorted.map((item) => item.name)).toEqual(['file2.md', 'file10.md'])
  })
})

describe('visibleRows', () => {
  const collator = new Intl.Collator('en')
  const children = new Map<string, readonly FsEntry[]>([
    ['/ws', [entry('src', 'dir'), entry('README.md', 'file')]],
    ['/ws/src', [entry('index.ts', 'file'), entry('lib', 'dir', '/ws/src')]],
    ['/ws/src/lib', [entry('util.ts', 'file', '/ws/src/lib')]]
  ])

  it('lists only the root children when nothing is expanded', () => {
    const rows = visibleRows('/ws', children, new Set(), collator)
    expect(rows.map((row) => `${row.depth}:${row.name}`)).toEqual(['0:src', '0:README.md'])
    expect(rows[0]?.expandable).toBe(true)
    expect(rows[1]?.expandable).toBe(false)
  })

  it('walks expanded folders depth-first in display order', () => {
    const expanded = new Set(['/ws/src', '/ws/src/lib'])
    const rows = visibleRows('/ws', children, expanded, collator)
    expect(rows.map((row) => `${row.depth}:${row.name}`)).toEqual([
      '0:src',
      '1:lib',
      '2:util.ts',
      '1:index.ts',
      '0:README.md'
    ])
    expect(rows[0]?.expanded).toBe(true)
  })

  it('never expands symlinks even when the path is in the expanded set', () => {
    const withLink = new Map<string, readonly FsEntry[]>([
      ['/ws', [entry('linked', 'symlink')]],
      ['/ws/linked', [entry('target.ts', 'file', '/ws/linked')]]
    ])
    const rows = visibleRows('/ws', withLink, new Set(['/ws/linked']), collator)
    expect(rows.map((row) => row.name)).toEqual(['linked'])
    expect(rows[0]?.expandable).toBe(false)
  })
})

describe('ancestorsWithin', () => {
  it('lists ancestors from the root down to the parent', () => {
    expect(ancestorsWithin('/ws', '/ws/a/b/c.ts')).toEqual(['/ws/a', '/ws/a/b'])
    expect(ancestorsWithin('/ws', '/ws/a/b')).toEqual(['/ws/a'])
    expect(ancestorsWithin('/ws', '/ws/a')).toEqual([])
    expect(ancestorsWithin('/ws', '/other/a')).toEqual([])
  })
})

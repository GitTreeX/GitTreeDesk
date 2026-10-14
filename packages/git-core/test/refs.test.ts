import { describe, expect, it } from 'vitest'
import { parseForEachRef } from '../src/refs'

const NUL = '\0'

function refLine(fields: {
  fullName: string
  name: string
  sha: string
  peeled?: string
  upstream?: string
  track?: string
  subject?: string
  head?: string
  date?: string
}): string {
  return [
    fields.fullName,
    fields.name,
    fields.sha,
    fields.peeled ?? '',
    fields.upstream ?? '',
    fields.track ?? '',
    fields.subject ?? '',
    fields.head ?? ' ',
    fields.date ?? ''
  ].join(NUL)
}

describe('parseForEachRef', () => {
  it('parses branches with upstream divergence', () => {
    const refs = parseForEachRef(
      refLine({
        fullName: 'refs/heads/main',
        name: 'main',
        sha: 'a'.repeat(40),
        upstream: 'origin/main',
        track: '[ahead 1, behind 2]',
        subject: 'Initial commit',
        head: '*',
        date: '2026-01-02T03:04:05+08:00'
      })
    )
    expect(refs).toEqual([
      {
        name: 'main',
        fullName: 'refs/heads/main',
        kind: 'branch',
        sha: 'a'.repeat(40),
        isHead: true,
        upstream: 'origin/main',
        ahead: 1,
        behind: 2,
        subject: 'Initial commit',
        updatedAt: '2026-01-02T03:04:05+08:00'
      }
    ])
  })

  it('keeps a gone upstream with zero divergence', () => {
    const refs = parseForEachRef(
      refLine({ fullName: 'refs/heads/feat', name: 'feat', sha: 'b'.repeat(40), upstream: 'origin/feat', track: '[gone]' })
    )
    expect(refs[0]?.upstream).toBe('origin/feat')
    expect(refs[0]?.ahead).toBe(0)
    expect(refs[0]?.behind).toBe(0)
    expect(refs[0]?.isHead).toBe(false)
    expect(refs[0]?.subject).toBeNull()
  })

  it('drops the symbolic remote HEAD ref', () => {
    const refs = parseForEachRef(
      [
        // `git for-each-ref` shortens `refs/remotes/origin/HEAD` to just `origin`.
        refLine({ fullName: 'refs/remotes/origin/HEAD', name: 'origin', sha: 'a'.repeat(40) }),
        refLine({ fullName: 'refs/remotes/origin/main', name: 'origin/main', sha: 'a'.repeat(40) })
      ].join('\n')
    )
    expect(refs.map((ref) => ref.name)).toEqual(['origin/main'])
  })

  it('peels annotated tags to their commit', () => {
    const refs = parseForEachRef(
      [
        refLine({
          fullName: 'refs/tags/v1.0.0',
          name: 'v1.0.0',
          sha: 'f'.repeat(40),
          peeled: 'c'.repeat(40),
          subject: 'Release 1.0.0'
        }),
        refLine({ fullName: 'refs/tags/light', name: 'light', sha: 'd'.repeat(40) })
      ].join('\n')
    )
    expect(refs[0]).toMatchObject({ kind: 'tag', sha: 'c'.repeat(40) })
    expect(refs[1]).toMatchObject({ kind: 'tag', sha: 'd'.repeat(40) })
  })
})

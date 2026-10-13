import { describe, expect, it } from 'vitest'
import { parseStatusV2 } from '../src/status'

const NUL = '\0'

function fixture(records: string[]): string {
  return records.join(NUL) + NUL
}

describe('parseStatusV2', () => {
  it('parses branch headers with upstream and divergence', () => {
    const parsed = parseStatusV2(
      fixture(['# branch.oid abc123', '# branch.head main', '# branch.upstream origin/main', '# branch.ab +2 -1'])
    )
    expect(parsed.head).toEqual({ ref: 'main', sha: 'abc123', detached: false, unborn: false })
    expect(parsed.upstream).toEqual({ ref: 'origin/main', ahead: 2, behind: 1 })
  })

  it('reports an unborn head', () => {
    const parsed = parseStatusV2(fixture(['# branch.oid (initial)', '# branch.head main']))
    expect(parsed.head).toEqual({ ref: 'main', sha: null, detached: false, unborn: true })
    expect(parsed.upstream).toBeNull()
  })

  it('reports a detached head', () => {
    const parsed = parseStatusV2(fixture(['# branch.oid abc123', '# branch.head (detached)']))
    expect(parsed.head).toEqual({ ref: null, sha: 'abc123', detached: true, unborn: false })
  })

  it('splits staged and unstaged changes', () => {
    const parsed = parseStatusV2(
      fixture([
        '# branch.oid abc123',
        '# branch.head main',
        '1 M. N... 100644 100644 100644 aaaa bbbb src/app.ts',
        '1 .M N... 100644 100644 100644 aaaa bbbb src/lib.ts',
        '1 A. N... 000000 100644 100644 0000 cccc docs/新 文档.md',
        '1 .T N... 100644 100644 100644 aaaa bbbb scripts/run.sh'
      ])
    )
    expect(parsed.staged).toEqual([
      { path: 'src/app.ts', kind: 'modified' },
      { path: 'docs/新 文档.md', kind: 'added' }
    ])
    expect(parsed.unstaged).toEqual([
      { path: 'src/lib.ts', kind: 'modified' },
      { path: 'scripts/run.sh', kind: 'typeChanged' }
    ])
  })

  it('attaches the original path to renames and copies', () => {
    const parsed = parseStatusV2(
      fixture([
        '# branch.oid abc123',
        '# branch.head main',
        '2 R. N... 100644 100644 100644 aaaa bbbb R100 content/中文 文档/新 笔记.md',
        'content/中文 文档/笔记.md',
        '2 C. N... 100644 100644 100644 aaaa bbbb C075 backup copy.md',
        'original notes.md'
      ])
    )
    expect(parsed.staged).toEqual([
      {
        path: 'content/中文 文档/新 笔记.md',
        origPath: 'content/中文 文档/笔记.md',
        kind: 'renamed'
      },
      { path: 'backup copy.md', origPath: 'original notes.md', kind: 'copied' }
    ])
    expect(parsed.unstaged).toEqual([])
  })

  it('parses conflicted entries and untracked files', () => {
    const parsed = parseStatusV2(
      fixture([
        '# branch.oid abc123',
        '# branch.head main',
        'u UU N... 100644 100644 100644 100644 aaaa bbbb cccc src/conflict.ts',
        '? notes/新 便签.txt'
      ])
    )
    expect(parsed.conflicted).toEqual([{ path: 'src/conflict.ts', code: 'UU' }])
    expect(parsed.untracked).toEqual(['notes/新 便签.txt'])
    expect(parsed.staged).toEqual([])
    expect(parsed.unstaged).toEqual([])
  })
})

import { describe, expect, it } from 'vitest'
import { buildDrafts } from '../src/draft'
import type { ConventionProfile, StagedFile, StagedSummary } from '../src/types'

function profile(overrides: Partial<ConventionProfile> = {}): ConventionProfile {
  return {
    conventional: true,
    types: null,
    scopes: null,
    language: 'en',
    casing: 'lower',
    averageLength: null,
    sources: [],
    ...overrides
  }
}

function file(
  path: string,
  kind: StagedFile['kind'] = 'modified',
  additions = 1,
  deletions = 0
): StagedFile {
  return { path, kind, additions, deletions }
}

function summary(files: StagedFile[]): StagedSummary {
  return { files, patch: '', patchTruncated: false }
}

function messagesOf(files: StagedFile[], overrides: Partial<ConventionProfile> = {}): string[] {
  return buildDrafts({ summary: summary(files), profile: profile(overrides) }).variants.map(
    (variant) => variant.message
  )
}

describe('buildDrafts', () => {
  it('throws without staged files', () => {
    expect(() => buildDrafts({ summary: summary([]), profile: profile() })).toThrow(
      'No staged files to describe'
    )
  })

  it('classifies documentation-only changes as docs and keeps the draft confident', () => {
    const result = buildDrafts({ summary: summary([file('README.md')]), profile: profile() })
    expect(result.weak).toBe(false)
    expect(result.variants[0]?.message).toBe('docs: update readme')
  })

  it('infers scope, subject, alternate type and alternate subject for new files', () => {
    const result = buildDrafts({
      summary: summary([
        file('apps/web/src/login-page.tsx', 'added', 10, 0),
        file('apps/web/src/auth-store.ts', 'added', 5, 0)
      ]),
      profile: profile()
    })
    expect(result.variants.map((variant) => variant.message)).toEqual([
      'feat(web): add web\n\n- apps/web: 2 files (+15 −0)',
      'fix(web): add web\n\n- apps/web: 2 files (+15 −0)',
      'feat(web): add login page\n\n- apps/web: 2 files (+15 −0)'
    ])
    expect(result.weak).toBe(true)
  })

  it('restricts the type to the commitlint type-enum and drops excluded variants', () => {
    const messages = messagesOf([file('src/index.ts', 'added')], { types: ['fix', 'chore'] })
    expect(messages).toEqual(['fix: add index', 'fix: add src'])
  })

  it('matches the scope against commitlint scope-enum', () => {
    const files = [file('packages/core/a.ts'), file('packages/core/b.ts')]
    expect(messagesOf(files, { scopes: ['core', 'ui'] })[0]?.startsWith('fix(core): ')).toBe(true)
    expect(messagesOf(files, { scopes: ['ui'] })[0]?.startsWith('fix: ')).toBe(true)
  })

  it('writes neutral subjects when no convention exists and skips the type variant', () => {
    const messages = messagesOf([file('src/index.ts')], { conventional: false, casing: 'unknown' })
    expect(messages).toEqual(['Update index', 'Update src'])
  })

  it('builds Chinese subjects and bodies when history is Chinese', () => {
    const result = buildDrafts({
      summary: summary([file('src/a.js', 'added'), file('src/b.js', 'added')]),
      profile: profile({ language: 'zh', casing: 'unknown' })
    })
    expect(result.variants[0]?.message).toBe('feat: 新增 2 个文件\n\n- src：2 个文件（+2 −0）')
  })

  it('summarizes per-directory churn and caps the body groups', () => {
    const files = Array.from({ length: 7 }, (_, index) => file(`d${String(index + 1)}/a.txt`, 'added'))
    const message = messagesOf(files)[0] ?? ''
    expect(message.startsWith('feat: add 7 files\n\n')).toBe(true)
    expect(message).toContain('- d1: 1 file (+1 −0)')
    expect(message.endsWith('… and 1 more')).toBe(true)
  })
})

import { describe, expect, it } from 'vitest'
import { buildPrompt, DEFAULT_MAX_DIFF_CHARS } from '../src/prompt'
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
  additions: number | null = 1,
  deletions: number | null = 0
): StagedFile {
  return { path, kind, additions, deletions }
}

function summary(files: StagedFile[], patch = ''): StagedSummary {
  return { files, patch, patchTruncated: false }
}

describe('buildPrompt', () => {
  it('states the conventional rules from the profile', () => {
    const { system } = buildPrompt({
      summary: summary([file('src/a.ts')]),
      profile: profile({ types: ['feat', 'fix'], scopes: ['api'], casing: 'lower', averageLength: 50 })
    })
    expect(system).toContain('conventional commits')
    expect(system).toContain('set: feat, fix.')
    expect(system).toContain('Allowed scopes: api.')
    expect(system).toContain('Write the subject line in English.')
    expect(system).toContain('near 50 characters')
    expect(system).toContain('lowercase')
  })

  it('caps the suggested length and describes neutral Chinese repositories', () => {
    const { system } = buildPrompt({
      summary: summary([file('src/a.ts')]),
      profile: profile({ conventional: false, language: 'zh', averageLength: 100 })
    })
    expect(system).toContain('plain descriptive subject line')
    expect(system).toContain('Write the subject line in Chinese.')
    expect(system).toContain('near 72 characters')
  })

  it('defaults the length guidance without history', () => {
    const { system } = buildPrompt({
      summary: summary([file('src/a.ts')]),
      profile: profile({ casing: 'unknown' })
    })
    expect(system).toContain('under 72 characters')
    expect(system).not.toContain('lowercase')
    expect(system).not.toContain('capital letter')
  })

  it('lists staged files with churn and marks binary files', () => {
    const { user } = buildPrompt({
      summary: summary(
        [
          file('src/a.ts', 'modified', 4, 2),
          file('img/logo.png', 'added', null, null),
          { path: 'src/b.ts', origPath: 'src/old.ts', kind: 'renamed', additions: 1, deletions: 1 }
        ],
        'diff --git a/src/a.ts b/src/a.ts'
      ),
      profile: profile()
    })
    expect(user).toContain(
      'Staged files:\nmodified src/a.ts +4 −2\nadded img/logo.png binary\nrenamed src/b.ts (from src/old.ts) +1 −1'
    )
    expect(user).toContain('Staged diff:\ndiff --git a/src/a.ts b/src/a.ts')
  })

  it('truncates an oversized diff with a marker', () => {
    const { user } = buildPrompt({
      summary: summary([file('src/a.ts')], 'x'.repeat(100)),
      profile: profile(),
      maxDiffChars: 10
    })
    expect(user).toContain(`${'x'.repeat(10)}\n… (diff truncated)`)
  })

  it('notes a missing textual diff', () => {
    const { user } = buildPrompt({ summary: summary([file('src/a.ts')], ''), profile: profile() })
    expect(user.endsWith('Staged diff:\n(no textual diff)')).toBe(true)
  })

  it('exposes the default cap', () => {
    expect(DEFAULT_MAX_DIFF_CHARS).toBe(40_000)
  })
})

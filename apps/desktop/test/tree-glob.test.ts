import { describe, expect, it } from 'vitest'
import { matchGlob, matchesAnyGlob } from '../src/renderer/src/tree/glob'

describe('matchGlob', () => {
  it('matches a single path segment with *', () => {
    expect(matchGlob('backend/*', 'backend/api')).toBe(true)
    expect(matchGlob('backend/*', 'backend/api/nested')).toBe(false)
    expect(matchGlob('backend/*', 'frontend/api')).toBe(false)
  })

  it('crosses segments with **', () => {
    expect(matchGlob('**/fixtures/**', 'content/fixtures/a/b')).toBe(true)
    expect(matchGlob('**/fixtures/**', 'fixtures/a')).toBe(true)
    expect(matchGlob('content/**', 'content/中文文档/examples')).toBe(true)
    expect(matchGlob('content/**', 'docs/guides')).toBe(false)
  })

  it('matches single characters with ?', () => {
    expect(matchGlob('repo-?', 'repo-a')).toBe(true)
    expect(matchGlob('repo-?', 'repo-ab')).toBe(false)
  })

  it('treats regex characters literally', () => {
    expect(matchGlob('app.v2/*', 'app.v2/web')).toBe(true)
    expect(matchGlob('app.v2/*', 'appXv2/web')).toBe(false)
  })

  it('supports multiple patterns through matchesAnyGlob', () => {
    expect(matchesAnyGlob(['docs/**', 'backend/*'], 'backend/api')).toBe(true)
    expect(matchesAnyGlob(['docs/**', 'backend/*'], 'frontend/web')).toBe(false)
  })
})

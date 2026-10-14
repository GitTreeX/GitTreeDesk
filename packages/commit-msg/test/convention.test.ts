import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  analyzeSubjects,
  CONVENTIONAL_TYPES,
  detectConvention,
  discoverCommitlint,
  parseCommitlintConfig,
  templateLooksConventional
} from '../src/convention'

const temps: string[] = []

async function makeDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'commit-msg-'))
  temps.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('parseCommitlintConfig', () => {
  it('expands extends config-conventional to the standard type set', () => {
    expect(parseCommitlintConfig({ extends: ['@commitlint/config-conventional'] })).toEqual({
      types: [...CONVENTIONAL_TYPES],
      scopes: null
    })
  })

  it('accepts a bare string extends', () => {
    expect(parseCommitlintConfig({ extends: '@commitlint/config-conventional' }).types).toEqual([
      ...CONVENTIONAL_TYPES
    ])
  })

  it('reads type-enum and scope-enum rules', () => {
    const info = parseCommitlintConfig({
      rules: {
        'type-enum': [2, 'always', ['feat', 'fix']],
        'scope-enum': [2, 'always', ['api', 'web']]
      }
    })
    expect(info).toEqual({ types: ['feat', 'fix'], scopes: ['api', 'web'] })
  })

  it('ignores empty enum values and unknown shapes', () => {
    expect(parseCommitlintConfig({ rules: { 'type-enum': [2, 'always', []] } })).toEqual({
      types: null,
      scopes: null
    })
    expect(parseCommitlintConfig('not a config')).toEqual({ types: null, scopes: null })
    expect(parseCommitlintConfig(null)).toEqual({ types: null, scopes: null })
  })
})

describe('templateLooksConventional', () => {
  it('detects a skeleton after comment lines', () => {
    const template = '# Please enter the commit message\n# Lines starting with # are ignored\n\nfix(api): \n'
    expect(templateLooksConventional(template)).toBe(true)
  })

  it('rejects free-form templates and empty input', () => {
    expect(templateLooksConventional('Describe your change')).toBe(false)
    expect(templateLooksConventional('# only comments\n')).toBe(false)
    expect(templateLooksConventional(null)).toBe(false)
  })
})

describe('analyzeSubjects', () => {
  it('reports an empty sample as unknown', () => {
    expect(analyzeSubjects([])).toEqual({
      conventional: false,
      sample: 0,
      language: 'unknown',
      casing: 'unknown',
      averageLength: null
    })
  })

  it('detects conventional lowercase English subjects', () => {
    const style = analyzeSubjects(['feat: add billing screen', 'fix(api): retry on 502', 'docs: update readme'])
    expect(style.conventional).toBe(true)
    expect(style.language).toBe('en')
    expect(style.casing).toBe('lower')
    expect(style.averageLength).toBe(22)
  })

  it('detects Chinese subjects and ignores the body', () => {
    const style = analyzeSubjects(['新增账单页面', '修复登录超时\n\n更多说明'])
    expect(style.conventional).toBe(false)
    expect(style.language).toBe('zh')
    expect(style.casing).toBe('unknown')
    expect(style.averageLength).toBe(6)
  })

  it('stays neutral below the conventional ratio', () => {
    const style = analyzeSubjects(['feat: one', 'random work', 'more random work', 'cleanup'])
    expect(style.sample).toBe(4)
    expect(style.conventional).toBe(false)
  })

  it('detects capitalized subjects', () => {
    expect(analyzeSubjects(['feat: Add billing screen']).casing).toBe('upper')
  })
})

describe('detectConvention', () => {
  it('takes types and scopes from commitlint and lists its sources', () => {
    const profile = detectConvention({
      commitlint: { types: ['feat', 'fix'], scopes: ['api'] },
      template: null,
      subjects: ['feat(api): add endpoint']
    })
    expect(profile.conventional).toBe(true)
    expect(profile.types).toEqual(['feat', 'fix'])
    expect(profile.scopes).toEqual(['api'])
    expect(profile.sources).toEqual(['commitlint', 'subjects'])
  })

  it('accepts a conventional template as its own signal', () => {
    const profile = detectConvention({ commitlint: null, template: 'feat(scope): ', subjects: [] })
    expect(profile.conventional).toBe(true)
    expect(profile.sources).toEqual(['template'])
  })

  it('stays neutral without any signal', () => {
    const profile = detectConvention({ commitlint: null, template: 'Describe the change', subjects: ['wip'] })
    expect(profile.conventional).toBe(false)
    expect(profile.sources).toEqual(['subjects'])
    expect(profile.language).toBe('en')
  })
})

describe('discoverCommitlint', () => {
  it('parses a JSON rc file', async () => {
    const dir = await makeDir()
    await writeFile(
      join(dir, '.commitlintrc.json'),
      JSON.stringify({ rules: { 'type-enum': [2, 'always', ['feat']] } })
    )
    expect(await discoverCommitlint(dir)).toEqual({ types: ['feat'], scopes: null })
  })

  it('reports an opaque config file as present but unknown', async () => {
    const dir = await makeDir()
    await writeFile(join(dir, 'commitlint.config.js'), 'export default {}\n')
    expect(await discoverCommitlint(dir)).toEqual({ types: null, scopes: null })
  })

  it('reads the commitlint key of package.json', async () => {
    const dir = await makeDir()
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({ commitlint: { extends: ['@commitlint/config-conventional'] } })
    )
    expect((await discoverCommitlint(dir))?.types).toEqual([...CONVENTIONAL_TYPES])
  })

  it('treats an unparseable JSON rc file as present but unknown', async () => {
    const dir = await makeDir()
    await writeFile(join(dir, '.commitlintrc'), '{ not json')
    expect(await discoverCommitlint(dir)).toEqual({ types: null, scopes: null })
  })

  it('returns null without any configuration', async () => {
    const dir = await makeDir()
    expect(await discoverCommitlint(dir)).toBeNull()
  })
})

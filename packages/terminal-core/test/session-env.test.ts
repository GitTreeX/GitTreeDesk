import { describe, expect, it } from 'vitest'
import { buildSessionEnv } from '../src/session-env'

describe('buildSessionEnv', () => {
  it('keeps the base environment but drops Git plumbing', () => {
    const env = buildSessionEnv({
      base: { PATH: '/bin', GIT_DIR: '/repo/.git', GIT_INDEX_FILE: '/tmp/index', HOME: '/home/u' }
    })

    expect(env['PATH']).toBe('/bin')
    expect(env['HOME']).toBe('/home/u')
    expect(env['GIT_DIR']).toBeUndefined()
    expect(env['GIT_INDEX_FILE']).toBeUndefined()
  })

  it('drops undefined entries and sets TERM', () => {
    const env = buildSessionEnv({ base: { PATH: '/bin', UNSET: undefined } })

    expect(env['UNSET']).toBeUndefined()
    expect(Object.keys(env)).not.toContain('UNSET')
    expect(env['TERM']).toBe('xterm-256color')
  })

  it('applies the profile environment on top', () => {
    const env = buildSessionEnv({
      base: { PATH: '/bin', NODE_ENV: 'production', GIT_DIR: '/repo/.git' },
      profileEnv: { NODE_ENV: 'development', GIT_DIR: '/other/.git' }
    })

    expect(env['NODE_ENV']).toBe('development')
    expect(env['GIT_DIR']).toBe('/other/.git')
  })

  it('exports the workspace and repository roots as GITREEDESK_* variables', () => {
    const env = buildSessionEnv({
      base: {},
      workspaceRoot: '/ws',
      repoRoot: '/ws/app'
    })

    expect(env['GITREEDESK_WORKSPACE']).toBe('/ws')
    expect(env['GITREEDESK_REPO']).toBe('/ws/app')
  })

  it('omits GITREEDESK_* variables that are unknown', () => {
    const env = buildSessionEnv({ base: {}, workspaceRoot: null })
    expect(env['GITREEDESK_WORKSPACE']).toBeUndefined()
    expect(env['GITREEDESK_REPO']).toBeUndefined()
  })
})

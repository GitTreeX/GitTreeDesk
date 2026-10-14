import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { detectShellProfiles, findExecutable, parseWslList, type DetectShellOptions } from '../src/detect'

const ROOT = join('/', 'tools')
const GIT = join('/', 'git')

function options(overrides: Partial<DetectShellOptions> & { known?: string[] }): DetectShellOptions {
  const known = new Set(overrides.known ?? [])
  return {
    platform: 'win32',
    env: { PATH: [ROOT, GIT].join(';'), PATHEXT: '.EXE;.CMD' },
    pathExists: (path) => Promise.resolve(known.has(path)),
    listWslDistros: () => Promise.resolve([]),
    ...overrides
  }
}

describe('findExecutable', () => {
  it('finds a name through PATHEXT on Windows', async () => {
    const found = await findExecutable('pwsh', options({ known: [join(ROOT, 'pwsh.exe')] }))
    expect(found).toBe(join(ROOT, 'pwsh.exe'))
  })

  it('checks PATHEXT extensions in order and PATH directories in order', async () => {
    const found = await findExecutable('pwsh', options({ known: [join(GIT, 'pwsh.exe')] }))
    expect(found).toBe(join(GIT, 'pwsh.exe'))
  })

  it('keeps an explicit extension as-is', async () => {
    const found = await findExecutable('cmd.exe', options({ known: [join(GIT, 'cmd.exe')] }))
    expect(found).toBe(join(GIT, 'cmd.exe'))
  })

  it('returns null when nothing matches', async () => {
    expect(await findExecutable('nope', options({}))).toBeNull()
  })

  it('finds a bare name on POSIX', async () => {
    const found = await findExecutable('bash', {
      platform: 'linux',
      env: { PATH: ['/usr/bin', '/bin'].join(':') },
      pathExists: (path) => Promise.resolve(path === '/bin/bash')
    })
    expect(found).toBe('/bin/bash')
  })
})

describe('parseWslList', () => {
  it('decodes UTF-16LE output with NUL bytes', () => {
    const output = Buffer.from('Ubuntu\r\nDebian\r\n', 'utf16le')
    expect(parseWslList(output)).toEqual(['Ubuntu', 'Debian'])
  })

  it('decodes plain UTF-8 output and strips noise lines', () => {
    const text = 'Copyright (c) Microsoft Corporation.\r\nUsage: wsl.exe [options]\r\nUbuntu\r\n'
    expect(parseWslList(Buffer.from(text, 'utf8'))).toEqual(['Ubuntu'])
  })

  it('ignores empty lines', () => {
    expect(parseWslList(Buffer.from('\r\nUbuntu\r\n\r\n', 'utf8'))).toEqual(['Ubuntu'])
  })
})

describe('detectShellProfiles on Windows', () => {
  it('orders pwsh, Windows PowerShell, cmd, Git Bash, then WSL distributions', async () => {
    const gitBash = join(GIT, 'usr', 'bin', 'bash.exe')
    const profiles = await detectShellProfiles(
      options({
        known: [join(ROOT, 'pwsh.exe'), join(ROOT, 'powershell.exe'), gitBash],
        env: {
          PATH: [ROOT, GIT].join(';'),
          PATHEXT: '.EXE',
          ComSpec: join(ROOT, 'cmd.exe')
        },
        gitInstallRoot: GIT,
        listWslDistros: () => Promise.resolve(['Ubuntu', 'Debian'])
      })
    )

    expect(profiles.map((profile) => profile.id)).toEqual([
      'pwsh',
      'powershell',
      'cmd',
      'git-bash',
      'wsl:Ubuntu',
      'wsl:Debian'
    ])
    expect(profiles[0]?.args).toEqual(['-NoLogo'])
    expect(profiles[3]?.shell).toBe(gitBash)
    expect(profiles[3]?.args).toEqual(['--login', '-i'])
    expect(profiles[4]?.shell).toBe('wsl.exe')
    expect(profiles[4]?.args).toEqual(['-d', 'Ubuntu'])
    expect(profiles.every((profile) => profile.origin === 'detected')).toBe(true)
  })

  it('skips missing shells and prefers PATH when ComSpec is absent', async () => {
    const profiles = await detectShellProfiles(
      options({ known: [join(ROOT, 'cmd.exe')], env: { PATH: ROOT, PATHEXT: '.EXE' } })
    )
    expect(profiles.map((profile) => profile.id)).toEqual(['cmd'])
  })

  it('skips Git Bash when there is no Git install root', async () => {
    const profiles = await detectShellProfiles(options({ known: [join(GIT, 'usr', 'bin', 'bash.exe')] }))
    expect(profiles.map((profile) => profile.id)).toEqual([])
  })
})

describe('detectShellProfiles on POSIX', () => {
  it('starts from $SHELL and appends other login shells', async () => {
    const profiles = await detectShellProfiles({
      platform: 'linux',
      env: { SHELL: '/usr/bin/zsh', PATH: ['/usr/bin', '/bin'].join(':') },
      pathExists: (path) => Promise.resolve(['/usr/bin/zsh', '/bin/bash', '/usr/bin/fish'].includes(path))
    })

    expect(profiles.map((profile) => profile.id)).toEqual(['default', 'bash', 'fish'])
    expect(profiles[0]?.name).toBe('zsh')
    expect(profiles[0]?.args).toEqual(['-l'])
    expect(profiles[1]?.shell).toBe('/bin/bash')
  })

  it('does not pass -l to a non-login default shell', async () => {
    const profiles = await detectShellProfiles({
      platform: 'linux',
      env: { SHELL: '/bin/dash', PATH: '/bin' },
      pathExists: (path) => Promise.resolve(path === '/bin/dash')
    })
    expect(profiles[0]?.args).toEqual([])
  })

  it('deduplicates when $SHELL is also a well-known name', async () => {
    const profiles = await detectShellProfiles({
      platform: 'darwin',
      env: { SHELL: '/bin/bash', PATH: '/bin' },
      pathExists: (path) => Promise.resolve(path === '/bin/bash')
    })
    expect(profiles.map((profile) => profile.id)).toEqual(['default'])
  })
})

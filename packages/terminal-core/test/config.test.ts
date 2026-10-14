import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { TerminalProfileInfo } from '@gitreedesk/shared'
import {
  collectTerminalConfigs,
  parseTerminalConfig,
  resolveTerminal,
  type TerminalConfig,
  type TerminalConfigEntry
} from '../src/config'

const configPath = (directory: string): string =>
  `${directory.replace(/\\/g, '/')}/.gitreedesk/terminal.json`

describe('parseTerminalConfig', () => {
  it('reads profiles and quick commands', () => {
    const text = JSON.stringify({
      defaultProfile: 'dev',
      profiles: [
        {
          name: 'dev',
          shell: 'pwsh',
          args: ['-NoLogo'],
          env: { NODE_ENV: 'development' },
          cwd: '{repoRoot}',
          icon: 'terminal',
          color: 'blue'
        }
      ],
      quickCommands: [{ name: 'pnpm dev', command: 'pnpm', args: ['dev'], cwd: '{repoRoot}' }]
    })
    const { config, errors } = parseTerminalConfig(text)

    expect(errors).toEqual([])
    expect(config).toEqual({
      defaultProfile: 'dev',
      profiles: [
        {
          name: 'dev',
          shell: 'pwsh',
          args: ['-NoLogo'],
          env: { NODE_ENV: 'development' },
          cwd: '{repoRoot}',
          icon: 'terminal',
          color: 'blue'
        }
      ],
      quickCommands: [{ name: 'pnpm dev', command: 'pnpm', args: ['dev'], cwd: '{repoRoot}', shellCommand: false }]
    })
    expect(config?.quickCommands[0]?.args).toEqual(['dev'])
  })

  it('tolerates comments, trailing commas and a BOM', () => {
    const text = '\uFEFF{\n  // dev shell\n  "profiles": [{ "name": "dev", "shell": "pwsh", }],\n}'
    const { config, errors } = parseTerminalConfig(text)

    expect(errors).toEqual([])
    expect(config?.profiles.map((profile) => profile.name)).toEqual(['dev'])
  })

  it('rejects a file with a syntax error and reports the position', () => {
    const { config, errors } = parseTerminalConfig('{ "profiles": [ }')

    expect(config).toBeNull()
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]).toContain('at offset')
  })

  it('rejects a non-object root', () => {
    const { config, errors } = parseTerminalConfig('[]')
    expect(config).toBeNull()
    expect(errors).toEqual(['the file must contain a JSON object'])
  })

  it('treats empty content as an empty config', () => {
    expect(parseTerminalConfig('')).toEqual({ config: { defaultProfile: null, profiles: [], quickCommands: [] }, errors: [] })
    expect(parseTerminalConfig('  \n').config).not.toBeNull()
  })

  it('reports profiles and quick commands without a name or shell', () => {
    const { config, errors } = parseTerminalConfig(
      JSON.stringify({ profiles: [{ name: 'x' }], quickCommands: [{ name: 'y' }] })
    )

    expect(config?.profiles).toEqual([])
    expect(config?.quickCommands).toEqual([])
    expect(errors).toEqual(['profiles[0] needs a name and a shell', 'quickCommands[0] needs a name and a command'])
  })

  it('drops non-string args and env entries', () => {
    const { config } = parseTerminalConfig(
      JSON.stringify({ profiles: [{ name: 'a', shell: 'b', args: ['x', 3], env: { A: '1', B: 2 } }] })
    )

    expect(config?.profiles[0]?.args).toEqual(['x'])
    expect(config?.profiles[0]?.env).toEqual({ A: '1' })
  })
})

describe('collectTerminalConfigs', () => {
  it('collects configs from the workspace root down to the directory, deepest last', async () => {
    const root = join('/', 'ws')
    const files: Record<string, string> = {
      [configPath(root)]: '{"defaultProfile":"root"}',
      [configPath(join(root, 'app'))]: '{"defaultProfile":"app"}'
    }
    const walk = await collectTerminalConfigs({
      dir: join(root, 'app', 'src'),
      workspaceRoot: root,
      readFile: (path) => Promise.resolve(files[path] ?? null)
    })

    expect(walk.entries.map((entry) => entry.path)).toEqual([configPath(root), configPath(join(root, 'app'))])
    expect(walk.issues).toEqual([])
  })

  it('reports invalid files as issues and skips them', async () => {
    const root = join('/', 'ws')
    const files: Record<string, string> = { [configPath(root)]: '{ broken' }
    const walk = await collectTerminalConfigs({
      dir: root,
      workspaceRoot: root,
      readFile: (path) => Promise.resolve(files[path] ?? null)
    })

    expect(walk.entries).toEqual([])
    expect(walk.issues.length).toBeGreaterThan(0)
    expect(walk.issues.every((issue) => issue.startsWith(configPath(root)))).toBe(true)
  })

  it('returns nothing for a directory outside the workspace root', async () => {
    const walk = await collectTerminalConfigs({
      dir: join('/', 'other'),
      workspaceRoot: join('/', 'ws'),
      readFile: () => Promise.resolve('{}')
    })
    expect(walk.entries).toEqual([])
    expect(walk.issues).toEqual([])
  })

  it.runIf(process.platform === 'win32')('compares paths case-insensitively', async () => {
    const walk = await collectTerminalConfigs({
      dir: join('/', 'WS', 'App'),
      workspaceRoot: join('/', 'ws'),
      readFile: (path) =>
        Promise.resolve(path === '/ws/App/.gitreedesk/terminal.json' ? '{"defaultProfile":"deep"}' : null)
    })
    expect(walk.entries.map((entry) => entry.path)).toEqual(['/ws/App/.gitreedesk/terminal.json'])
  })
})

const detected: TerminalProfileInfo[] = [
  {
    id: 'pwsh',
    name: 'PowerShell 7',
    shell: 'pwsh.exe',
    args: ['-NoLogo'],
    env: {},
    cwd: null,
    icon: null,
    color: null,
    origin: 'detected'
  }
]

const rootConfig: TerminalConfig = {
  defaultProfile: 'dev',
  profiles: [
    { name: 'dev', shell: 'pwsh', args: ['-NoLogo'], env: { NODE_ENV: 'development' }, cwd: null, icon: null, color: null }
  ],
  quickCommands: [{ name: 'pnpm dev', command: 'pnpm', args: ['dev'], cwd: '{repoRoot}', shellCommand: false }]
}

const entry = (path: string, config: TerminalConfig): TerminalConfigEntry => ({ path, config })

describe('resolveTerminal', () => {
  it('starts from detected profiles and merges config profiles and commands', () => {
    const resolved = resolveTerminal({
      entries: [entry('root', rootConfig)],
      detectedProfiles: detected,
      settingsDefaultProfile: null,
      quickCommandsAllowed: true
    })

    expect(resolved.profiles.map((profile) => profile.id)).toEqual(['pwsh', 'dev'])
    expect(resolved.profiles[1]).toMatchObject({ origin: 'config', shell: 'pwsh', env: { NODE_ENV: 'development' } })
    expect(resolved.defaultProfile).toBe('dev')
    expect(resolved.quickCommands.map((command) => command.name)).toEqual(['pnpm dev'])
  })

  it('lets deeper files override by name and add new entries', () => {
    const deep: TerminalConfig = {
      defaultProfile: null,
      profiles: [{ name: 'dev', shell: 'bash', args: ['-l'], env: {}, cwd: null, icon: null, color: null }],
      quickCommands: []
    }
    const resolved = resolveTerminal({
      entries: [entry('root', rootConfig), entry('deep', deep)],
      detectedProfiles: detected,
      settingsDefaultProfile: null,
      quickCommandsAllowed: true
    })

    expect(resolved.profiles.map((profile) => profile.id)).toEqual(['pwsh', 'dev'])
    expect(resolved.profiles[1]?.shell).toBe('bash')
    expect(resolved.defaultProfile).toBe('dev')
  })

  it('falls back to the settings default profile', () => {
    const resolved = resolveTerminal({
      entries: [],
      detectedProfiles: detected,
      settingsDefaultProfile: 'pwsh',
      quickCommandsAllowed: true
    })
    expect(resolved.defaultProfile).toBe('pwsh')
  })

  it('drops quick commands in an untrusted workspace', () => {
    const resolved = resolveTerminal({
      entries: [entry('root', rootConfig)],
      detectedProfiles: detected,
      settingsDefaultProfile: null,
      quickCommandsAllowed: false
    })
    expect(resolved.quickCommands).toEqual([])
  })
})

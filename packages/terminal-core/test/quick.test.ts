import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { TerminalQuickCommandInfo } from '@gitreedesk/shared'
import {
  applyCwdTemplate,
  buildCmdCommandLine,
  planQuickCommand,
  quoteCmdArgument,
  quoteCmdLine,
  shellCommandArgs
} from '../src/quick'

const dir = join('/', 'ws', 'app')

describe('applyCwdTemplate', () => {
  it('falls back to the terminal directory', () => {
    expect(applyCwdTemplate(null, { dir, repoRoot: null, workspaceRoot: '/' })).toBe(dir)
    expect(applyCwdTemplate('   ', { dir, repoRoot: null, workspaceRoot: '/' })).toBe(dir)
  })

  it('replaces {dir} and {workspaceRoot}', () => {
    const workspaceRoot = join('/', 'ws')
    const context = { dir, repoRoot: null, workspaceRoot }
    expect(applyCwdTemplate('{dir}/pkg', context)).toBe(`${dir}/pkg`)
    expect(applyCwdTemplate('{workspaceRoot}', context)).toBe(workspaceRoot)
  })

  it('uses the terminal directory when there is no repository root', () => {
    expect(applyCwdTemplate('{repoRoot}', { dir, repoRoot: null, workspaceRoot: '/' })).toBe(dir)
  })

  it('replaces {repoRoot} and matches tokens case-insensitively', () => {
    const repoRoot = join('/', 'ws', 'app')
    const context = { dir: join(repoRoot, 'src'), repoRoot, workspaceRoot: '/' }
    expect(applyCwdTemplate('{REPOROOT}/packages', context)).toBe(`${repoRoot}/packages`)
  })

  it('resolves a relative template against the terminal directory', () => {
    expect(applyCwdTemplate('scripts', { dir, repoRoot: null, workspaceRoot: '/' })).toBe(join(dir, 'scripts'))
  })
})

describe('quoteCmdArgument', () => {
  it('keeps safe tokens untouched', () => {
    expect(quoteCmdArgument('pnpm')).toBe('pnpm')
    expect(quoteCmdArgument('C:\\tools\\node.exe')).toBe('C:\\tools\\node.exe')
  })

  it('quotes tokens with spaces or metacharacters', () => {
    expect(quoteCmdArgument('C:\\Program Files\\x')).toBe('"C:\\Program Files\\x"')
    expect(quoteCmdArgument('a&b')).toBe('"a&b"')
    expect(quoteCmdArgument('')).toBe('""')
  })

  it('escapes embedded quotes and trailing backslashes', () => {
    expect(quoteCmdArgument('a"b')).toBe('"a\\"b"')
    expect(quoteCmdArgument('C:\\dir\\')).toBe('C:\\dir\\')
    expect(quoteCmdArgument('C:\\dir x\\')).toBe('"C:\\dir x\\\\"')
    expect(quoteCmdArgument('a\\"b')).toBe('"a\\\\\\"b"')
  })
})

describe('cmd command lines', () => {
  it('joins file and args with quoting', () => {
    expect(buildCmdCommandLine('C:\\foo bar\\pnpm.cmd', ['dev', 'x y'])).toBe('"C:\\foo bar\\pnpm.cmd" dev "x y"')
  })

  it('adds outer quotes only when the payload starts with a quote', () => {
    expect(quoteCmdLine('pnpm dev')).toBe('pnpm dev')
    expect(quoteCmdLine('"pnpm.cmd" dev')).toBe('""pnpm.cmd" dev"')
  })
})

describe('shellCommandArgs', () => {
  it('uses -Command for PowerShell', () => {
    expect(shellCommandArgs('C:\\pwsh.exe', ['-NoLogo'], 'echo 1', 'win32')).toEqual(['-NoLogo', '-Command', 'echo 1'])
  })

  it('uses /d /s /c for cmd', () => {
    expect(shellCommandArgs('cmd.exe', [], 'echo 1', 'win32')).toEqual(['/d', '/s', '/c', 'echo 1'])
  })

  it('routes WSL profiles through sh -lc', () => {
    expect(shellCommandArgs('wsl.exe', ['-d', 'Ubuntu'], 'npm test', 'win32')).toEqual([
      '-d',
      'Ubuntu',
      '--',
      'sh',
      '-lc',
      'npm test'
    ])
  })

  it('uses -c for POSIX shells', () => {
    expect(shellCommandArgs('/bin/bash', ['-l'], 'npm test', 'linux')).toEqual(['-l', '-c', 'npm test'])
  })
})

const command = (overrides: Partial<TerminalQuickCommandInfo>): TerminalQuickCommandInfo => ({
  name: 'run',
  command: 'pnpm',
  args: [],
  cwd: null,
  shellCommand: false,
  ...overrides
})

describe('planQuickCommand', () => {
  it('runs argv mode directly on POSIX', async () => {
    const plan = await planQuickCommand({
      command: command({ args: ['test'] }),
      profile: { shell: '/bin/bash', args: ['-l'] },
      context: { dir, repoRoot: null, workspaceRoot: '/' },
      platform: 'linux'
    })
    expect(plan).toEqual({ file: 'pnpm', args: ['test'], cwd: dir })
  })

  it('runs shellCommand mode through the profile shell', async () => {
    const plan = await planQuickCommand({
      command: command({ command: 'pnpm build && pnpm test', shellCommand: true }),
      profile: { shell: '/bin/bash', args: ['-l'] },
      context: { dir, repoRoot: null, workspaceRoot: '/' },
      platform: 'linux'
    })
    expect(plan).toEqual({ file: '/bin/bash', args: ['-l', '-c', 'pnpm build && pnpm test'], cwd: dir })
  })

  it('resolves the cwd template before planning', async () => {
    const repoRoot = join('/', 'ws', 'app')
    const plan = await planQuickCommand({
      command: command({ args: ['dev'], cwd: '{repoRoot}' }),
      profile: { shell: '/bin/bash', args: [] },
      context: { dir: join(repoRoot, 'src'), repoRoot, workspaceRoot: '/' },
      platform: 'linux'
    })
    expect(plan.cwd).toBe(repoRoot)
  })

  it('wraps a Windows .cmd through cmd.exe', async () => {
    const resolved = 'C:\\Program Files\\nodejs\\pnpm.cmd'
    const plan = await planQuickCommand({
      command: command({ args: ['dev'] }),
      profile: { shell: 'pwsh.exe', args: [] },
      context: { dir, repoRoot: null, workspaceRoot: '/' },
      platform: 'win32',
      resolveExecutable: () => Promise.resolve(resolved)
    })
    expect(plan.file).toBe('cmd.exe')
    expect(plan.args).toEqual(['/d', '/s', '/c', `""${resolved}" dev"`])
  })

  it('spawns a resolved .exe directly on Windows', async () => {
    const resolved = 'C:\\tools\\node.exe'
    const plan = await planQuickCommand({
      command: command({ command: 'node' }),
      profile: { shell: 'pwsh.exe', args: [] },
      context: { dir, repoRoot: null, workspaceRoot: '/' },
      platform: 'win32',
      resolveExecutable: () => Promise.resolve(resolved)
    })
    expect(plan).toEqual({ file: resolved, args: [], cwd: dir })
  })

  it('falls back to the raw command when resolution fails', async () => {
    const plan = await planQuickCommand({
      command: command({}),
      profile: { shell: 'pwsh.exe', args: [] },
      context: { dir, repoRoot: null, workspaceRoot: '/' },
      platform: 'win32',
      resolveExecutable: () => Promise.resolve(null)
    })
    expect(plan).toEqual({ file: 'pnpm', args: [], cwd: dir })
  })

  it('does not resolve executables in shellCommand mode', async () => {
    let called = false
    await planQuickCommand({
      command: command({ shellCommand: true }),
      profile: { shell: 'pwsh.exe', args: [] },
      context: { dir, repoRoot: null, workspaceRoot: '/' },
      platform: 'win32',
      resolveExecutable: () => {
        called = true
        return Promise.resolve(null)
      }
    })
    expect(called).toBe(false)
  })
})

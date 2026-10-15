import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync } from 'node:fs'
import { execSync } from 'node:child_process'

vi.mock('node:fs', () => ({
  existsSync: vi.fn()
}))

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
  execSync: vi.fn()
}))

vi.mock('electron', () => ({
  shell: { showItemInFolder: vi.fn() }
}))

import { resolveEditorCommand } from '../src/main/editor-launcher'

const mockedExistsSync = vi.mocked(existsSync)
const mockedExecSync = vi.mocked(execSync)

afterEach(() => {
  vi.restoreAllMocks()
  mockedExistsSync.mockReset()
  mockedExecSync.mockReset()
  delete process.env.LOCALAPPDATA
  delete process.env.ProgramFiles
  delete process.env['ProgramFiles(X86)']
})

describe('resolveEditorCommand', () => {
  it('returns the command unchanged on non-Windows platforms', () => {
    expect(resolveEditorCommand('code', 'linux')).toBe('code')
  })

  it('returns an explicit path unchanged', () => {
    expect(resolveEditorCommand('C:\\tools\\code.cmd', 'win32')).toBe('C:\\tools\\code.cmd')
    expect(resolveEditorCommand('/usr/bin/code', 'win32')).toBe('/usr/bin/code')
  })

  it('returns unknown editors unchanged', () => {
    expect(resolveEditorCommand('subl', 'win32')).toBe('subl')
  })

  it('resolves code to the standard install location when present', () => {
    process.env.LOCALAPPDATA = 'C:\\Users\\me\\AppData\\Local'
    mockedExistsSync.mockImplementation(
      (p: string) => p === 'C:\\Users\\me\\AppData\\Local\\Microsoft VS Code\\Code.exe'
    )
    expect(resolveEditorCommand('code', 'win32')).toBe(
      'C:\\Users\\me\\AppData\\Local\\Microsoft VS Code\\Code.exe'
    )
  })

  it('falls back to the bare command when no install location matches', () => {
    process.env.LOCALAPPDATA = 'C:\\Users\\me\\AppData\\Local'
    mockedExistsSync.mockReturnValue(false)
    mockedExecSync.mockReturnValue(Buffer.from(''))
    expect(resolveEditorCommand('code', 'win32')).toBe('code')
  })

  it('resolves a custom install directory through the App Paths registry', () => {
    // No standard location and no `code` on PATH.
    mockedExistsSync.mockImplementation((p: string) => p === 'C:\\Custom\\VSCode\\bin\\code.cmd')
    mockedExecSync.mockReturnValue(
      Buffer.from(
        'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Code.exe\r\n' +
          '    (Default)    REG_SZ    C:\\Custom\\VSCode\\Code.exe\r\n'
      )
    )
    expect(resolveEditorCommand('code', 'win32')).toBe('C:\\Custom\\VSCode\\bin\\code.cmd')
  })

  it('falls back to the GUI binary when the CLI shim is absent', () => {
    mockedExistsSync.mockImplementation((p: string) => p === 'C:\\Custom\\VSCode\\Code.exe')
    mockedExecSync.mockReturnValue(
      Buffer.from(
        'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Code.exe\r\n' +
          '    (Default)    REG_SZ    C:\\Custom\\VSCode\\Code.exe\r\n'
      )
    )
    expect(resolveEditorCommand('code', 'win32')).toBe('C:\\Custom\\VSCode\\Code.exe')
  })

  it('resolves code-insiders from its dedicated directory', () => {
    process.env.ProgramFiles = 'C:\\Program Files'
    mockedExistsSync.mockImplementation(
      (p: string) => p === 'C:\\Program Files\\Microsoft VS Code Insiders\\Code - Insiders.exe'
    )
    expect(resolveEditorCommand('code-insiders', 'win32')).toBe(
      'C:\\Program Files\\Microsoft VS Code Insiders\\Code - Insiders.exe'
    )
  })
})

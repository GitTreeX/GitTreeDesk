import { describe, expect, it } from 'vitest'
import { buildEditorCommand } from '../src/main/editor-command'

describe('buildEditorCommand', () => {
  it('opens a plain path when no line is given', () => {
    expect(buildEditorCommand('code', '/work/acme/src/main.ts', undefined, 'linux')).toBe(
      "'code' '/work/acme/src/main.ts'"
    )
  })

  it('uses --goto with a line number', () => {
    expect(buildEditorCommand('code', '/work/acme/src/main.ts', 42, 'linux')).toBe(
      "'code' '--goto' '/work/acme/src/main.ts:42'"
    )
  })

  it('quotes Windows paths with forward slashes preserved', () => {
    expect(buildEditorCommand('code', 'E:/work/acme/src/main.ts', 3, 'win32')).toBe(
      '"code" "--goto" "E:/work/acme/src/main.ts:3"'
    )
  })

  it('escapes single quotes for POSIX shells', () => {
    expect(buildEditorCommand('code', "/work/it's here/a.ts", undefined, 'darwin')).toBe(
      "'code' '/work/it'\\''s here/a.ts'"
    )
  })
})

import { describe, expect, it, vi } from 'vitest'
import { CommandRegistry, filterCommands, type CommandDefinition } from '../src/renderer/src/commands/registry'

function definition(id: string, overrides: Partial<CommandDefinition> = {}): CommandDefinition {
  return {
    id,
    titleKey: `commands.${id}`,
    categoryKey: 'commands.categories.workspace',
    run: () => undefined,
    ...overrides
  }
}

describe('CommandRegistry', () => {
  it('registers, lists, and looks up commands', () => {
    const registry = new CommandRegistry()
    registry.register(definition('a'))
    registry.register(definition('b'))
    expect(registry.list().map((entry) => entry.id)).toEqual(['a', 'b'])
    expect(registry.get('a')?.id).toBe('a')
    expect(registry.get('missing')).toBeUndefined()
  })

  it('runs enabled commands and reports success', async () => {
    const registry = new CommandRegistry()
    const run = vi.fn()
    registry.register(definition('a', { run }))
    await expect(registry.execute('a')).resolves.toBe(true)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('skips unknown and disabled commands', async () => {
    const registry = new CommandRegistry()
    const run = vi.fn()
    registry.register(definition('a', { run, enabled: () => false }))
    await expect(registry.execute('missing')).resolves.toBe(false)
    await expect(registry.execute('a')).resolves.toBe(false)
    expect(run).not.toHaveBeenCalled()
    expect(registry.isEnabled('a')).toBe(false)
    expect(registry.isEnabled('missing')).toBe(false)
  })
})

describe('filterCommands', () => {
  const items = [
    { id: 'workspace.openFolder', title: 'Open Folder…', category: 'Workspace' },
    { id: 'workspace.closeFolder', title: 'Close Folder', category: 'Workspace' },
    { id: 'appearance.cycleTheme', title: 'Change Theme', category: 'Appearance' },
    { id: 'view.toggleSidebar', title: 'Toggle Tree Sidebar', category: 'View' }
  ]

  it('returns everything for an empty query', () => {
    expect(filterCommands(items, '')).toHaveLength(4)
    expect(filterCommands(items, '   ')).toHaveLength(4)
  })

  it('matches case-insensitively on the title', () => {
    expect(filterCommands(items, 'theme').map((item) => item.id)).toEqual(['appearance.cycleTheme'])
    expect(filterCommands(items, 'FOLDER').map((item) => item.id)).toEqual([
      'workspace.openFolder',
      'workspace.closeFolder'
    ])
  })

  it('requires every token to match somewhere in the row', () => {
    expect(filterCommands(items, 'workspace folder').map((item) => item.id)).toEqual([
      'workspace.openFolder',
      'workspace.closeFolder'
    ])
    expect(filterCommands(items, 'workspace zzz')).toHaveLength(0)
  })

  it('matches on the category and id as well', () => {
    expect(filterCommands(items, 'appearance')).toHaveLength(1)
    expect(filterCommands(items, 'toggleSidebar').map((item) => item.id)).toEqual(['view.toggleSidebar'])
  })
})

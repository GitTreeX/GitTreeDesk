import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MenuItemConstructorOptions } from 'electron'

const mocks = vi.hoisted(() => ({
  buildFromTemplate: vi.fn(),
  setApplicationMenu: vi.fn()
}))

vi.mock('electron', () => ({
  Menu: {
    buildFromTemplate: (template: unknown) => {
      mocks.buildFromTemplate(template)
      return template
    },
    setApplicationMenu: mocks.setApplicationMenu
  },
  app: { name: 'GitTreeDesk', isPackaged: false }
}))

import { installApplicationMenu, resolveShellLocale } from '../src/main/menu'

const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')

function setPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { ...platformDescriptor, value })
}

function template(): MenuItemConstructorOptions[] {
  const latest = mocks.buildFromTemplate.mock.calls.at(-1)
  if (latest === undefined) throw new Error('no menu template was built')
  return latest[0] as MenuItemConstructorOptions[]
}

function submenu(menu: MenuItemConstructorOptions, label: string): MenuItemConstructorOptions[] {
  const item = (menu.submenu as MenuItemConstructorOptions[]).find((entry) => entry.label === label)
  if (item === undefined) throw new Error(`menu item ${label} not found`)
  return item.submenu as MenuItemConstructorOptions[]
}

afterEach(() => {
  if (platformDescriptor !== undefined) {
    Object.defineProperty(process, 'platform', platformDescriptor)
  }
  mocks.buildFromTemplate.mockClear()
  mocks.setApplicationMenu.mockClear()
})

describe('application menu', () => {
  it('puts Check for Updates and About in a Help menu off macOS', () => {
    setPlatform('win32')
    const send = vi.fn()
    installApplicationMenu('en', send)

    const menu = template()
    const help = menu.find((entry) => entry.label === 'Help')
    expect(help).toBeDefined()
    const items = help?.submenu as MenuItemConstructorOptions[]
    expect(items.map((entry) => entry.label)).toEqual([
      'Check for Updates…',
      undefined,
      'About GitTreeDesk'
    ])

    const [checkForUpdates, , about] = items
    expect(checkForUpdates.click).toBeTypeOf('function')
    ;(checkForUpdates.click as () => void)()
    expect(send).toHaveBeenCalledWith('app.checkForUpdates')

    expect(about.click).toBeTypeOf('function')
    ;(about.click as () => void)()
    expect(send).toHaveBeenCalledWith('app.about')
  })

  it('puts About and Check for Updates in the app menu on macOS', () => {
    setPlatform('darwin')
    const send = vi.fn()
    installApplicationMenu('en', send)

    const menu = template()
    expect(menu[0].label).toBe('GitTreeDesk')
    const appMenu = submenu({ submenu: menu } as MenuItemConstructorOptions, 'GitTreeDesk')
    const about = appMenu[0]
    expect(about.label).toBe('About GitTreeDesk')

    ;(about.click as () => void)()
    expect(send).toHaveBeenCalledWith('app.about')

    const checkForUpdates = appMenu[1]
    expect(checkForUpdates.label).toBe('Check for Updates…')
    ;(checkForUpdates.click as () => void)()
    expect(send).toHaveBeenCalledWith('app.checkForUpdates')
    // No separate Help menu: the app menu carries About on macOS.
    expect(menu.find((entry) => entry.label === 'Help')).toBeUndefined()
  })

  it('localizes the About and Check for Updates entries', () => {
    setPlatform('linux')
    installApplicationMenu('zh-Hans', vi.fn())

    const menu = template()
    const help = menu.find((entry) => entry.label === '帮助')
    expect(help).toBeDefined()
    const labels = (help?.submenu as MenuItemConstructorOptions[]).map((entry) => entry.label)
    expect(labels).toEqual(['检查更新…', undefined, '关于 GitTreeDesk'])
  })

  it('resolves the shell locale from the OS language', () => {
    expect(resolveShellLocale('zh-CN')).toBe('zh-Hans')
    expect(resolveShellLocale('zh-Hant-TW')).toBe('zh-Hans')
    expect(resolveShellLocale('en-US')).toBe('en')
    expect(resolveShellLocale(undefined)).toBe('en')
  })
})

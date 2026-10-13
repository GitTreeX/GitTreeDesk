import { Menu, app, type MenuItemConstructorOptions } from 'electron'
import type { HostCommandId } from '@gitreedesk/shared'

export type ShellLocale = 'en' | 'zh-Hans'

export function resolveShellLocale(value: unknown): ShellLocale {
  if (typeof value === 'string' && value.toLowerCase().startsWith('zh')) return 'zh-Hans'
  return 'en'
}

interface MenuLabels {
  file: string
  openFolder: string
  closeFolder: string
  quit: string
  closeWindow: string
  edit: string
  undo: string
  redo: string
  cut: string
  copy: string
  paste: string
  selectAll: string
  view: string
  commandPalette: string
  reload: string
  toggleDevTools: string
  window: string
  minimize: string
  zoom: string
}

const LABELS: Record<ShellLocale, MenuLabels> = {
  en: {
    file: 'File',
    openFolder: 'Open Folder…',
    closeFolder: 'Close Folder',
    quit: 'Exit',
    closeWindow: 'Close Window',
    edit: 'Edit',
    undo: 'Undo',
    redo: 'Redo',
    cut: 'Cut',
    copy: 'Copy',
    paste: 'Paste',
    selectAll: 'Select All',
    view: 'View',
    commandPalette: 'Command Palette',
    reload: 'Reload',
    toggleDevTools: 'Toggle Developer Tools',
    window: 'Window',
    minimize: 'Minimize',
    zoom: 'Zoom'
  },
  'zh-Hans': {
    file: '文件',
    openFolder: '打开文件夹…',
    closeFolder: '关闭文件夹',
    quit: '退出',
    closeWindow: '关闭窗口',
    edit: '编辑',
    undo: '撤销',
    redo: '重做',
    cut: '剪切',
    copy: '复制',
    paste: '粘贴',
    selectAll: '全选',
    view: '视图',
    commandPalette: '命令面板',
    reload: '重新加载',
    toggleDevTools: '切换开发者工具',
    window: '窗口',
    minimize: '最小化',
    zoom: '缩放'
  }
}

/**
 * Builds the application menu. Menu items never carry accelerators for
 * renderer-owned shortcuts: those are handled (and remappable) in the renderer,
 * and a menu accelerator would shadow the user's keybinding overrides.
 */
export function installApplicationMenu(
  locale: ShellLocale,
  sendCommand: (command: HostCommandId) => void
): void {
  const labels = LABELS[locale]
  const isMac = process.platform === 'darwin'

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' } as MenuItemConstructorOptions] : []),
    {
      label: labels.file,
      submenu: [
        { label: labels.openFolder, click: () => sendCommand('workspace.openFolder') },
        { label: labels.closeFolder, click: () => sendCommand('workspace.closeFolder') },
        { type: 'separator' },
        isMac
          ? { role: 'close', label: labels.closeWindow }
          : { role: 'quit', label: labels.quit }
      ]
    },
    {
      label: labels.edit,
      submenu: [
        { role: 'undo', label: labels.undo },
        { role: 'redo', label: labels.redo },
        { type: 'separator' },
        { role: 'cut', label: labels.cut },
        { role: 'copy', label: labels.copy },
        { role: 'paste', label: labels.paste },
        { role: 'selectAll', label: labels.selectAll }
      ]
    },
    {
      label: labels.view,
      submenu: [
        { label: labels.commandPalette, click: () => sendCommand('view.commandPalette') },
        ...(app.isPackaged
          ? []
          : ([
              { type: 'separator' },
              { role: 'reload', label: labels.reload, accelerator: 'F5' },
              { role: 'toggleDevTools', label: labels.toggleDevTools, accelerator: 'F12' }
            ] satisfies MenuItemConstructorOptions[]))
      ]
    },
    {
      label: labels.window,
      submenu: [
        { role: 'minimize', label: labels.minimize },
        ...(isMac ? [{ role: 'zoom', label: labels.zoom } as MenuItemConstructorOptions] : []),
        { role: 'close', label: labels.closeWindow }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

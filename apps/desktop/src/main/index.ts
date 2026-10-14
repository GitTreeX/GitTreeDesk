import { BrowserWindow, app, nativeTheme, safeStorage, shell } from 'electron'
import { join } from 'node:path'
import type { HostCommandId } from '@gitreedesk/shared'
import { createEventBroadcaster, registerIpcHandlers, type IpcBridge } from './ipc'
import { installApplicationMenu, resolveShellLocale, type ShellLocale } from './menu'
import { CommitMessageService } from './services/commit-message'
import { SecretsStore, type SecretCodec } from './services/secrets'
import { TerminalService } from './services/terminal'
import { WorkspaceService } from './services/workspace-service'
import { electronTerminalRuntime } from './terminal-runtime'

const devServerUrl = process.env['ELECTRON_RENDERER_URL']

app.setName('GitTreeDesk')

/** OS-backed codec; a Linux session without a keyring keeps secrets in memory only. */
function secretCodec(): SecretCodec {
  const available =
    safeStorage.isEncryptionAvailable() &&
    !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
  return {
    available,
    encrypt: (text) => safeStorage.encryptString(text).toString('base64'),
    decrypt: (token) => safeStorage.decryptString(Buffer.from(token, 'base64'))
  }
}

function sendCommand(command: HostCommandId): void {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  if (win === undefined || win.isDestroyed()) return
  win.webContents.send('app:command', { command })
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 940,
    minHeight: 560,
    show: false,
    title: 'GitTreeDesk',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#121214' : '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })

  win.once('ready-to-show', () => {
    win.show()
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    const isInternal = devServerUrl ? url.startsWith(devServerUrl) : url.startsWith('file:')
    if (isInternal) return

    event.preventDefault()
    if (url.startsWith('http:') || url.startsWith('https:')) {
      void shell.openExternal(url)
    }
  })

  if (devServerUrl !== undefined && devServerUrl !== '') {
    void win.loadURL(devServerUrl)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  let bridge: IpcBridge | null = null
  let service: WorkspaceService | null = null

  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows()
    if (win === undefined) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })

  void app.whenReady().then(() => {
    const broadcaster = createEventBroadcaster()
    let shellLocale: ShellLocale = 'en'
    const syncShellLocale = async (): Promise<void> => {
      if (service === null) return
      try {
        const { value } = await service.settingsGetEffective(['locale'])
        const next = resolveShellLocale(value)
        if (next === shellLocale) return
        shellLocale = next
        installApplicationMenu(shellLocale, sendCommand)
      } catch {
        // The service is disposed during shutdown; the menu no longer matters.
      }
    }

    const userDataDir = app.getPath('userData')
    service = new WorkspaceService({
      userDataDir,
      emit: (event) => {
        broadcaster.handle(event)
        if (event.type === 'settingsChanged' && event.change.keyPath[0] === 'locale') {
          void syncShellLocale()
        }
      }
    })
    const workspace = service
    const commitMessages = new CommitMessageService({
      userDataDir,
      secrets: new SecretsStore({ userDataDir, codec: secretCodec() }),
      resolveRepoPath: (gitDir) => workspace.resolveWorktreePath(gitDir),
      emit: (event) => {
        broadcaster.handleCommitMessage(event)
      }
    })
    const terminals = new TerminalService({
      workspace,
      runtime: electronTerminalRuntime(),
      emit: (event) => {
        broadcaster.handleTerminal(event)
      }
    })
    installApplicationMenu(shellLocale, sendCommand)
    void syncShellLocale()
    bridge = registerIpcHandlers(workspace, commitMessages, terminals)
    app.on('will-quit', () => {
      bridge?.dispose()
      bridge = null
      broadcaster.dispose()
      commitMessages.dispose()
      terminals.dispose()
      void service?.dispose()
      service = null
    })

    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}

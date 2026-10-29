import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateSnapshot } from '@gitreedesk/shared'
import {
  createUpdateService,
  type UpdaterAdapter,
  type UpdateService
} from './update-service'

declare const __APP_VERSION__: string

// In development Electron reports its own version from app.getVersion(), so the
// root package version (injected at build time) is the meaningful current one.
export function createDesktopUpdateService(
  onChange: (snapshot: UpdateSnapshot) => void
): UpdateService {
  return createUpdateService(
    autoUpdater as unknown as UpdaterAdapter,
    {
      currentVersion: app.isPackaged ? app.getVersion() : __APP_VERSION__,
      platform: process.platform,
      isPackaged: app.isPackaged,
      appImage: Boolean(process.env.APPIMAGE)
    },
    onChange
  )
}

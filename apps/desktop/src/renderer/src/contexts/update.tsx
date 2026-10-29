import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type ReactNode
} from 'react'
import { useTranslation } from 'react-i18next'
import { UPDATE_RELEASES_URL, type UpdateSnapshot } from '@gitreedesk/shared'
import { api } from '../api'
import { notifyError } from '../notify'

const STARTUP_CHECK_DELAY_MS = 4000

export interface UpdateContextValue {
  snapshot: UpdateSnapshot | null
  dialogOpen: boolean
  noticeVisible: boolean
  check: () => void
  openDialog: () => void
  closeDialog: () => void
  download: () => void
  install: () => void
  startUpdate: () => void
  dismissNotice: () => void
  openReleases: () => void
}

const UpdateContext = createContext<UpdateContextValue | null>(null)

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function UpdateProvider({ children }: { children: ReactNode }): JSX.Element {
  const { t } = useTranslation()
  const [snapshot, setSnapshot] = useState<UpdateSnapshot | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [noticeVisible, setNoticeVisible] = useState(false)
  const dialogOpenRef = useRef(dialogOpen)
  dialogOpenRef.current = dialogOpen

  useEffect(() => {
    return api.on('update:changed', (next) => {
      setSnapshot(next)
      setNoticeVisible((visible) => visible && next.status === 'available')
    })
  }, [])

  // Seed the current version so a manual check can show it before the first
  // snapshot arrives.
  useEffect(() => {
    let live = true
    void api.invoke('app:info').then(
      (info) => {
        if (!live) return
        setSnapshot((current) =>
          current ?? {
            status: 'idle',
            currentVersion: info.version,
            version: null,
            releaseNotes: null,
            releaseDate: null,
            progress: null,
            transferred: null,
            total: null,
            bytesPerSecond: null,
            error: null,
            reason: null,
            manualDownloadUrl: UPDATE_RELEASES_URL
          }
        )
      },
      () => undefined
    )
    return () => {
      live = false
    }
  }, [])

  // A quiet startup check surfaces an available update without opening a dialog.
  useEffect(() => {
    const timer = setTimeout(() => {
      void api.invoke('update:check').then((next) => {
        setSnapshot(next)
        if (next.status === 'available' && !dialogOpenRef.current) setNoticeVisible(true)
      }, () => undefined)
    }, STARTUP_CHECK_DELAY_MS)
    return () => clearTimeout(timer)
  }, [])

  const check = useCallback(() => {
    setNoticeVisible(false)
    setDialogOpen(true)
    void api.invoke('update:check').then(setSnapshot, (error: unknown) => {
      notifyError(t('update.checkFailed'), errorText(error))
    })
  }, [t])

  const openDialog = useCallback(() => {
    setNoticeVisible(false)
    setDialogOpen(true)
  }, [])

  const closeDialog = useCallback(() => setDialogOpen(false), [])

  const download = useCallback(() => {
    setNoticeVisible(false)
    void api.invoke('update:download').catch(() => undefined)
  }, [])

  const install = useCallback(() => {
    void api.invoke('update:install').catch((error: unknown) => {
      notifyError(t('update.installFailed'), errorText(error))
    })
  }, [t])

  const startUpdate = useCallback(() => {
    setDialogOpen(true)
    download()
  }, [download])

  const dismissNotice = useCallback(() => setNoticeVisible(false), [])

  const openReleases = useCallback(() => {
    const version = snapshot?.version
    const url =
      version === null || version === undefined
        ? snapshot?.manualDownloadUrl ?? UPDATE_RELEASES_URL
        : `${UPDATE_RELEASES_URL}/tag/v${version}`
    window.open(url, '_blank', 'noopener,noreferrer')
  }, [snapshot])

  const value = useMemo<UpdateContextValue>(
    () => ({
      snapshot,
      dialogOpen,
      noticeVisible,
      check,
      openDialog,
      closeDialog,
      download,
      install,
      startUpdate,
      dismissNotice,
      openReleases
    }),
    [
      snapshot,
      dialogOpen,
      noticeVisible,
      check,
      openDialog,
      closeDialog,
      download,
      install,
      startUpdate,
      dismissNotice,
      openReleases
    ]
  )

  return <UpdateContext.Provider value={value}>{children}</UpdateContext.Provider>
}

export function useUpdate(): UpdateContextValue {
  const context = useContext(UpdateContext)
  if (context === null) throw new Error('useUpdate must be used inside UpdateProvider')
  return context
}

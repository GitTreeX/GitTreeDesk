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
import { GtdIpcError } from '@gitreedesk/shared'
import type { TerminalHostFrame, TerminalResolutionInfo, TerminalSessionInfo } from '@gitreedesk/shared'
import { api } from '../api'
import { notifyServiceError } from '../lib/reporting'
import { defaultProfileId, normalizeScrollback, DEFAULT_SCROLLBACK } from '../lib/terminal'
import { useUiState } from '../use-ui-state'
import { useReposUi } from './repos'
import { useWorkspace } from './workspace'

/** Delivers one host frame to the mounted view of a session. */
export type TerminalFrameListener = (frame: TerminalHostFrame) => void

export interface TerminalResolution {
  /** Normalized directory the resolution was made for. */
  dir: string
  info: TerminalResolutionInfo
}

interface TerminalContextValue {
  sessions: readonly TerminalSessionInfo[]
  activeId: string | null
  activeSession: TerminalSessionInfo | null
  visible: boolean
  setVisible: (visible: boolean) => void
  toggle: () => void
  /** Directory the toolbar, quick commands and `+` act on. */
  targetDir: string | null
  /** Profiles and quick commands for {@link targetDir}; `null` while loading. */
  resolution: TerminalResolution | null
  /** Starts a session at `dir`; without a profile the resolved default is used. */
  open: (dir: string, options?: { profileId?: string }) => void
  quickRun: (dir: string, name: string) => void
  activate: (id: string) => void
  /** Forgets a session in the main process, killing a running shell first. */
  closeSession: (id: string) => void
  subscribe: (id: string, listener: TerminalFrameListener) => () => void
  /** Effective scrollback lines for new and mounted views. */
  scrollback: number
}

const TerminalContext = createContext<TerminalContextValue | null>(null)

const VISIBLE_KEY = 'terminal.visible'
const SCROLLBACK_KEY = ['terminal', 'scrollback']
/** Size a session is created with; the mounted view resizes it to the panel. */
const CREATE_COLS = 80
const CREATE_ROWS = 24

function sanitizeVisible(stored: unknown): boolean | null {
  return typeof stored === 'boolean' ? stored : null
}

export function TerminalProvider({ children }: { children: ReactNode }): JSX.Element {
  const workspace = useWorkspace()
  const repoUi = useReposUi()
  const { t } = useTranslation()
  const root = workspace.descriptor?.root ?? null
  const trusted = workspace.descriptor?.trusted === true

  const [sessions, setSessions] = useState<readonly TerminalSessionInfo[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [visible, setVisibleState] = useUiState<boolean>(VISIBLE_KEY, false, sanitizeVisible)
  const [resolution, setResolution] = useState<TerminalResolution | null>(null)
  const [scrollback, setScrollback] = useState(DEFAULT_SCROLLBACK)
  const frameListeners = useRef(new Map<string, Set<TerminalFrameListener>>())

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeId) ?? null,
    [sessions, activeId]
  )
  const targetDir = activeSession?.cwd ?? repoUi.activeRecord?.path ?? root

  // Sessions live in the main process: a renderer reload re-lists and re-attaches them.
  useEffect(() => {
    let live = true
    void api.invoke('terminal:sessions').then(
      ({ sessions: listed }) => {
        if (live) setSessions(listed)
      },
      () => undefined
    )
    return () => {
      live = false
    }
  }, [root])

  // One subscription fans frames out to the mounted views.
  useEffect(() => {
    return api.on('terminal:frame', ({ id, frame }) => {
      const listeners = frameListeners.current.get(id)
      if (listeners === undefined) return
      for (const listener of listeners) listener(frame)
    })
  }, [])

  useEffect(() => {
    return api.on('terminal:exited', ({ id, code }) => {
      setSessions((current) =>
        current.map((session) =>
          session.id === id ? { ...session, running: false, exitCode: code } : session
        )
      )
    })
  }, [])

  // The active tab follows its session out of the list.
  useEffect(() => {
    if (activeId !== null && sessions.some((session) => session.id === activeId)) return
    setActiveId(sessions[sessions.length - 1]?.id ?? null)
  }, [sessions, activeId])

  useEffect(() => {
    if (targetDir === null || root === null) {
      setResolution(null)
      return
    }
    let live = true
    void api.invoke('terminal:resolve', { dir: targetDir }).then(
      (info) => {
        if (live) setResolution({ dir: info.dir, info })
      },
      () => {
        if (live) setResolution(null)
      }
    )
    return () => {
      live = false
    }
  }, [targetDir, root, trusted])

  useEffect(() => {
    let live = true
    const load = (): void => {
      void api.invoke('settings:getEffective', { keyPath: SCROLLBACK_KEY }).then(
        ({ value }) => {
          if (live) setScrollback(normalizeScrollback(value))
        },
        () => undefined
      )
    }
    load()
    const unsubscribe = api.on('settings:changed', (change) => {
      if (change.keyPath.join('.') === SCROLLBACK_KEY.join('.')) load()
    })
    return () => {
      live = false
      unsubscribe()
    }
  }, [])

  const addSession = useCallback(
    (session: TerminalSessionInfo) => {
      setSessions((current) => [...current, session])
      setActiveId(session.id)
      setVisibleState(true)
    },
    [setVisibleState]
  )

  const open = useCallback(
    (dir: string, options?: { profileId?: string }) => {
      void (async () => {
        try {
          let profileId = options?.profileId
          if (profileId === undefined) {
            const info = await api.invoke('terminal:resolve', { dir })
            const selected = defaultProfileId(info)
            if (selected === null) {
              throw new GtdIpcError('no-profiles', 'No shell profile is available')
            }
            profileId = selected
          }
          const { session } = await api.invoke('terminal:create', {
            dir,
            profileId,
            cols: CREATE_COLS,
            rows: CREATE_ROWS
          })
          addSession(session)
        } catch (error) {
          notifyServiceError(error, t)
        }
      })()
    },
    [addSession, t]
  )

  const quickRun = useCallback(
    (dir: string, name: string) => {
      void (async () => {
        try {
          const { session } = await api.invoke('terminal:quickRun', {
            dir,
            name,
            cols: CREATE_COLS,
            rows: CREATE_ROWS
          })
          addSession(session)
        } catch (error) {
          notifyServiceError(error, t)
        }
      })()
    },
    [addSession, t]
  )

  const activate = useCallback((id: string) => setActiveId(id), [])

  const closeSession = useCallback(
    (id: string) => {
      void api.invoke('terminal:dispose', { id }).catch((error: unknown) => {
        notifyServiceError(error, t)
      })
      setSessions((current) => current.filter((session) => session.id !== id))
    },
    [t]
  )

  const toggle = useCallback(() => setVisibleState(!visible), [setVisibleState, visible])

  const subscribe = useCallback((id: string, listener: TerminalFrameListener) => {
    let listeners = frameListeners.current.get(id)
    if (listeners === undefined) {
      listeners = new Set()
      frameListeners.current.set(id, listeners)
    }
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) frameListeners.current.delete(id)
    }
  }, [])

  const value = useMemo(
    () => ({
      sessions,
      activeId,
      activeSession,
      visible,
      setVisible: setVisibleState,
      toggle,
      targetDir,
      resolution,
      open,
      quickRun,
      activate,
      closeSession,
      subscribe,
      scrollback
    }),
    [
      sessions,
      activeId,
      activeSession,
      visible,
      setVisibleState,
      toggle,
      targetDir,
      resolution,
      open,
      quickRun,
      activate,
      closeSession,
      subscribe,
      scrollback
    ]
  )

  return <TerminalContext.Provider value={value}>{children}</TerminalContext.Provider>
}

export function useTerminal(): TerminalContextValue {
  const value = useContext(TerminalContext)
  if (value === null) throw new Error('useTerminal requires a TerminalProvider')
  return value
}

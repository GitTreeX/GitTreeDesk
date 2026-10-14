import { useEffect, useRef, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { Terminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import type { TerminalSessionInfo } from '@gitreedesk/shared'
import { api } from '../api'
import { useEditor } from '../contexts/editor'
import { useSettings } from '../contexts/settings'
import { useTerminal } from '../contexts/terminal'
import { i18n } from '../i18n'
import { findPathLinks, resolveLinkPath, type PathLink } from '../lib/terminal-links'
import { notify } from '../notify'
import { resolveTheme, type ThemePreference } from '../theme'

type XtermLinkProvider = Parameters<Terminal['registerLinkProvider']>[0]
type XtermLinks = Parameters<Parameters<XtermLinkProvider['provideLinks']>[1]>[0]

const DARK_THEME: ITheme = {
  background: '#121214',
  foreground: '#e4e4e7',
  cursor: '#e4e4e7',
  selectionBackground: '#3b82f666'
}

const LIGHT_THEME: ITheme = {
  background: '#ffffff',
  foreground: '#18181b',
  cursor: '#18181b',
  selectionBackground: '#2563eb33'
}

function themeFor(preference: ThemePreference): ITheme {
  const resolved = resolveTheme(preference, window.matchMedia('(prefers-color-scheme: dark)').matches)
  return resolved === 'dark' ? DARK_THEME : LIGHT_THEME
}

/** Ctrl/Cmd+C copies a selection and otherwise falls through as SIGINT. */
function installCopySupport(term: Terminal): void {
  const usesMeta = api.platform === 'darwin'
  term.attachCustomKeyEventHandler((event) => {
    if (event.type !== 'keydown') return true
    const modifier = usesMeta ? event.metaKey : event.ctrlKey
    if (!modifier || event.altKey || event.shiftKey) return true
    if (event.key.toLowerCase() !== 'c' || !term.hasSelection()) return true
    event.preventDefault()
    const selection = term.getSelection()
    if (selection.length > 0) {
      void api.invoke('app:copyText', { text: selection }).catch(() => undefined)
    }
    return false
  })
}

/** Multi-line pastes ask for confirmation before reaching the shell. */
function installPasteGuard(container: HTMLElement, term: Terminal): () => void {
  const onPaste = (event: ClipboardEvent): void => {
    const text = event.clipboardData?.getData('text/plain') ?? ''
    if (!/[\r\n]/.test(text)) return
    event.preventDefault()
    event.stopPropagation()
    const lines = text.split(/\r?\n/).filter((line) => line.length > 0).length
    notify({
      message:
        lines === 1
          ? i18n.t('terminal.pasteWarningOne')
          : i18n.t('terminal.pasteWarning', { count: lines }),
      action: {
        label: i18n.t('terminal.pasteAction'),
        run: () => term.paste(text.replace(/\r?\n/g, '\r'))
      }
    })
  }
  container.addEventListener('paste', onPaste, true)
  return () => container.removeEventListener('paste', onPaste, true)
}

/** Maps a string index in a line to a 1-based buffer column. */
function columnAt(line: { length: number; getCell: (x: number) => { getWidth(): number } | undefined }, index: number): number {
  let column = 1
  let chars = 0
  for (let x = 0; x < line.length && chars < index; x += 1) {
    const width = line.getCell(x)?.getWidth() ?? 1
    if (width === 0) continue
    column += width
    chars += 1
  }
  return column
}

interface LinkTargets {
  cwd: () => string
  openFile: (path: string, options?: { line?: number }) => void
}

async function activatePathLink(link: PathLink, targets: LinkTargets): Promise<void> {
  const path = resolveLinkPath(targets.cwd(), link.path)
  try {
    const stat = await api.invoke('fs:stat', { path })
    if (!stat.exists || stat.kind === 'dir') return
  } catch {
    return
  }
  targets.openFile(path, { line: link.line })
}

function createPathLinkProvider(term: Terminal, targets: LinkTargets): XtermLinkProvider {
  return {
    provideLinks(bufferLineNumber, callback) {
      const line = term.buffer.active.getLine(bufferLineNumber - 1)
      if (line === undefined) {
        callback(undefined)
        return
      }
      const found = findPathLinks(line.translateToString(true))
      if (found.length === 0) {
        callback(undefined)
        return
      }
      callback(
        found.map((link) => ({
          text: link.text,
          range: {
            start: { x: columnAt(line, link.start), y: bufferLineNumber },
            end: { x: columnAt(line, link.end), y: bufferLineNumber }
          },
          activate: () => {
            void activatePathLink(link, targets)
          }
        })) satisfies XtermLinks
      )
    }
  }
}

export function TerminalView({
  session,
  active
}: {
  session: TerminalSessionInfo
  active: boolean
}): JSX.Element {
  const { t } = useTranslation()
  const terminal = useTerminal()
  const editor = useEditor()
  const settings = useSettings()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const activeRef = useRef(active)
  activeRef.current = active
  const cwdRef = useRef(session.cwd)
  cwdRef.current = session.cwd
  const editorRef = useRef(editor)
  editorRef.current = editor
  const scrollbackRef = useRef(terminal.scrollback)
  scrollbackRef.current = terminal.scrollback
  const themeRef = useRef(settings.theme)
  themeRef.current = settings.theme

  const sessionId = session.id
  const subscribe = terminal.subscribe

  useEffect(() => {
    const container = containerRef.current
    if (container === null) return
    const term = new Terminal({
      scrollback: scrollbackRef.current,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: 13,
      cursorBlink: true,
      theme: themeFor(themeRef.current)
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(
      new WebLinksAddon((_event, uri) => {
        void api.invoke('fs:openExternal', { path: uri }).catch(() => undefined)
      })
    )
    term.open(container)
    termRef.current = term

    const fitNow = (): void => {
      if (container.clientWidth === 0 || container.clientHeight === 0) return
      try {
        fit.fit()
      } catch {
        // Hidden or detached; the observer retries when the panel is shown again.
      }
    }
    fitNow()

    const sendSize = (): void => {
      void api
        .invoke('terminal:resize', { id: sessionId, cols: term.cols, rows: term.rows })
        .catch(() => undefined)
    }
    const onData = term.onData((data) => {
      void api.invoke('terminal:write', { id: sessionId, data }).catch(() => undefined)
    })
    const onResize = term.onResize(() => sendSize())

    installCopySupport(term)
    const detachPasteGuard = installPasteGuard(container, term)
    const linkDisposable = term.registerLinkProvider(
      createPathLinkProvider(term, {
        cwd: () => cwdRef.current,
        openFile: (path, options) => editorRef.current.openFile(path, options)
      })
    )

    // Subscribe before attach so the replayed frames are never dropped.
    const unsubscribe = subscribe(sessionId, (frame) => {
      if (frame.t === 'data') term.write(frame.data)
    })

    void api.invoke('terminal:attach', { id: sessionId }).then(
      () => {
        // The pty may have missed the first fit: it ran before the attach. Catch it up.
        sendSize()
      },
      (error: unknown) => {
        term.write(`\r\n\x1b[2m${i18n.t('terminal.attachFailed')}\x1b[0m\r\n`)
        console.error('[terminal] attach failed', error)
      }
    )

    const observer = new ResizeObserver(() => {
      if (activeRef.current) fitNow()
    })
    observer.observe(container)
    void document.fonts.ready.then(() => {
      if (activeRef.current) fitNow()
    })

    return () => {
      observer.disconnect()
      linkDisposable.dispose()
      detachPasteGuard()
      onResize.dispose()
      onData.dispose()
      unsubscribe()
      term.dispose()
      termRef.current = null
    }
  }, [sessionId, subscribe])

  // Theme changes apply to the live terminal without rebuilding it.
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      if (termRef.current !== null) termRef.current.options.theme = themeFor(settings.theme)
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [settings.theme])

  useEffect(() => {
    if (termRef.current !== null) termRef.current.options.scrollback = terminal.scrollback
  }, [terminal.scrollback])

  useEffect(() => {
    if (active) termRef.current?.focus()
  }, [active])

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      <div className="min-h-0 flex-1 px-2 pt-1">
        <div ref={containerRef} data-session-id={session.id} className="h-full w-full overflow-hidden" />
      </div>
      {!session.running && (
        <div className="shrink-0 border-t border-line px-3 py-1 text-xs text-muted">
          {session.exitCode === null
            ? t('terminal.exitedUnknown')
            : t('terminal.exited', { code: session.exitCode })}
        </div>
      )}
    </div>
  )
}

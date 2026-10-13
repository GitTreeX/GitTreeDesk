import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { FsReadFileResponse } from '@gitreedesk/shared'
import { api } from '../api'
import { useEditor, type FileTab, type FileTabActions } from '../contexts/editor'
import { useWorkspace } from '../contexts/workspace'
import { ensureLanguage, isTsMode, languageIdForPath } from '../editor/languages'
import { loadMonaco, type StandaloneEditor, type TextModel } from '../editor/monaco'
import { applyNearestTsconfig } from '../editor/ts-config'
import { notifyError } from '../notify'
import { SnapshotDiffView } from './SnapshotDiffView'

const DEFAULT_FONT_FAMILY = "Menlo, Monaco, 'Courier New', monospace"

type DocState =
  | { status: 'loading' }
  | { status: 'text'; text: string; readOnly: boolean }
  | { status: 'image'; dataUrl: string; size: number }
  | { status: 'binary'; size: number }
  | { status: 'tooLarge'; size: number }
  | { status: 'missing' }
  | { status: 'error'; message: string }

interface ConflictInfo {
  diskText: string
  diskMtimeMs: number
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}

export function FileEditor({ tab, active }: { tab: FileTab; active: boolean }): JSX.Element {
  const { t } = useTranslation()
  const editorCtx = useEditor()
  const { descriptor } = useWorkspace()
  const settings = editorCtx.settings

  const [doc, setDoc] = useState<DocState>({ status: 'loading' })
  const [ready, setReady] = useState(false)
  const [deleted, setDeleted] = useState(false)
  const [conflict, setConflict] = useState<ConflictInfo | null>(null)
  const [diskDiff, setDiskDiff] = useState<ConflictInfo | null>(null)

  const containerRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<StandaloneEditor | null>(null)
  const modelRef = useRef<TextModel | null>(null)
  const savedTextRef = useRef('')
  const mtimeRef = useRef(0)
  const readOnlyRef = useRef(false)
  const mountedRef = useRef(false)

  useEffect(() => {
    readOnlyRef.current = doc.status === 'text' && doc.readOnly
  }, [doc])

  const applyResponse = useCallback((response: FsReadFileResponse, readOnly: boolean): void => {
    if (!response.exists) {
      setDoc({ status: 'missing' })
      return
    }
    if (response.kind === 'text' && response.text !== null) {
      savedTextRef.current = response.text
      mtimeRef.current = response.mtimeMs
      setDeleted(false)
      setDoc({ status: 'text', text: response.text, readOnly })
      return
    }
    if (response.kind === 'image' && response.dataUrl !== null) {
      setDoc({ status: 'image', dataUrl: response.dataUrl, size: response.size })
      return
    }
    if (response.kind === 'binary') {
      setDoc({ status: 'binary', size: response.size })
      return
    }
    setDoc({ status: 'tooLarge', size: response.size })
  }, [])

  useEffect(() => {
    let live = true
    setDoc({ status: 'loading' })
    void (async () => {
      try {
        const response = await api.invoke('fs:readFile', { path: tab.path })
        if (!live) return
        applyResponse(response, false)
      } catch (error) {
        if (live) setDoc({ status: 'error', message: errorText(error) })
      }
    })()
    return () => {
      live = false
    }
  }, [tab.path, applyResponse])

  const openExternal = useCallback(async (): Promise<void> => {
    try {
      await api.invoke('fs:openExternal', { path: tab.path })
    } catch (error) {
      notifyError(errorText(error))
    }
  }, [tab.path])

  const loadLarge = useCallback(async (): Promise<void> => {
    try {
      const response = await api.invoke('fs:readFile', { path: tab.path, allowLarge: true })
      if (response.kind === 'text' && response.text !== null) {
        applyResponse(response, true)
        return
      }
      // Past the hard limit even for an explicit request; the OS viewer is the way in.
      await openExternal()
    } catch (error) {
      notifyError(errorText(error))
    }
  }, [tab.path, applyResponse, openExternal])

  // Editor lifecycle: one Monaco editor per text document.
  useEffect(() => {
    if (doc.status !== 'text' || mountedRef.current) return
    mountedRef.current = true
    let disposed = false
    void (async () => {
      try {
        const monaco = await loadMonaco()
        const container = containerRef.current
        if (disposed || container === null) return
        const language = languageIdForPath(tab.path)
        await ensureLanguage(monaco, language)
        if (disposed) return
        if (isTsMode(language)) {
          void applyNearestTsconfig(descriptor?.root ?? '', tab.path, language === 'typescript' ? 'typescript' : 'javascript')
        }
        const model = monaco.editor.createModel(doc.text, language)
        model.updateOptions({ tabSize: settings.tabSize, insertSpaces: settings.insertSpaces })
        const editor = monaco.editor.create(container, {
          model,
          readOnly: doc.readOnly,
          automaticLayout: true,
          minimap: { enabled: settings.minimap },
          fontSize: settings.fontSize,
          fontFamily: settings.fontFamily !== '' ? settings.fontFamily : DEFAULT_FONT_FAMILY,
          wordWrap: settings.wordWrap ? 'on' : 'off',
          scrollBeyondLastLine: false,
          renderWhitespace: 'selection',
          fixedOverflowWidgets: true
        })
        editor.onDidChangeModelContent(() => {
          editorCtx.setTabDirty(tab.id, editor.getValue() !== savedTextRef.current)
        })
        editorRef.current = editor
        modelRef.current = model
        setReady(true)
      } catch (error) {
        mountedRef.current = false
        setDoc({ status: 'error', message: errorText(error) })
      }
    })()
    return () => {
      disposed = true
      mountedRef.current = false
      setReady(false)
      editorRef.current?.dispose()
      modelRef.current?.dispose()
      editorRef.current = null
      modelRef.current = null
    }
  }, [tab.id, doc.status])

  // Live editor settings.
  useEffect(() => {
    const editor = editorRef.current
    if (editor === null) return
    editor.updateOptions({
      minimap: { enabled: settings.minimap },
      fontSize: settings.fontSize,
      fontFamily: settings.fontFamily !== '' ? settings.fontFamily : DEFAULT_FONT_FAMILY,
      wordWrap: settings.wordWrap ? 'on' : 'off'
    })
    modelRef.current?.updateOptions({ tabSize: settings.tabSize, insertSpaces: settings.insertSpaces })
  }, [settings, ready])

  useEffect(() => {
    const editor = editorRef.current
    if (!ready || editor === null || tab.line === undefined) return
    const lineCount = editor.getModel()?.getLineCount() ?? tab.line
    const line = Math.min(Math.max(1, tab.line), lineCount)
    editor.revealLineInCenter(line)
    editor.setPosition({ lineNumber: line, column: 1 })
    editor.focus()
  }, [ready, tab.focusTicket, tab.line])

  const writeNow = useCallback(
    async (text: string, expectedMtimeMs: number | undefined): Promise<void> => {
      const result = await api.invoke('fs:writeFile', {
        path: tab.path,
        text,
        ...(expectedMtimeMs === undefined ? {} : { expectedMtimeMs })
      })
      savedTextRef.current = text
      mtimeRef.current = result.mtimeMs
      setDeleted(false)
      editorCtx.setTabDirty(tab.id, false)
    },
    [editorCtx, tab.id, tab.path]
  )

  const readDisk = useCallback(async (): Promise<ConflictInfo | null> => {
    const response = await api.invoke('fs:readFile', { path: tab.path, allowLarge: true })
    if (!response.exists || response.text === null) return null
    return { diskText: response.text, diskMtimeMs: response.mtimeMs }
  }, [tab.path])

  const save = useCallback(async (): Promise<boolean> => {
    const editor = editorRef.current
    if (editor === null || readOnlyRef.current) return true
    const text = editor.getValue()
    if (text === savedTextRef.current) {
      editorCtx.setTabDirty(tab.id, false)
      return true
    }
    try {
      const probe = await api.invoke('fs:stat', { path: tab.path })
      if (probe.exists && probe.mtimeMs !== mtimeRef.current) {
        const disk = await readDisk()
        setConflict(disk)
        return false
      }
      // A missing file means the buffer recreates it; there is nothing to clobber.
      await writeNow(text, probe.exists ? mtimeRef.current : undefined)
      return true
    } catch (error) {
      notifyError(errorText(error))
      return false
    }
  }, [editorCtx, readDisk, tab.id, tab.path, writeNow])

  const onConflictOverwrite = useCallback((): void => {
    const current = conflict
    const editor = editorRef.current
    setConflict(null)
    if (current === null || editor === null) return
    void writeNow(editor.getValue(), current.diskMtimeMs).catch((error: unknown) => {
      notifyError(errorText(error))
    })
  }, [conflict, writeNow])

  const onConflictReload = useCallback((): void => {
    const current = conflict
    setConflict(null)
    if (current === null) return
    const editor = editorRef.current
    savedTextRef.current = current.diskText
    mtimeRef.current = current.diskMtimeMs
    editor?.setValue(current.diskText)
    editorCtx.setTabDirty(tab.id, false)
  }, [conflict, editorCtx, tab.id])

  const onConflictShowDiff = useCallback((): void => {
    setDiskDiff(conflict)
    setConflict(null)
  }, [conflict])

  const checkDisk = useCallback(async (): Promise<void> => {
    if (editorRef.current === null || readOnlyRef.current) return
    try {
      const probe = await api.invoke('fs:stat', { path: tab.path })
      if (!probe.exists) {
        setDeleted(true)
        return
      }
      setDeleted(false)
      if (probe.mtimeMs === mtimeRef.current) return
      const editor = editorRef.current
      const disk = await readDisk()
      if (disk === null) {
        setDeleted(true)
        return
      }
      if (editor === null) return
      if (editor.getValue() === savedTextRef.current) {
        // Clean buffer: adopt the disk version without ceremony.
        savedTextRef.current = disk.diskText
        mtimeRef.current = disk.diskMtimeMs
        editor.setValue(disk.diskText)
        editorCtx.setTabDirty(tab.id, false)
        return
      }
      setConflict(disk)
    } catch {
      // A failed probe changes nothing.
    }
  }, [editorCtx, readDisk, tab.id, tab.path])

  useEffect(() => {
    if (!active) return
    void checkDisk()
  }, [active, checkDisk])

  useEffect(() => {
    const onFocus = (): void => {
      if (active) void checkDisk()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [active, checkDisk])

  const openInCode = useCallback((): void => {
    const line = editorRef.current?.getPosition()?.lineNumber
    void api
      .invoke('editor:openInCode', { path: tab.path, ...(line === undefined ? {} : { line }) })
      .catch((error: unknown) => {
        notifyError(errorText(error))
      })
  }, [tab.path])

  const saveRef = useRef(save)
  saveRef.current = save
  const openInCodeRef = useRef(openInCode)
  openInCodeRef.current = openInCode

  useEffect(() => {
    const actions: FileTabActions = {
      save: () => saveRef.current(),
      openInCode: () => openInCodeRef.current()
    }
    editorCtx.fileActions.current.set(tab.id, actions)
    return () => {
      editorCtx.fileActions.current.delete(tab.id)
    }
  }, [editorCtx.fileActions, tab.id])

  const editorVisible = doc.status === 'text'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line px-3">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted" title={tab.path}>
          {tab.path}
        </span>
        {doc.status === 'text' && doc.readOnly && (
          <span className="shrink-0 rounded border border-line px-1.5 py-0.5 text-xs text-muted">
            {t('editor.readOnlyBadge')}
          </span>
        )}
        <button
          type="button"
          className="shrink-0 rounded border border-line px-2 py-0.5 text-xs text-ink hover:bg-ink/5"
          onClick={openInCode}
        >
          {t('editor.openInVscode')}
        </button>
      </div>

      {deleted && doc.status === 'text' && (
        <div className="flex shrink-0 items-center gap-2 border-b border-warn/40 bg-warn/10 px-3 py-1.5">
          <span className="min-w-0 flex-1 text-xs text-ink">{t('editor.deletedOnDisk')}</span>
          <button
            type="button"
            className="shrink-0 rounded border border-line bg-panel px-2 py-0.5 text-xs text-ink hover:bg-ink/5"
            onClick={() => void save()}
          >
            {t('editor.saveRecreate')}
          </button>
          <button
            type="button"
            className="shrink-0 rounded px-2 py-0.5 text-xs text-muted hover:bg-ink/5 hover:text-ink"
            onClick={() => editorCtx.requestClose([tab.id])}
          >
            {t('tabs.close')}
          </button>
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        {editorVisible && <div ref={containerRef} className="absolute inset-0" />}

        {doc.status === 'loading' && (
          <p className="px-4 py-3 text-sm text-muted">{t('editor.loading')}</p>
        )}

        {doc.status === 'missing' && (
          <EmptyState message={t('editor.notFound')} onClose={() => editorCtx.requestClose([tab.id])} />
        )}

        {doc.status === 'error' && (
          <EmptyState message={doc.message} onClose={() => editorCtx.requestClose([tab.id])} />
        )}

        {doc.status === 'binary' && (
          <EmptyState
            message={t('editor.binaryFile', { size: formatSize(doc.size) })}
            action={{ label: t('editor.openExternally'), onClick: () => void openExternal() }}
            onClose={() => editorCtx.requestClose([tab.id])}
          />
        )}

        {doc.status === 'tooLarge' && (
          <EmptyState
            message={t('editor.tooLarge', { size: formatSize(doc.size) })}
            action={{ label: t('editor.openReadOnly'), onClick: () => void loadLarge() }}
            action2={{ label: t('editor.openExternally'), onClick: () => void openExternal() }}
            onClose={() => editorCtx.requestClose([tab.id])}
          />
        )}

        {doc.status === 'image' && (
          <div className="flex h-full flex-col items-center justify-center gap-3 overflow-auto bg-canvas p-4">
            <img src={doc.dataUrl} alt={tab.name} className="max-h-[80%] max-w-full object-contain" />
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted">{formatSize(doc.size)}</span>
              <button
                type="button"
                className="rounded border border-line px-2 py-0.5 text-xs text-ink hover:bg-ink/5"
                onClick={() => void openExternal()}
              >
                {t('editor.openExternally')}
              </button>
            </div>
          </div>
        )}
      </div>

      {conflict !== null && (
        <ConflictDialog
          fileName={tab.name}
          onOverwrite={onConflictOverwrite}
          onReload={onConflictReload}
          onShowDiff={onConflictShowDiff}
          onCancel={() => setConflict(null)}
        />
      )}

      {diskDiff !== null && (
        <div className="absolute inset-0 z-30 flex flex-col bg-canvas">
          <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line px-3">
            <span className="min-w-0 flex-1 truncate text-xs text-ink">
              {t('editor.diskDiffTitle', { name: tab.name })}
            </span>
            <button
              type="button"
              className="shrink-0 rounded border border-line px-2 py-0.5 text-xs text-ink hover:bg-ink/5"
              onClick={() => setDiskDiff(null)}
            >
              {t('dialogs.close')}
            </button>
          </div>
          <SnapshotDiffView
            original={diskDiff.diskText}
            modified={editorRef.current?.getValue() ?? ''}
            language={languageIdForPath(tab.path)}
            leftLabel={t('editor.diskVersion')}
            rightLabel={t('editor.editorVersion')}
          />
        </div>
      )}
    </div>
  )
}

function EmptyState({
  message,
  action,
  action2,
  onClose
}: {
  message: string
  action?: { label: string; onClick: () => void }
  action2?: { label: string; onClick: () => void }
  onClose: () => void
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
      <p className="max-w-md text-center text-sm text-muted">{message}</p>
      <div className="flex items-center gap-2">
        {action !== undefined && (
          <button
            type="button"
            className="rounded bg-accent px-3 py-1 text-sm text-white hover:opacity-90"
            onClick={action.onClick}
          >
            {action.label}
          </button>
        )}
        {action2 !== undefined && (
          <button
            type="button"
            className="rounded border border-line px-3 py-1 text-sm text-ink hover:bg-ink/5"
            onClick={action2.onClick}
          >
            {action2.label}
          </button>
        )}
        <button
          type="button"
          className="rounded px-3 py-1 text-sm text-muted hover:bg-ink/5 hover:text-ink"
          onClick={onClose}
        >
          {t('tabs.close')}
        </button>
      </div>
    </div>
  )
}

function ConflictDialog({
  fileName,
  onOverwrite,
  onReload,
  onShowDiff,
  onCancel
}: {
  fileName: string
  onOverwrite: () => void
  onReload: () => void
  onShowDiff: () => void
  onCancel: () => void
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="fixed inset-0 z-40 flex justify-center bg-black/40 pt-24" onMouseDown={onCancel}>
      <div
        role="alertdialog"
        aria-modal="true"
        className="h-fit w-full max-w-md rounded-lg border border-line bg-panel p-4 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 className="text-sm font-semibold text-ink">{t('editor.conflictTitle')}</h2>
        <p className="mt-2 text-sm text-muted">{t('editor.conflictBody', { name: fileName })}</p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className="rounded px-3 py-1 text-sm text-muted hover:bg-ink/5 hover:text-ink"
            onClick={onCancel}
          >
            {t('dialogs.cancel')}
          </button>
          <button
            type="button"
            className="rounded border border-line px-3 py-1 text-sm text-ink hover:bg-ink/5"
            onClick={onShowDiff}
          >
            {t('editor.conflictShowDiff')}
          </button>
          <button
            type="button"
            className="rounded border border-line px-3 py-1 text-sm text-ink hover:bg-ink/5"
            onClick={onReload}
          >
            {t('editor.conflictReload')}
          </button>
          <button
            type="button"
            className="rounded bg-accent px-3 py-1 text-sm text-white hover:opacity-90"
            onClick={onOverwrite}
          >
            {t('editor.conflictOverwrite')}
          </button>
        </div>
      </div>
    </div>
  )
}

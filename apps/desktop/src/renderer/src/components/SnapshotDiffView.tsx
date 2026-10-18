import { useEffect, useRef, type JSX } from 'react'
import { useEditor } from '../contexts/editor'
import { ensureLanguage } from '../editor/languages'
import { loadMonaco, type DiffEditor, type TextModel } from '../editor/monaco'

const DEFAULT_FONT_FAMILY = "Menlo, Monaco, 'Courier New', monospace"

/** Side-by-side diff of two in-memory texts (editor buffer vs. the disk file). */
export function SnapshotDiffView({
  original,
  modified,
  language,
  leftLabel,
  rightLabel
}: {
  original: string
  modified: string
  language: string
  leftLabel: string
  rightLabel: string
}): JSX.Element {
  const settings = useEditor().settings
  const containerRef = useRef<HTMLDivElement | null>(null)
  const diffRef = useRef<DiffEditor | null>(null)
  const modelsRef = useRef<{ original: TextModel; modified: TextModel } | null>(null)
  const readyRef = useRef<Promise<void> | null>(null)

  // The buffer side changes as the user types, so the instance is built once and only refilled.
  useEffect(() => {
    let cancelled = false
    readyRef.current = (async () => {
      const monaco = await loadMonaco()
      if (cancelled || containerRef.current === null) return
      await ensureLanguage(monaco, language)
      if (cancelled || containerRef.current === null) return
      const originalModel = monaco.editor.createModel('', language)
      const modifiedModel = monaco.editor.createModel('', language)
      const instance = monaco.editor.createDiffEditor(containerRef.current, {
        readOnly: true,
        automaticLayout: true,
        renderSideBySide: true,
        wordWrap: 'on',
        fontSize: settings.fontSize,
        fontFamily: settings.fontFamily !== '' ? settings.fontFamily : DEFAULT_FONT_FAMILY,
        minimap: { enabled: false },
        scrollBeyondLastLine: false
      })
      instance.setModel({ original: originalModel, modified: modifiedModel })
      modelsRef.current = { original: originalModel, modified: modifiedModel }
      diffRef.current = instance
    })()
    return () => {
      cancelled = true
      const instance = diffRef.current
      const models = modelsRef.current
      modelsRef.current = null
      diffRef.current = null
      readyRef.current = null
      // Detaching the pair first keeps Monaco's diff gutters from reading the editor it is tearing down.
      instance?.setModel(null)
      instance?.dispose()
      models?.original.dispose()
      models?.modified.dispose()
    }
  }, [language])

  useEffect(() => {
    void (async () => {
      await readyRef.current
      const models = modelsRef.current
      if (models === null) return
      if (models.original.getValue() !== original) models.original.setValue(original)
      if (models.modified.getValue() !== modified) models.modified.setValue(modified)
    })()
  }, [original, modified])

  useEffect(() => {
    diffRef.current?.updateOptions({
      fontSize: settings.fontSize,
      fontFamily: settings.fontFamily !== '' ? settings.fontFamily : DEFAULT_FONT_FAMILY
    })
  }, [settings])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 border-b border-line">
        <span className="w-1/2 truncate px-3 py-1 font-mono text-xs text-muted">{leftLabel}</span>
        <span className="w-1/2 truncate border-l border-line px-3 py-1 font-mono text-xs text-muted">
          {rightLabel}
        </span>
      </div>
      <div ref={containerRef} className="min-h-0 flex-1" />
    </div>
  )
}

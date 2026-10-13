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

  useEffect(() => {
    let disposed = false
    let diff: DiffEditor | null = null
    let originalModel: TextModel | null = null
    let modifiedModel: TextModel | null = null
    void (async () => {
      const monaco = await loadMonaco()
      if (disposed || containerRef.current === null) return
      await ensureLanguage(monaco, language)
      if (disposed || containerRef.current === null) return
      originalModel = monaco.editor.createModel(original, language)
      modifiedModel = monaco.editor.createModel(modified, language)
      diff = monaco.editor.createDiffEditor(containerRef.current, {
        readOnly: true,
        automaticLayout: true,
        renderSideBySide: true,
        wordWrap: 'on',
        fontSize: settings.fontSize,
        fontFamily: settings.fontFamily !== '' ? settings.fontFamily : DEFAULT_FONT_FAMILY,
        minimap: { enabled: false },
        scrollBeyondLastLine: false
      })
      diff.setModel({ original: originalModel, modified: modifiedModel })
    })()
    return () => {
      disposed = true
      diff?.dispose()
      originalModel?.dispose()
      modifiedModel?.dispose()
    }
  }, [original, modified, language, settings])

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

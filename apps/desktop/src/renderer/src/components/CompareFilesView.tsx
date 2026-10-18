import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { FsReadFileResponse } from '@gitreedesk/shared'
import { api } from '../api'
import { baseName, useEditor, type CompareTab } from '../contexts/editor'
import { compareViewFor } from '../editor/compare'
import { ensureLanguage, languageIdForPath } from '../editor/languages'
import { loadMonaco, type DiffEditor, type TextModel } from '../editor/monaco'
import { EmptyPanel, ImageSide, SideLabel, ToolbarChip, formatSize } from './DiffParts'

const DEFAULT_FONT_FAMILY = "Menlo, Monaco, 'Courier New', monospace"

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; sides: readonly [FsReadFileResponse, FsReadFileResponse] }

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function CompareFilesView({ tab }: { tab: CompareTab }): JSX.Element {
  const { t } = useTranslation()
  const editorCtx = useEditor()
  const settings = editorCtx.settings

  const [load, setLoad] = useState<LoadState>({ status: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)
  const [allowLarge, setAllowLarge] = useState(false)
  const [sideBySide, setSideBySide] = useState(true)
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(true)

  const containerRef = useRef<HTMLDivElement | null>(null)
  const diffRef = useRef<DiffEditor | null>(null)
  const paths = useMemo((): readonly [string, string] => [tab.leftPath, tab.rightPath], [tab.leftPath, tab.rightPath])

  useEffect(() => {
    let live = true
    setLoad({ status: 'loading' })
    const options = allowLarge ? { allowLarge: true } : {}
    void (async () => {
      try {
        const [left, right] = await Promise.all([
          api.invoke('fs:readFile', { path: tab.leftPath, ...options }),
          api.invoke('fs:readFile', { path: tab.rightPath, ...options })
        ])
        if (!live) return
        setLoad({ status: 'ready', sides: [left, right] })
      } catch (error) {
        if (live) setLoad({ status: 'error', message: errorText(error) })
      }
    })()
    return () => {
      live = false
    }
  }, [tab.leftPath, tab.rightPath, allowLarge, reloadKey])

  const view = load.status === 'ready' ? compareViewFor(paths, load.sides) : null
  const texts = view?.kind === 'text' && load.status === 'ready' ? load.sides : null

  // Diff editor lifecycle for the text view.
  useEffect(() => {
    if (texts === null || containerRef.current === null) return
    const [left, right] = texts
    let disposed = false
    let diff: DiffEditor | null = null
    let originalModel: TextModel | null = null
    let modifiedModel: TextModel | null = null
    void (async () => {
      const monaco = await loadMonaco()
      if (disposed || containerRef.current === null) return
      const languages = [languageIdForPath(tab.leftPath), languageIdForPath(tab.rightPath)]
      await Promise.all(languages.map((language) => ensureLanguage(monaco, language)))
      if (disposed || containerRef.current === null) return
      originalModel = monaco.editor.createModel(left.text ?? '', languages[0] ?? 'plaintext')
      modifiedModel = monaco.editor.createModel(right.text ?? '', languages[1] ?? 'plaintext')
      const instance = monaco.editor.createDiffEditor(containerRef.current, {
        readOnly: true,
        originalEditable: false,
        automaticLayout: true,
        renderSideBySide: sideBySide,
        ignoreTrimWhitespace: ignoreWhitespace,
        wordWrap: settings.wordWrap ? 'on' : 'off',
        fontSize: settings.fontSize,
        fontFamily: settings.fontFamily !== '' ? settings.fontFamily : DEFAULT_FONT_FAMILY,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        fixedOverflowWidgets: true
      })
      instance.setModel({ original: originalModel, modified: modifiedModel })
      diff = instance
      diffRef.current = instance
    })()
    return () => {
      disposed = true
      diffRef.current = null
      diff?.dispose()
      originalModel?.dispose()
      modifiedModel?.dispose()
    }
    // The comparison is rebuilt when the files change; the toggles update the live editor.
  }, [texts, tab.leftPath, tab.rightPath])

  useEffect(() => {
    diffRef.current?.updateOptions({ renderSideBySide: sideBySide, ignoreTrimWhitespace: ignoreWhitespace })
  }, [sideBySide, ignoreWhitespace])

  useEffect(() => {
    diffRef.current?.updateOptions({
      fontSize: settings.fontSize,
      fontFamily: settings.fontFamily !== '' ? settings.fontFamily : DEFAULT_FONT_FAMILY,
      wordWrap: settings.wordWrap ? 'on' : 'off'
    })
  }, [settings])

  const openFile = useCallback(
    (path: string): void => {
      editorCtx.openFile(path, { preview: false })
    },
    [editorCtx]
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-8 shrink-0 flex-wrap items-center gap-1 border-b border-line px-2 py-1">
        <span className="min-w-0 max-w-[30%] truncate font-mono text-xs text-ink" title={tab.leftPath}>
          {baseName(tab.leftPath)}
        </span>
        <span className="shrink-0 text-xs text-muted">⇄</span>
        <span className="min-w-0 max-w-[30%] truncate font-mono text-xs text-ink" title={tab.rightPath}>
          {baseName(tab.rightPath)}
        </span>
        <span className="min-w-0 flex-1" />
        <ToolbarChip active={sideBySide} label={t('diff.sideBySide')} onClick={() => setSideBySide(true)} />
        <ToolbarChip active={!sideBySide} label={t('diff.inline')} onClick={() => setSideBySide(false)} />
        <ToolbarChip
          active={ignoreWhitespace}
          label={t('diff.ignoreWhitespace')}
          onClick={() => setIgnoreWhitespace((current) => !current)}
        />
        <button
          type="button"
          className="rounded border border-line px-1.5 py-0.5 text-xs text-muted hover:bg-ink/5 hover:text-ink"
          onClick={() => openFile(tab.leftPath)}
        >
          {t('diff.openLeft')}
        </button>
        <button
          type="button"
          className="rounded border border-line px-1.5 py-0.5 text-xs text-muted hover:bg-ink/5 hover:text-ink"
          onClick={() => openFile(tab.rightPath)}
        >
          {t('diff.openRight')}
        </button>
        <button
          type="button"
          className="rounded border border-line px-1.5 py-0.5 text-xs text-muted hover:bg-ink/5 hover:text-ink"
          onClick={() => {
            setAllowLarge(false)
            setReloadKey((current) => current + 1)
          }}
        >
          {t('diff.reload')}
        </button>
      </div>

      {load.status === 'loading' && <p className="px-4 py-3 text-sm text-muted">{t('diff.loading')}</p>}
      {load.status === 'error' && <p className="max-w-lg px-4 py-3 text-sm text-muted">{load.message}</p>}

      {view !== null && view.kind === 'missing' && (
        <EmptyPanel message={t('diff.compareMissing', { names: view.paths.map((path) => baseName(path)).join(', ') })} />
      )}
      {view !== null && view.kind === 'tooLarge' && (
        <EmptyPanel
          message={t('diff.compareTooLarge', {
            left: formatSize(load.status === 'ready' ? load.sides[0].size : 0),
            right: formatSize(load.status === 'ready' ? load.sides[1].size : 0)
          })}
          action={{ label: t('diff.loadFull'), onClick: () => setAllowLarge(true) }}
        />
      )}
      {view !== null && view.kind === 'other' && (
        <EmptyPanel message={t('diff.compareNotText')} />
      )}

      {texts !== null && (
        <div className="flex min-h-0 flex-1 flex-col">
          {sideBySide && (
            <div className="flex shrink-0 border-b border-line">
              <SideLabel
                label={baseName(tab.leftPath)}
                exists
                size={texts[0].size}
                title={tab.leftPath}
              />
              <SideLabel label={baseName(tab.rightPath)} exists size={texts[1].size} border title={tab.rightPath} />
            </div>
          )}
          <div ref={containerRef} className="min-h-0 flex-1" />
        </div>
      )}

      {view !== null && view.kind === 'images' && load.status === 'ready' && (
        <div className="flex min-h-0 flex-1">
          <ImageSide
            label={baseName(tab.leftPath)}
            dataUrl={load.sides[0].dataUrl}
            size={load.sides[0].size}
            missing={t('diff.missingSide')}
          />
          <div className="w-px shrink-0 bg-line" />
          <ImageSide
            label={baseName(tab.rightPath)}
            dataUrl={load.sides[1].dataUrl}
            size={load.sides[1].size}
            missing={t('diff.missingSide')}
          />
        </div>
      )}
    </div>
  )
}

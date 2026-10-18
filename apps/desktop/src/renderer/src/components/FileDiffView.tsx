import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type MouseEvent as ReactMouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { DiffSource, FileHistoryEntry, GitDiffResponse, GitRef } from '@gitreedesk/shared'
import { api } from '../api'
import { useEditor, EMPTY_TREE_SHA, type CommitTab, type DiffTab } from '../contexts/editor'
import { useTerminal } from '../contexts/terminal'
import { ensureLanguage, languageIdForPath } from '../editor/languages'
import {
  loadMonaco,
  type DecorationCollection,
  type DiffEditor,
  type Monaco,
  type TextModel
} from '../editor/monaco'
import {
  changedLines,
  parsePatch,
  singleHunkPatch,
  singleLinePatch,
  type LineTarget,
  type ParsedPatch,
  type PatchHunk,
  type PatchSide
} from '../editor/patch'
import { notify, notifyError } from '../notify'
import { compareSourceItems, sameSource } from '../lib/compare-sources'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'
import { EmptyPanel, ImagePairView, SideLabel, ToolbarChip, formatSize } from './DiffParts'

type ApplyMode = 'stage' | 'unstage' | 'revert'

const DEFAULT_FONT_FAMILY = "Menlo, Monaco, 'Courier New', monospace"
const HISTORY_PAGE = 100

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; response: GitDiffResponse }

interface HistoryState {
  status: 'loading' | 'error' | 'ready'
  entries: FileHistoryEntry[]
  hasMore: boolean
  error?: string
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** What the gutter markers of the live editor do right now, read at click time. */
interface GlyphState {
  hunks: PatchHunk[]
  /** Additions, keyed by their line on the to side; clickable in the modified pane. */
  additions: Map<number, LineTarget>
  /** Deletions, keyed by their line on the from side; clickable in the original pane. */
  deletions: Map<number, LineTarget>
  primary: ApplyMode
  runLine: (target: LineTarget, mode: ApplyMode) => Promise<void>
  runHunk: (index: number, mode: ApplyMode) => Promise<void>
}

/** Hunk margin actions a comparison can honestly offer. */
function hunkActionsFor(from: DiffSource, to: DiffSource): { primary: ApplyMode; menu: ApplyMode[] } | null {
  if (to.kind === 'worktree' && from.kind === 'index') return { primary: 'stage', menu: ['stage', 'revert'] }
  if (to.kind === 'worktree' && from.kind === 'rev') return { primary: 'stage', menu: ['stage'] }
  if (to.kind === 'index' && from.kind === 'rev') return { primary: 'unstage', menu: ['unstage'] }
  return null
}

/** `stage` edits the from side; `unstage` and `revert` edit the side that already carries the change. */
function sideFor(mode: ApplyMode): PatchSide {
  return mode === 'stage' ? 'old' : 'new'
}

/** Effective comparison sources; a commit tab compares the commit against its parent. */
function sourcesOf(tab: DiffTab | CommitTab): { from: DiffSource; to: DiffSource } {
  if (tab.kind === 'commit') {
    return {
      from: { kind: 'rev', rev: tab.parent ?? EMPTY_TREE_SHA },
      to: { kind: 'rev', rev: tab.sha }
    }
  }
  return { from: tab.from, to: tab.to }
}

export function FileDiffView({ tab }: { tab: DiffTab | CommitTab }): JSX.Element {
  const { t } = useTranslation()
  const editorCtx = useEditor()
  const terminal = useTerminal()
  const settings = editorCtx.settings

  const [load, setLoad] = useState<LoadState>({ status: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)
  const [allowLarge, setAllowLarge] = useState(false)
  const [stale, setStale] = useState(false)
  const [sideBySide, setSideBySide] = useState(true)
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(true)
  const [hunkMenu, setHunkMenu] = useState<{ x: number; y: number; index: number } | null>(null)
  const [lineMenu, setLineMenu] = useState<{ x: number; y: number; target: LineTarget } | null>(null)
  const [compareMenu, setCompareMenu] = useState<{ x: number; y: number } | null>(null)
  const [compareRefs, setCompareRefs] = useState<readonly GitRef[] | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [followRenames, setFollowRenames] = useState(true)
  const [history, setHistory] = useState<HistoryState | null>(null)

  const containerRef = useRef<HTMLDivElement | null>(null)
  const diffRef = useRef<DiffEditor | null>(null)
  const monacoRef = useRef<Monaco | null>(null)
  const modelsRef = useRef<{ original: TextModel; modified: TextModel } | null>(null)
  const marksRef = useRef<{ hunk: DecorationCollection; added: DecorationCollection; deleted: DecorationCollection } | null>(null)
  const glyphRef = useRef<GlyphState | null>(null)
  const readyRef = useRef<Promise<void> | null>(null)
  const ignoreStaleUntilRef = useRef(0)
  const parsedRef = useRef<ParsedPatch>(parsePatch(''))
  const sources = useMemo(() => sourcesOf(tab), [tab])
  const hunkActions = useMemo(() => hunkActionsFor(sources.from, sources.to), [sources])
  const gitDir = tab.repo.gitDir
  const filePath = tab.path
  const origPath = tab.origPath

  useEffect(() => {
    let live = true
    // Refetching keeps the text already on screen; only switching files blanks the view.
    setLoad((current) =>
      current.status === 'ready' && current.response.path === filePath && current.response.origPath === origPath
        ? current
        : { status: 'loading' }
    )
    void (async () => {
      try {
        const response = await api.invoke('git:diff', {
          gitDir: tab.repo.gitDir,
          path: tab.path,
          ...(tab.origPath === null ? {} : { origPath: tab.origPath }),
          from: sources.from,
          to: sources.to,
          ...(allowLarge ? { allowLarge: true } : {})
        })
        if (!live) return
        parsedRef.current = parsePatch(response.patch)
        setLoad({ status: 'ready', response })
        setStale(false)
      } catch (error) {
        if (live) setLoad({ status: 'error', message: errorText(error) })
      }
    })()
    return () => {
      live = false
    }
  }, [gitDir, filePath, origPath, sources, reloadKey, allowLarge])

  // A diff of mutable state goes stale when the repository reports new activity.
  useEffect(() => {
    if (tab.kind !== 'diff') return
    return api.on('git:statusChanged', (event) => {
      if (Date.now() < ignoreStaleUntilRef.current) return
      if (!event.updates.some((update) => update.gitDir === tab.repo.gitDir)) return
      setStale(true)
    })
  }, [tab.kind, tab.repo.gitDir])

  /** A response is only usable while it still describes the file this tab shows. */
  const response =
    load.status === 'ready' && load.response.path === filePath && load.response.origPath === origPath
      ? load.response
      : null
  const textReady = response !== null && response.kind === 'text'

  const hunks = useMemo(() => {
    if (response === null || hunkActions === null) return []
    return parsedRef.current.hunks
  }, [response, hunkActions])

  // The Monaco instance lives as long as the file it shows: a reload only swaps the model contents,
  // which keeps the viewport and spares the reader a rebuild of the diff.
  useEffect(() => {
    if (!textReady || containerRef.current === null) return
    let cancelled = false
    readyRef.current = (async () => {
      const monaco = await loadMonaco()
      if (cancelled || containerRef.current === null) return
      const language = languageIdForPath(tab.path)
      await ensureLanguage(monaco, language)
      if (cancelled || containerRef.current === null) return
      const original = monaco.editor.createModel('', language)
      const modified = monaco.editor.createModel('', language)
      const instance = monaco.editor.createDiffEditor(containerRef.current, {
        readOnly: true,
        originalEditable: false,
        automaticLayout: true,
        renderSideBySide: sideBySide,
        ignoreTrimWhitespace: ignoreWhitespace,
        wordWrap: settings.wordWrap ? 'on' : 'off',
        glyphMargin: true,
        fontSize: settings.fontSize,
        fontFamily: settings.fontFamily !== '' ? settings.fontFamily : DEFAULT_FONT_FAMILY,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        fixedOverflowWidgets: true
      })
      instance.setModel({ original, modified })
      const modifiedEditor = instance.getModifiedEditor()
      monacoRef.current = monaco
      modelsRef.current = { original, modified }
      diffRef.current = instance
      marksRef.current = {
        hunk: modifiedEditor.createDecorationsCollection([]),
        added: modifiedEditor.createDecorationsCollection([]),
        deleted: instance.getOriginalEditor().createDecorationsCollection([])
      }
      const watch = (
        editor: ReturnType<DiffEditor['getModifiedEditor']>,
        side: 'additions' | 'deletions',
        withHunks: boolean
      ): void => {
        editor.onMouseDown((event) => {
          const state = glyphRef.current
          if (state === null) return
          if (event.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return
          const line = event.target.position?.lineNumber
          if (line === undefined) return
          const target = state[side].get(line)
          if (target !== undefined) {
            if (event.event.rightButton) {
              event.event.preventDefault()
              setLineMenu({ x: event.event.posx, y: event.event.posy, target })
              return
            }
            void state.runLine(target, state.primary)
            return
          }
          if (!withHunks) return
          const index = state.hunks.findIndex(
            (hunk) => line >= hunk.newStart && line <= hunk.newStart + Math.max(hunk.newCount, 1) - 1
          )
          if (index === -1) return
          if (event.event.rightButton) {
            event.event.preventDefault()
            setHunkMenu({ x: event.event.posx, y: event.event.posy, index })
            return
          }
          void state.runHunk(index, state.primary)
        })
      }
      watch(instance.getModifiedEditor(), 'additions', true)
      watch(instance.getOriginalEditor(), 'deletions', false)
    })()
    return () => {
      cancelled = true
      const instance = diffRef.current
      const models = modelsRef.current
      monacoRef.current = null
      marksRef.current = null
      glyphRef.current = null
      modelsRef.current = null
      diffRef.current = null
      readyRef.current = null
      // Detaching the pair first keeps Monaco's diff gutters from reading the editor it is tearing down.
      instance?.setModel(null)
      instance?.dispose()
      models?.original.dispose()
      models?.modified.dispose()
    }
  }, [textReady, tab.path])

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

  const runHunk = useCallback(
    async (index: number, mode: ApplyMode): Promise<void> => {
      const patch = singleHunkPatch(parsedRef.current, index)
      if (patch === null) return
      try {
        await api.invoke('git:applyHunk', { gitDir: tab.repo.gitDir, patch, mode })
        ignoreStaleUntilRef.current = Date.now() + 2000
        setReloadKey((current) => current + 1)
      } catch (error) {
        notifyError(errorText(error))
      }
    },
    [tab.repo.gitDir]
  )

  const runLine = useCallback(
    async (target: LineTarget, mode: ApplyMode): Promise<void> => {
      const built = singleLinePatch(parsedRef.current, target.hunkIndex, target.lineIndex, sideFor(mode))
      if (built === null) return
      try {
        await api.invoke('git:applyHunk', {
          gitDir: tab.repo.gitDir,
          patch: built.patch,
          mode,
          zeroContext: built.zeroContext
        })
        ignoreStaleUntilRef.current = Date.now() + 2000
        setReloadKey((current) => current + 1)
      } catch (error) {
        notifyError(errorText(error))
      }
    },
    [tab.repo.gitDir]
  )

  // Each response refills the models and redraws the margin markers of the instance that already lives here.
  useEffect(() => {
    if (response === null || response.kind !== 'text') return
    void (async () => {
      await readyRef.current
      const monaco = monacoRef.current
      const models = modelsRef.current
      const marks = marksRef.current
      if (monaco === null || models === null || marks === null) return
      const before = response.old.text ?? ''
      const after = response.new.text ?? ''
      if (models.original.getValue() !== before) models.original.setValue(before)
      if (models.modified.getValue() !== after) models.modified.setValue(after)
      if (hunkActions === null) {
        marks.hunk.set([])
        marks.added.set([])
        marks.deleted.set([])
        glyphRef.current = null
        return
      }
      const additions = changedLines(parsedRef.current, 'new')
      const deletions = changedLines(parsedRef.current, 'old')
      glyphRef.current = {
        hunks,
        additions,
        deletions,
        primary: hunkActions.primary,
        runLine,
        runHunk
      }
      marks.hunk.set(
        hunks.map((hunk) => ({
          range: new monaco.Range(hunk.newStart, 1, hunk.newStart + Math.max(hunk.newCount, 1) - 1, 1),
          options: {
            glyphMarginClassName: 'gtd-diff-hunk-glyph',
            glyphMarginHoverMessage: { value: hunk.header }
          }
        }))
      )
      const dots = (map: Map<number, LineTarget>) =>
        [...map.keys()].map((line) => ({
          range: new monaco.Range(line, 1, line, 1),
          options: {
            glyphMarginClassName: 'gtd-diff-line-glyph',
            glyphMarginHoverMessage: { value: t(`diff.line.${hunkActions.primary}`) }
          }
        }))
      marks.added.set(dots(additions))
      marks.deleted.set(dots(deletions))
    })()
  }, [response, hunks, hunkActions, runLine, runHunk, t])

  const copyPatch = useCallback(
    (patch: string): void => {
      if (patch.length === 0) return
      void api.invoke('app:copyText', { text: patch }).then(
        () => notify({ message: t('diff.patchCopied') }),
        (error: unknown) => notifyError(errorText(error))
      )
    },
    [t]
  )

  const openCompareMenu = useCallback(
    async (event: ReactMouseEvent<HTMLButtonElement>): Promise<void> => {
      const x = event.clientX
      const y = event.clientY
      if (compareRefs === null) {
        try {
          const { refs } = await api.invoke('git:refs', { gitDir: tab.repo.gitDir })
          setCompareRefs(refs)
        } catch (error) {
          notifyError(errorText(error))
          return
        }
      }
      setCompareMenu({ x, y })
    },
    [compareRefs, tab.repo.gitDir]
  )

  const compareItems = useMemo(
    (): ContextMenuItem[] =>
      compareSourceItems({
        refs: compareRefs,
        isCurrent: (source) => sameSource(sources.from, source) || sameSource(sources.to, source),
        onPick: (source) => editorCtx.setDiffSource(tab.id, source)
      }),
    [compareRefs, editorCtx, sources, tab.id]
  )

  const loadHistory = useCallback(
    async (skip: number, follow: boolean): Promise<void> => {
      setHistory((current) =>
        current === null || skip === 0 ? { status: 'loading', entries: [], hasMore: false } : { ...current, status: 'loading' }
      )
      try {
        const result = await api.invoke('git:fileHistory', {
          gitDir: tab.repo.gitDir,
          path: tab.path,
          limit: HISTORY_PAGE,
          skip,
          follow
        })
        setHistory((current) => ({
          status: 'ready',
          entries: skip === 0 ? result.entries : [...(current?.entries ?? []), ...result.entries],
          hasMore: result.hasMore
        }))
      } catch (error) {
        setHistory({ status: 'error', entries: [], hasMore: false, error: errorText(error) })
      }
    },
    [tab.repo.gitDir, tab.path]
  )

  const toggleHistory = useCallback((): void => {
    setHistoryOpen((current) => {
      const next = !current
      if (next && history === null) void loadHistory(0, followRenames)
      return next
    })
  }, [followRenames, history, loadHistory])

  const toggleFollowRenames = useCallback((): void => {
    const next = !followRenames
    setFollowRenames(next)
    if (historyOpen) void loadHistory(0, next)
  }, [followRenames, historyOpen, loadHistory])

  const openCommit = useCallback(
    (entry: FileHistoryEntry): void => {
      editorCtx.openCommitDiff({
        repo: tab.repo,
        sha: entry.sha,
        parent: entry.parents[0] ?? null,
        path: entry.path,
        ...(entry.origPath === null ? {} : { origPath: entry.origPath }),
        subject: entry.subject
      })
    },
    [editorCtx, tab.repo]
  )

  const openExternal = useCallback((): void => {
    const target = sources.to.kind === 'worktree' || sources.from.kind === 'worktree'
    const relative = sources.to.kind === 'worktree' ? tab.path : sources.from.kind === 'worktree' ? (tab.origPath ?? tab.path) : null
    if (!target || relative === null) return
    void api.invoke('fs:openExternal', { path: `${tab.repo.repoPath}/${relative}` }).catch((error: unknown) => {
      notifyError(errorText(error))
    })
  }, [sources, tab])

  const reload = useCallback((): void => setReloadKey((current) => current + 1), [])

  const hunkMenuItems = useMemo((): ContextMenuItem[] => {
    if (hunkMenu === null) return []
    const items: ContextMenuItem[] = []
    for (const mode of hunkActions?.menu ?? []) {
      items.push({
        label: t(`diff.hunk.${mode}`),
        onSelect: () => void runHunk(hunkMenu.index, mode)
      })
    }
    if (response !== null && response.patch !== '') {
      items.push({
        label: t('diff.hunk.copyPatch'),
        divider: items.length > 0,
        onSelect: () => {
          const patch = singleHunkPatch(parsedRef.current, hunkMenu.index)
          if (patch !== null) copyPatch(patch)
        }
      })
    }
    return items
  }, [hunkMenu, hunkActions, t, runHunk, response, copyPatch])

  const lineMenuItems = useMemo((): ContextMenuItem[] => {
    if (lineMenu === null) return []
    const items: ContextMenuItem[] = []
    for (const mode of hunkActions?.menu ?? []) {
      const built = singleLinePatch(
        parsedRef.current,
        lineMenu.target.hunkIndex,
        lineMenu.target.lineIndex,
        sideFor(mode)
      )
      if (built === null) continue
      items.push({ label: t(`diff.line.${mode}`), onSelect: () => void runLine(lineMenu.target, mode) })
    }
    return items
  }, [lineMenu, hunkActions, t, runLine])

  const headerPath =
    response !== null && response.origPath !== null ? `${response.origPath} → ${response.path}` : tab.path
  const pathSlash = tab.path.lastIndexOf('/')
  const terminalDir =
    pathSlash > 0 ? `${tab.repo.repoPath}/${tab.path.slice(0, pathSlash)}` : tab.repo.repoPath

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex min-h-8 shrink-0 flex-wrap items-center gap-1 border-b border-line px-2 py-1">
          <span className="min-w-0 max-w-[40%] truncate font-mono text-xs text-ink" title={headerPath}>
            {headerPath}
          </span>
          {tab.kind === 'commit' && (
            <span className="min-w-0 truncate text-xs text-muted" title={tab.subject}>
              {tab.sha.slice(0, 7)} · {tab.subject}
            </span>
          )}
          <span className="min-w-0 flex-1" />
          <ToolbarChip active={sideBySide} label={t('diff.sideBySide')} onClick={() => setSideBySide(true)} />
          <ToolbarChip active={!sideBySide} label={t('diff.inline')} onClick={() => setSideBySide(false)} />
          <ToolbarChip
            active={ignoreWhitespace}
            label={t('diff.ignoreWhitespace')}
            onClick={() => setIgnoreWhitespace((current) => !current)}
          />
          {tab.kind === 'diff' && (
            <ToolbarChip active={historyOpen} label={t('diff.history')} onClick={toggleHistory} />
          )}
          {tab.kind === 'diff' && (
            <button
              type="button"
              className="rounded border border-line px-1.5 py-0.5 text-xs text-muted hover:bg-ink/5 hover:text-ink"
              onClick={(event) => void openCompareMenu(event)}
            >
              {t('diff.compareWith')}
            </button>
          )}
          {response !== null && response.patch !== '' && (
            <button
              type="button"
              className="rounded border border-line px-1.5 py-0.5 text-xs text-muted hover:bg-ink/5 hover:text-ink"
              onClick={() => copyPatch(response.patch)}
            >
              {t('diff.copyPatch')}
            </button>
          )}
          <button
            type="button"
            className="rounded border border-line px-1.5 py-0.5 text-xs text-muted hover:bg-ink/5 hover:text-ink"
            onClick={() => terminal.open(terminalDir)}
          >
            {t('menu.openTerminal')}
          </button>
        </div>

        {stale && (
          <div className="flex shrink-0 items-center gap-2 border-b border-warn/40 bg-warn/10 px-2 py-1">
            <span className="min-w-0 flex-1 text-xs text-ink">{t('diff.outdated')}</span>
            <button
              type="button"
              className="shrink-0 rounded border border-line bg-panel px-2 py-0.5 text-xs text-ink hover:bg-ink/5"
              onClick={reload}
            >
              {t('diff.reload')}
            </button>
          </div>
        )}

        {load.status === 'loading' && <p className="px-4 py-3 text-sm text-muted">{t('diff.loading')}</p>}
        {load.status === 'error' && <p className="max-w-lg px-4 py-3 text-sm text-muted">{load.message}</p>}

        {response !== null && response.kind === 'text' && (
          <div className="flex min-h-0 flex-1 flex-col">
            {sideBySide && (
              <div className="flex shrink-0 border-b border-line">
                <SideLabel label={response.old.label} exists={response.old.exists} size={response.old.size} />
                <SideLabel
                  label={response.new.label}
                  exists={response.new.exists}
                  size={response.new.size}
                  border
                />
              </div>
            )}
            <div ref={containerRef} className="min-h-0 flex-1" />
          </div>
        )}

        {response !== null && response.kind === 'image' && (
          <ImagePairView
            left={response.old}
            right={response.new}
            missing={t('diff.missingSide')}
            twoUpLabel={t('diff.image.twoUp')}
            onionLabel={t('diff.image.onion')}
            revealLabel={t('diff.image.reveal')}
          />
        )}

        {response !== null && response.kind === 'binary' && (
          <EmptyPanel
            message={t('diff.binary', {
              old: formatSize(response.old.size),
              new: formatSize(response.new.size)
            })}
            action={
              sources.to.kind === 'worktree' || sources.from.kind === 'worktree'
                ? { label: t('editor.openExternally'), onClick: openExternal }
                : undefined
            }
          />
        )}

        {response !== null && response.kind === 'tooLarge' && (
          <EmptyPanel
            message={t('diff.tooLarge', {
              old: formatSize(response.old.size),
              new: formatSize(response.new.size)
            })}
            action={
              allowLarge
                ? undefined
                : {
                    label: t('diff.loadFull'),
                    onClick: () => setAllowLarge(true)
                  }
            }
            action2={
              sources.to.kind === 'worktree' ? { label: t('editor.openExternally'), onClick: openExternal } : undefined
            }
          />
        )}
      </div>

      {historyOpen && tab.kind === 'diff' && (
        <div className="flex w-72 min-h-0 shrink-0 flex-col border-l border-line">
          <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line px-2">
            <span className="min-w-0 flex-1 truncate text-xs font-semibold text-ink">
              {t('diff.historyTitle')}
            </span>
            <button
              type="button"
              className="shrink-0 rounded px-1 text-xs text-muted hover:bg-ink/5 hover:text-ink"
              onClick={() => setHistoryOpen(false)}
            >
              ✕
            </button>
          </div>
          <div className="flex shrink-0 items-center gap-2 border-b border-line px-2 py-1.5">
            <ToolbarChip
              active={followRenames}
              label={t('diff.followRenames')}
              onClick={toggleFollowRenames}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {history !== null && history.status === 'loading' && (
              <p className="px-3 py-3 text-xs text-muted">{t('diff.loading')}</p>
            )}
            {history !== null && history.status === 'error' && (
              <p className="px-3 py-3 text-xs text-muted">{history.error ?? ''}</p>
            )}
            {history !== null && history.status === 'ready' && history.entries.length === 0 && (
              <p className="px-3 py-3 text-xs text-muted">{t('diff.noHistory')}</p>
            )}
            {history !== null &&
              history.entries.map((entry) => (
                <button
                  key={entry.sha}
                  type="button"
                  className="block w-full px-3 py-1.5 text-left hover:bg-ink/5"
                  onClick={() => openCommit(entry)}
                >
                  <span className="block truncate text-xs text-ink" title={entry.subject}>
                    {entry.subject}
                  </span>
                  {entry.path !== filePath && (
                    <span className="block truncate font-mono text-xs text-muted" title={entry.path}>
                      {t('diff.historyAsPath', { path: entry.path })}
                    </span>
                  )}
                  <span className="mt-0.5 flex items-baseline gap-2 text-xs text-muted">
                    <span className="font-mono">{entry.sha.slice(0, 7)}</span>
                    <span className="min-w-0 truncate">{entry.author.name}</span>
                    <span className="ml-auto shrink-0">{new Date(entry.committer.date).toLocaleDateString()}</span>
                  </span>
                </button>
              ))}
            {history !== null && history.status === 'ready' && history.hasMore && (
              <button
                type="button"
                className="block w-full px-3 py-2 text-left text-xs text-accent hover:underline"
                onClick={() => void loadHistory(history.entries.length, followRenames)}
              >
                {t('diff.showMore')}
              </button>
            )}
          </div>
        </div>
      )}

      {hunkMenu !== null && hunkMenuItems.length > 0 && (
        <ContextMenu x={hunkMenu.x} y={hunkMenu.y} items={hunkMenuItems} onClose={() => setHunkMenu(null)} />
      )}
      {lineMenu !== null && lineMenuItems.length > 0 && (
        <ContextMenu x={lineMenu.x} y={lineMenu.y} items={lineMenuItems} onClose={() => setLineMenu(null)} />
      )}
      {compareMenu !== null && (
        <ContextMenu x={compareMenu.x} y={compareMenu.y} items={compareItems} onClose={() => setCompareMenu(null)} />
      )}
    </div>
  )
}

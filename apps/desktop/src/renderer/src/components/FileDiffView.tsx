import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type MouseEvent as ReactMouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { CommitInfo, DiffSource, GitDiffResponse, GitRef } from '@gitreedesk/shared'
import { api } from '../api'
import { useEditor, EMPTY_TREE_SHA, type CommitTab, type DiffTab } from '../contexts/editor'
import { ensureLanguage, languageIdForPath } from '../editor/languages'
import { loadMonaco, type DiffEditor, type Monaco, type TextModel } from '../editor/monaco'
import { parsePatch, singleHunkPatch, type ParsedPatch } from '../editor/patch'
import { notify, notifyError } from '../notify'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'

type ApplyMode = 'stage' | 'unstage' | 'revert'

const DEFAULT_FONT_FAMILY = "Menlo, Monaco, 'Courier New', monospace"
const HISTORY_PAGE = 100
const MAX_COMPARE_REFS = 40

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; response: GitDiffResponse }

interface HistoryState {
  status: 'loading' | 'error' | 'ready'
  commits: CommitInfo[]
  hasMore: boolean
  error?: string
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}

function shortLabel(label: string): string {
  return /^[0-9a-f]{40}$/i.test(label) ? label.slice(0, 7) : label
}

function sameSource(a: DiffSource, b: DiffSource): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind !== 'rev') return true
  return (a.rev ?? 'HEAD') === (b.rev ?? 'HEAD')
}

/** Hunk margin actions a comparison can honestly offer. */
function hunkActionsFor(from: DiffSource, to: DiffSource): { primary: ApplyMode; menu: ApplyMode[] } | null {
  if (to.kind === 'worktree' && from.kind === 'index') return { primary: 'stage', menu: ['stage', 'revert'] }
  if (to.kind === 'worktree' && from.kind === 'rev') return { primary: 'stage', menu: ['stage'] }
  if (to.kind === 'index' && from.kind === 'rev') return { primary: 'unstage', menu: ['unstage'] }
  return null
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
  const settings = editorCtx.settings

  const [load, setLoad] = useState<LoadState>({ status: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)
  const [allowLarge, setAllowLarge] = useState(false)
  const [stale, setStale] = useState(false)
  const [sideBySide, setSideBySide] = useState(true)
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(true)
  const [hunkMenu, setHunkMenu] = useState<{ x: number; y: number; index: number } | null>(null)
  const [compareMenu, setCompareMenu] = useState<{ x: number; y: number } | null>(null)
  const [compareRefs, setCompareRefs] = useState<readonly GitRef[] | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [history, setHistory] = useState<HistoryState | null>(null)

  const containerRef = useRef<HTMLDivElement | null>(null)
  const diffRef = useRef<DiffEditor | null>(null)
  const ignoreStaleUntilRef = useRef(0)
  const parsedRef = useRef<ParsedPatch>(parsePatch(''))
  const sources = useMemo(() => sourcesOf(tab), [tab])
  const hunkActions = useMemo(() => hunkActionsFor(sources.from, sources.to), [sources])
  const gitDir = tab.repo.gitDir
  const filePath = tab.path
  const origPath = tab.origPath

  useEffect(() => {
    let live = true
    setLoad({ status: 'loading' })
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

  const hunks = useMemo(() => {
    if (load.status !== 'ready' || hunkActions === null) return []
    return parsedRef.current.hunks
  }, [load, hunkActions])

  // Diff editor lifecycle for the text view.
  useEffect(() => {
    if (load.status !== 'ready' || load.response.kind !== 'text' || containerRef.current === null) return
    const response = load.response
    let disposed = false
    let diff: DiffEditor | null = null
    let originalModel: TextModel | null = null
    let modifiedModel: TextModel | null = null
    void (async () => {
      const monaco = await loadMonaco()
      if (disposed || containerRef.current === null) return
      const language = languageIdForPath(tab.path)
      await ensureLanguage(monaco, language)
      if (disposed || containerRef.current === null) return
      originalModel = monaco.editor.createModel(response.old.text ?? '', language)
      modifiedModel = monaco.editor.createModel(response.new.text ?? '', language)
      const instance = monaco.editor.createDiffEditor(containerRef.current, {
        readOnly: true,
        originalEditable: false,
        automaticLayout: true,
        renderSideBySide: sideBySide,
        ignoreTrimWhitespace: ignoreWhitespace,
        wordWrap: 'on',
        glyphMargin: true,
        fontSize: settings.fontSize,
        fontFamily: settings.fontFamily !== '' ? settings.fontFamily : DEFAULT_FONT_FAMILY,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        fixedOverflowWidgets: true
      })
      instance.setModel({ original: originalModel, modified: modifiedModel })
      diff = instance
      diffRef.current = instance
      if (hunks.length > 0) {
        const modified = instance.getModifiedEditor()
        modified.createDecorationsCollection(
          hunks.map((hunk) => ({
            range: new monaco.Range(
              hunk.newStart,
              1,
              hunk.newStart + Math.max(hunk.newCount, 1) - 1,
              1
            ),
            options: {
              glyphMarginClassName: 'gtd-diff-hunk-glyph',
              glyphMarginHoverMessage: { value: hunk.header }
            }
          }))
        )
        modified.onMouseDown((event) => {
          if (event.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return
          const line = event.target.position?.lineNumber
          if (line === undefined) return
          const index = hunks.findIndex(
            (hunk) => line >= hunk.newStart && line <= hunk.newStart + Math.max(hunk.newCount, 1) - 1
          )
          if (index === -1) return
          if (event.event.rightButton) {
            event.event.preventDefault()
            setHunkMenu({ x: event.event.posx, y: event.event.posy, index })
            return
          }
          void runHunk(index, hunkActions?.primary ?? 'stage')
        })
      }
    })()
    return () => {
      disposed = true
      diffRef.current = null
      diff?.dispose()
      originalModel?.dispose()
      modifiedModel?.dispose()
    }
  }, [load, tab.path, hunks, hunkActions])

  useEffect(() => {
    diffRef.current?.updateOptions({ renderSideBySide: sideBySide, ignoreTrimWhitespace: ignoreWhitespace })
  }, [sideBySide, ignoreWhitespace])

  useEffect(() => {
    diffRef.current?.updateOptions({
      fontSize: settings.fontSize,
      fontFamily: settings.fontFamily !== '' ? settings.fontFamily : DEFAULT_FONT_FAMILY
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

  const compareItems = useMemo((): ContextMenuItem[] => {
    const base: DiffSource = { kind: 'index' }
    const head: DiffSource = { kind: 'rev', rev: 'HEAD' }
    const items: ContextMenuItem[] = [
      { label: 'INDEX', disabled: sameSource(sources.from, base) || sameSource(sources.to, base), onSelect: () => editorCtx.setDiffSource(tab.id, base) },
      { label: 'HEAD', disabled: sameSource(sources.from, head) || sameSource(sources.to, head), onSelect: () => editorCtx.setDiffSource(tab.id, head) }
    ]
    for (const ref of compareRefs ?? []) {
      if (items.length >= MAX_COMPARE_REFS) break
      const source: DiffSource = { kind: 'rev', rev: ref.name }
      items.push({
        label: ref.name,
        disabled: sameSource(sources.from, source) || sameSource(sources.to, source),
        onSelect: () => editorCtx.setDiffSource(tab.id, source)
      })
    }
    return items
  }, [compareRefs, editorCtx, sources, tab.id])

  const loadHistory = useCallback(
    async (skip: number): Promise<void> => {
      setHistory((current) =>
        current === null || skip === 0 ? { status: 'loading', commits: [], hasMore: false } : { ...current, status: 'loading' }
      )
      try {
        const result = await api.invoke('git:fileLog', {
          gitDir: tab.repo.gitDir,
          path: tab.path,
          limit: HISTORY_PAGE,
          skip
        })
        setHistory((current) => ({
          status: 'ready',
          commits: skip === 0 ? result.commits : [...(current?.commits ?? []), ...result.commits],
          hasMore: result.hasMore
        }))
      } catch (error) {
        setHistory({ status: 'error', commits: [], hasMore: false, error: errorText(error) })
      }
    },
    [tab.repo.gitDir, tab.path]
  )

  const toggleHistory = useCallback((): void => {
    setHistoryOpen((current) => {
      const next = !current
      if (next && history === null) void loadHistory(0)
      return next
    })
  }, [history, loadHistory])

  const openCommit = useCallback(
    (commit: CommitInfo): void => {
      editorCtx.openCommitDiff({
        repo: tab.repo,
        sha: commit.sha,
        parent: commit.parents[0] ?? null,
        path: tab.path,
        ...(tab.origPath === null ? {} : { origPath: tab.origPath }),
        subject: commit.subject
      })
    },
    [editorCtx, tab.origPath, tab.path, tab.repo]
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
    const response = load.status === 'ready' ? load.response : null
    if (response !== null && response.patch !== '') {
      items.push({
        label: t('diff.hunk.copyPatch'),
        onSelect: () => {
          const patch = singleHunkPatch(parsedRef.current, hunkMenu.index)
          if (patch !== null) copyPatch(patch)
        }
      })
    }
    return items
  }, [hunkMenu, hunkActions, t, runHunk, load, copyPatch])

  const response = load.status === 'ready' ? load.response : null
  const headerPath =
    response !== null && response.origPath !== null ? `${response.origPath} → ${response.path}` : tab.path

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
          <div className="flex min-h-0 flex-1">
            <ImageSide label={response.old.label} dataUrl={response.old.dataUrl} size={response.old.size} missing={t('diff.missingSide')} />
            <div className="w-px shrink-0 bg-line" />
            <ImageSide label={response.new.label} dataUrl={response.new.dataUrl} size={response.new.size} missing={t('diff.missingSide')} />
          </div>
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
          <div className="min-h-0 flex-1 overflow-y-auto">
            {history !== null && history.status === 'loading' && (
              <p className="px-3 py-3 text-xs text-muted">{t('diff.loading')}</p>
            )}
            {history !== null && history.status === 'error' && (
              <p className="px-3 py-3 text-xs text-muted">{history.error ?? ''}</p>
            )}
            {history !== null && history.status === 'ready' && history.commits.length === 0 && (
              <p className="px-3 py-3 text-xs text-muted">{t('diff.noHistory')}</p>
            )}
            {history !== null &&
              history.commits.map((commit) => (
                <button
                  key={commit.sha}
                  type="button"
                  className="block w-full px-3 py-1.5 text-left hover:bg-ink/5"
                  onClick={() => openCommit(commit)}
                >
                  <span className="block truncate text-xs text-ink" title={commit.subject}>
                    {commit.subject}
                  </span>
                  <span className="mt-0.5 flex items-baseline gap-2 text-xs text-muted">
                    <span className="font-mono">{commit.sha.slice(0, 7)}</span>
                    <span className="min-w-0 truncate">{commit.author.name}</span>
                    <span className="ml-auto shrink-0">{new Date(commit.committer.date).toLocaleDateString()}</span>
                  </span>
                </button>
              ))}
            {history !== null && history.status === 'ready' && history.hasMore && (
              <button
                type="button"
                className="block w-full px-3 py-2 text-left text-xs text-accent hover:underline"
                onClick={() => void loadHistory(history.commits.length)}
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
      {compareMenu !== null && (
        <ContextMenu x={compareMenu.x} y={compareMenu.y} items={compareItems} onClose={() => setCompareMenu(null)} />
      )}
    </div>
  )
}

function ToolbarChip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={`whitespace-nowrap rounded border px-1.5 py-0.5 text-xs ${
        active
          ? 'border-accent/60 bg-accent/15 text-ink'
          : 'border-line text-muted hover:bg-ink/5 hover:text-ink'
      }`}
      onClick={onClick}
    >
      {label}
    </button>
  )
}

function SideLabel({
  label,
  exists,
  size,
  border = false
}: {
  label: string
  exists: boolean
  size: number
  border?: boolean
}): JSX.Element {
  return (
    <span
      className={`flex w-1/2 min-w-0 items-baseline gap-2 px-3 py-1 ${border ? 'border-l border-line' : ''}`}
    >
      <span className="shrink-0 font-mono text-xs text-ink">{shortLabel(label)}</span>
      <span className="min-w-0 truncate text-xs text-muted">
        {exists ? formatSize(size) : '(missing)'}
      </span>
    </span>
  )
}

function ImageSide({
  label,
  dataUrl,
  size,
  missing
}: {
  label: string
  dataUrl: string | null
  size: number
  missing: string
}): JSX.Element {
  return (
    <figure className="flex min-w-0 flex-1 flex-col items-center justify-center gap-2 overflow-auto p-4">
      <figcaption className="flex items-baseline gap-2 text-xs text-muted">
        <span className="font-mono text-ink">{shortLabel(label)}</span>
        <span>{formatSize(size)}</span>
      </figcaption>
      {dataUrl !== null ? (
        <img src={dataUrl} alt={label} className="max-h-[80%] max-w-full object-contain" />
      ) : (
        <span className="text-xs text-muted">{missing}</span>
      )}
    </figure>
  )
}

function EmptyPanel({
  message,
  action,
  action2
}: {
  message: string
  action?: { label: string; onClick: () => void }
  action2?: { label: string; onClick: () => void }
}): JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6">
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
      </div>
    </div>
  )
}

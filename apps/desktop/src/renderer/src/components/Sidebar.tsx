import { useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { useTreeUi, type TreeViewKind } from '../contexts/tree'
import { useWorkspace } from '../contexts/workspace'
import { ExplorerView } from './ExplorerView'
import { ReposView } from './ReposView'
import { ScmView } from './ScmView'
import { ViewOptionsPopover } from './ViewOptionsPopover'
import { SlidersIcon } from './icons'

const VIEWS: readonly TreeViewKind[] = ['explorer', 'repos']

export function Sidebar(): JSX.Element {
  const { descriptor } = useWorkspace()
  const tree = useTreeUi()

  if (descriptor === null) return <div className="min-h-0 flex-1 overflow-auto" />

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {tree.panel === 'scm' ? <ScmHeader /> : <TreeHeader />}
      {tree.panel === 'scm' ? (
        <ScmView key={descriptor.root} />
      ) : tree.view === 'explorer' ? (
        <ExplorerView key={descriptor.root} />
      ) : (
        <ReposView key={descriptor.root} />
      )}
    </div>
  )
}

function TreeHeader(): JSX.Element {
  const { t } = useTranslation()
  const tree = useTreeUi()
  const [optionsOpen, setOptionsOpen] = useState(false)

  return (
    <header className="relative flex h-9 shrink-0 items-center gap-1 border-b border-line px-2">
      <div
        role="tablist"
        aria-label={t('view.explorer')}
        className="flex items-center rounded-md bg-ink/5 p-0.5"
      >
        {VIEWS.map((view) => (
          <button
            key={view}
            type="button"
            role="tab"
            aria-selected={tree.view === view}
            className={`rounded px-2 py-0.5 text-xs ${
              tree.view === view ? 'bg-panel text-ink shadow-sm' : 'text-muted hover:text-ink'
            }`}
            onClick={() => tree.setView(view)}
          >
            {t(`view.${view}`)}
          </button>
        ))}
      </div>
      <span className="min-w-0 flex-1" />
      <button
        type="button"
        aria-pressed={optionsOpen}
        title={t('view.options')}
        aria-label={t('view.options')}
        className={`rounded p-1 ${
          optionsOpen ? 'bg-ink/10 text-ink' : 'text-muted hover:bg-ink/5 hover:text-ink'
        }`}
        onClick={() => setOptionsOpen((current) => !current)}
      >
        <SlidersIcon className="size-4" />
      </button>
      {optionsOpen && (
        <ViewOptionsPopover
          options={tree.viewOptions}
          onChange={tree.setViewOptions}
          onClose={() => setOptionsOpen(false)}
        />
      )}
    </header>
  )
}

function ScmHeader(): JSX.Element {
  const { t } = useTranslation()

  return (
    <header className="flex h-9 shrink-0 items-center border-b border-line px-2">
      <span className="truncate text-xs font-semibold tracking-wide text-ink uppercase">
        {t('view.scm')}
      </span>
    </header>
  )
}

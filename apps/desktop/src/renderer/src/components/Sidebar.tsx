import { useCallback, useMemo, useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { RepoRecord, RepoStatus } from '@gitreedesk/shared'
import { useTreeUi, type TreeViewKind } from '../contexts/tree'
import { useWorkspace } from '../contexts/workspace'
import { checkoutKey } from '../tree/repos-model'
import {
  buildScmModel,
  DEFAULT_SCM_GROUPS,
  repoCollapseKey,
  SCM_GROUPS,
  type ScmGroup
} from '../tree/scm-model'
import { ExplorerView } from './ExplorerView'
import { ReposView } from './ReposView'
import { ScmOptionsPopover } from './ScmOptionsPopover'
import { ScmView } from './ScmView'
import { ViewOptionsPopover } from './ViewOptionsPopover'
import { CollapseAllIcon, ExpandAllIcon, SlidersIcon } from './icons'

const VIEWS: readonly TreeViewKind[] = ['explorer', 'repos']
const NO_RECORDS: readonly RepoRecord[] = []

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
  const { descriptor, statuses } = useWorkspace()
  const tree = useTreeUi()
  const [optionsOpen, setOptionsOpen] = useState(false)
  const records = descriptor?.records ?? NO_RECORDS

  const statusFor = useCallback(
    (record: RepoRecord): RepoStatus | null => statuses.get(record.gitDir)?.status ?? null,
    [statuses]
  )

  // Same scope rules as the list, so each count is what its group would reveal now.
  const sections = useMemo(
    () =>
      buildScmModel({
        records,
        statusFor,
        isSelected: tree.isScmSelected,
        onlySelected: tree.scmOnlySelected,
        groups: DEFAULT_SCM_GROUPS
      }),
    [records, statusFor, tree.isScmSelected, tree.scmOnlySelected]
  )

  const counts = useMemo(() => {
    const totals: Record<ScmGroup, number> = {
      conflicts: 0,
      staged: 0,
      unstaged: 0,
      untracked: 0
    }
    for (const section of sections) {
      for (const group of SCM_GROUPS) totals[group] += section.counts[group]
    }
    return totals
  }, [sections])

  const allCollapsed = useMemo(
    () =>
      sections.length > 0 &&
      sections.every((section) => tree.scmCollapsed.includes(repoCollapseKey(section.key))),
    [sections, tree.scmCollapsed]
  )

  const checked = useMemo(
    () => records.filter((record) => tree.isScmSelected(checkoutKey(record))).length,
    [records, tree.isScmSelected]
  )
  const filtered =
    SCM_GROUPS.some((group) => !tree.scmGroups[group]) ||
    (tree.scmOnlySelected && checked < records.length)

  return (
    <header className="relative flex h-9 shrink-0 items-center gap-1 border-b border-line px-2">
      <span className="truncate text-xs font-semibold tracking-wide text-ink uppercase">
        {t('view.scm')}
      </span>
      <span className="min-w-0 flex-1" />
      {sections.length > 0 && (
        <button
          type="button"
          title={allCollapsed ? t('scm.expandAll') : t('scm.collapseAll')}
          aria-label={allCollapsed ? t('scm.expandAll') : t('scm.collapseAll')}
          className="rounded p-1 text-muted hover:bg-ink/5 hover:text-ink"
          onClick={() => {
            tree.setScmCollapsed(
              allCollapsed ? [] : sections.map((section) => repoCollapseKey(section.key))
            )
          }}
        >
          {allCollapsed ? (
            <ExpandAllIcon className="size-4" />
          ) : (
            <CollapseAllIcon className="size-4" />
          )}
        </button>
      )}
      <button
        type="button"
        aria-pressed={optionsOpen}
        title={t('scm.options')}
        aria-label={t('scm.options')}
        className={`relative rounded p-1 ${
          optionsOpen ? 'bg-ink/10 text-ink' : 'text-muted hover:bg-ink/5 hover:text-ink'
        }`}
        onClick={() => setOptionsOpen((current) => !current)}
      >
        <SlidersIcon className="size-4" />
        {!optionsOpen && filtered && (
          <span className="absolute top-1 right-1 size-1.5 rounded-full bg-accent" />
        )}
      </button>
      {optionsOpen && (
        <ScmOptionsPopover
          groups={tree.scmGroups}
          counts={counts}
          onGroupsChange={tree.setScmGroups}
          onlySelected={tree.scmOnlySelected}
          onOnlySelectedChange={tree.setScmOnlySelected}
          checked={checked}
          total={records.length}
          onCheckAll={() => tree.setScmDeselected([])}
          onCheckNone={() => tree.setScmDeselected(records.map((record) => checkoutKey(record)))}
          onOpenRepos={() => {
            tree.setView('repos')
            tree.setPanel('tree')
          }}
          onClose={() => setOptionsOpen(false)}
        />
      )}
    </header>
  )
}

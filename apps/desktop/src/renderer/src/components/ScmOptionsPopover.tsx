import { useEffect, useRef, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import {
  SCM_GROUPS,
  type ScmGroup,
  type ScmGroupVisibility
} from '../tree/scm-model'

export function ScmOptionsPopover({
  groups,
  counts,
  onGroupsChange,
  onlySelected,
  onOnlySelectedChange,
  checked,
  total,
  onCheckAll,
  onCheckNone,
  onOpenRepos,
  onClose
}: {
  groups: ScmGroupVisibility
  counts: Record<ScmGroup, number>
  onGroupsChange: (next: ScmGroupVisibility) => void
  onlySelected: boolean
  onOnlySelectedChange: (next: boolean) => void
  checked: number
  total: number
  onCheckAll: () => void
  onCheckNone: () => void
  onOpenRepos: () => void
  onClose: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const onPointerDown = (event: MouseEvent): void => {
      if (ref.current !== null && !ref.current.contains(event.target as Node)) onClose()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('mousedown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  const toggleGroup = (group: ScmGroup): void => {
    onGroupsChange({ ...groups, [group]: !groups[group] })
  }

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={t('scm.options')}
      className="absolute top-full right-0 z-40 mt-1 w-72 rounded-md border border-line bg-panel py-1 shadow-lg"
    >
      <p className="px-3 pt-1 pb-0.5 text-xs font-semibold tracking-wide text-muted uppercase">
        {t('scm.optionsGroups')}
      </p>
      {SCM_GROUPS.map((group) => (
        <label
          key={group}
          className="flex cursor-pointer items-center gap-2 px-3 py-1 text-sm text-ink hover:bg-ink/5"
        >
          <input
            type="checkbox"
            checked={groups[group]}
            onChange={() => toggleGroup(group)}
            className="accent-accent"
          />
          <span className="min-w-0 flex-1 truncate">{t(`scm.groups.${group}`)}</span>
          <span className="shrink-0 font-mono text-xs text-muted">{counts[group]}</span>
        </label>
      ))}
      <div className="my-1 border-t border-line" />
      <p className="px-3 pt-1 pb-0.5 text-xs font-semibold tracking-wide text-muted uppercase">
        {t('scm.optionsScope')}
      </p>
      <label className="flex cursor-pointer items-start gap-2 px-3 py-1 text-sm text-ink hover:bg-ink/5">
        <input
          type="checkbox"
          checked={onlySelected}
          onChange={() => onOnlySelectedChange(!onlySelected)}
          className="mt-0.5 shrink-0 accent-accent"
        />
        <span className="min-w-0">
          <span className="block">{t('scm.onlySelected')}</span>
          <span className="mt-0.5 block text-xs text-muted">{t('scm.onlySelectedHint')}</span>
        </span>
      </label>
      <div className="flex items-center gap-2 px-3 py-1 text-xs text-muted">
        <span className="min-w-0 flex-1 truncate">
          {t('scm.checkedSummary', { selected: checked, total })}
        </span>
        <button
          type="button"
          className="shrink-0 rounded px-1 py-0.5 hover:bg-ink/5 hover:text-ink"
          onClick={onCheckAll}
        >
          {t('scm.checkAll')}
        </button>
        <button
          type="button"
          className="shrink-0 rounded px-1 py-0.5 hover:bg-ink/5 hover:text-ink"
          onClick={onCheckNone}
        >
          {t('scm.checkNone')}
        </button>
      </div>
      <div className="px-3 pt-0.5 pb-1">
        <button
          type="button"
          className="text-xs text-accent hover:underline"
          onClick={onOpenRepos}
        >
          {t('scm.openRepos')}
        </button>
      </div>
    </div>
  )
}

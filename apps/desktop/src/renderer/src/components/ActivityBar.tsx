import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { useTreeUi, type SidebarPanel } from '../contexts/tree'
import { BranchIcon, ChangesIcon } from './icons'

export function ActivityBar({
  collapsed,
  onSelect
}: {
  collapsed: boolean
  onSelect: (panel: SidebarPanel) => void
}): JSX.Element {
  const { t } = useTranslation()
  const tree = useTreeUi()

  const panelButton = (panel: SidebarPanel, label: string, icon: JSX.Element): JSX.Element => {
    const active = !collapsed && tree.panel === panel
    return (
      <button
        type="button"
        aria-pressed={active}
        title={label}
        aria-label={label}
        onClick={() => onSelect(panel)}
        className={`flex size-9 items-center justify-center rounded-md ${
          active ? 'bg-ink/5 text-ink' : 'text-muted hover:bg-ink/5 hover:text-ink'
        }`}
      >
        {icon}
      </button>
    )
  }

  return (
    <nav className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-line bg-panel py-2">
      {panelButton('tree', t('activity.tree'), <BranchIcon className="size-5" />)}
      {panelButton('scm', t('activity.scm'), <ChangesIcon className="size-5" />)}
    </nav>
  )
}

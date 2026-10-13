import { useEffect, useRef, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { ViewOptions } from '../contexts/tree'

const BADGE_TOGGLES: readonly (keyof ViewOptions)[] = [
  'kindBadges',
  'dirty',
  'sync',
  'operation',
  'stash',
  'detached'
]

export function ViewOptionsPopover({
  options,
  onChange,
  onClose
}: {
  options: ViewOptions
  onChange: (next: ViewOptions) => void
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

  const toggle = (key: keyof ViewOptions): void => {
    onChange({ ...options, [key]: !options[key] })
  }

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={t('view.options')}
      className="absolute top-full right-0 z-40 mt-1 w-60 rounded-md border border-line bg-panel py-1 shadow-lg"
    >
      <p className="px-3 pt-1 pb-0.5 text-xs font-semibold tracking-wide text-muted uppercase">
        {t('viewOptions.badges')}
      </p>
      {BADGE_TOGGLES.map((key) => (
        <Option key={key} label={t(`viewOptions.${key}`)} checked={options[key]} onToggle={() => toggle(key)} />
      ))}
      <div className="my-1 border-t border-line" />
      <Option
        label={t('viewOptions.showExternalWorktrees')}
        checked={options.showExternalWorktrees}
        onToggle={() => toggle('showExternalWorktrees')}
      />
    </div>
  )
}

function Option({
  label,
  checked,
  onToggle
}: {
  label: string
  checked: boolean
  onToggle: () => void
}): JSX.Element {
  return (
    <label className="flex cursor-pointer items-center gap-2 px-3 py-1 text-sm text-ink hover:bg-ink/5">
      <input type="checkbox" checked={checked} onChange={onToggle} className="accent-accent" />
      <span className="truncate">{label}</span>
    </label>
  )
}

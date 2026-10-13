import { useEffect, useRef, useState, type FormEvent, type JSX, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'

export interface PromptDialogProps {
  title: string
  label: string
  initialValue?: string
  submitLabel: string
  validate?: (value: string) => string | null
  onSubmit: (value: string) => void
  onClose: () => void
}

export function PromptDialog({
  title,
  label,
  initialValue = '',
  submitLabel,
  validate,
  onSubmit,
  onClose
}: PromptDialogProps): JSX.Element {
  const { t } = useTranslation()
  const [value, setValue] = useState(initialValue)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const input = inputRef.current
    if (input === null) return
    input.focus()
    const dot = initialValue.lastIndexOf('.')
    if (dot > 0) input.setSelectionRange(0, dot)
    else input.select()
  }, [initialValue])

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
  }

  const submit = (event?: FormEvent): void => {
    event?.preventDefault()
    const failure = validate?.(value) ?? null
    if (failure !== null) {
      setError(failure)
      return
    }
    onSubmit(value)
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-center bg-black/40 pt-32" onMouseDown={onClose}>
      <form
        onSubmit={submit}
        className="h-fit w-full max-w-sm overflow-hidden rounded-lg border border-line bg-panel p-4 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        <label className="mt-3 block text-xs text-muted" htmlFor="gtd-prompt-input">
          {label}
        </label>
        <input
          id="gtd-prompt-input"
          ref={inputRef}
          value={value}
          onChange={(event) => {
            setValue(event.target.value)
            setError(null)
          }}
          onKeyDown={onKeyDown}
          className="mt-1 w-full rounded border border-line bg-canvas px-2 py-1 text-sm text-ink outline-none focus:border-accent"
        />
        {error !== null && <p className="mt-1 text-xs text-danger">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="rounded px-3 py-1 text-sm text-muted hover:bg-ink/5 hover:text-ink"
            onClick={onClose}
          >
            {t('dialogs.cancel')}
          </button>
          <button
            type="submit"
            className="rounded bg-accent px-3 py-1 text-sm text-white hover:opacity-90"
          >
            {submitLabel}
          </button>
        </div>
      </form>
    </div>
  )
}

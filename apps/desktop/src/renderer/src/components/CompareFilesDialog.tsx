import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { FileChange } from '@gitreedesk/shared'
import { CHANGE_LETTER } from '../lib/change-letter'
import { XIcon } from './icons'

/**
 * The list of files changed between two sides. Branch, commit and directory
 * comparisons all land here; picking a row hands it back for the caller to open.
 */
export function CompareFilesDialog({
  title,
  files,
  summary,
  onPick,
  onClose
}: {
  title: string
  files: readonly FileChange[]
  summary?: string
  onPick: (file: FileChange) => void
  onClose: () => void
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-black/40 pt-24" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="h-fit w-full max-w-lg overflow-hidden rounded-lg border border-line bg-panel shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-center gap-2 border-b border-line px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink" title={title}>
            {title}
          </span>
          <button
            type="button"
            aria-label={t('dialogs.close')}
            className="shrink-0 rounded p-0.5 text-muted hover:bg-ink/5 hover:text-ink"
            onClick={onClose}
          >
            <XIcon className="size-3.5" />
          </button>
        </header>
        {summary !== undefined && <p className="px-3 pt-1.5 text-xs text-muted">{summary}</p>}
        <ul className="max-h-96 overflow-y-auto py-1">
          {files.map((file) => (
            <li key={`${file.origPath ?? ''}\u0000${file.path}`}>
              <button
                type="button"
                title={file.path}
                className="flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-sm hover:bg-ink/5"
                onClick={() => onPick(file)}
              >
                <span className="w-3 shrink-0 text-center font-mono text-xs text-muted">{CHANGE_LETTER[file.kind]}</span>
                <span className="min-w-0 flex-1 truncate text-ink">{file.path}</span>
                {file.origPath !== undefined && (
                  <span className="min-w-0 shrink-0 truncate font-mono text-xs text-muted">← {file.origPath}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

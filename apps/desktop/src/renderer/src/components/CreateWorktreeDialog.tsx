import { useEffect, useMemo, useRef, useState, type FormEvent, type JSX, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { GitRef, RepoRecord, RepoWorktree } from '@gitreedesk/shared'
import { api } from '../api'
import { useWorkspace } from '../contexts/workspace'
import { errorText } from '../lib/reporting'
import { notify } from '../notify'

function toPosix(value: string): string {
  return value.replace(/\\/g, '/')
}

/** Absolute when it carries a drive letter or a leading slash; otherwise relative to the root. */
function resolveWorktreeRoot(root: string, stored: unknown): string {
  const configured = typeof stored === 'string' && stored.trim().length > 0 ? toPosix(stored.trim()) : null
  if (configured !== null && /^([A-Za-z]:)?\//.test(configured)) return configured.replace(/\/+$/, '')
  const relative = configured ?? '__worktree__'
  return `${root.replace(/\/+$/, '')}/${relative.replace(/^\/+/, '').replace(/\/+$/, '')}`
}

export function CreateWorktreeDialog({
  record,
  onClose,
  onCreated
}: {
  record: RepoRecord
  onClose: () => void
  onCreated?: (path: string) => void
}): JSX.Element {
  const { t } = useTranslation()
  const { descriptor } = useWorkspace()
  const root = descriptor?.root ?? ''
  const [refs, setRefs] = useState<readonly GitRef[]>([])
  const [worktrees, setWorktrees] = useState<readonly RepoWorktree[]>([])
  const [worktreeRoot, setWorktreeRoot] = useState<string | null>(null)
  const [mode, setMode] = useState<'new' | 'existing'>('new')
  const [branchName, setBranchName] = useState('')
  const [existing, setExisting] = useState('')
  const [base, setBase] = useState('HEAD')
  const [target, setTarget] = useState('')
  const [targetTouched, setTargetTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    nameRef.current?.focus()
  }, [])

  useEffect(() => {
    let live = true
    void Promise.all([
      api.invoke('git:refs', { gitDir: record.gitDir }),
      api.invoke('git:worktrees', { gitDir: record.gitDir })
    ]).then(
      ([refsResult, worktreesResult]) => {
        if (!live) return
        setRefs(refsResult.refs)
        setWorktrees(worktreesResult.worktrees)
      },
      () => undefined
    )
    return () => {
      live = false
    }
  }, [record.gitDir])

  useEffect(() => {
    let live = true
    void api.invoke('settings:getEffective', { keyPath: ['git', 'worktreeRoot'] }).then(
      ({ value }) => {
        if (live) setWorktreeRoot(resolveWorktreeRoot(root, value))
      },
      () => {
        if (live) setWorktreeRoot(resolveWorktreeRoot(root, null))
      }
    )
    return () => {
      live = false
    }
  }, [root])

  const branches = useMemo(
    () => refs.filter((ref) => ref.kind === 'branch' && ref.name.length > 0),
    [refs]
  )

  const slug = (mode === 'new' ? branchName : existing).trim().replaceAll('/', '-')
  const suggested =
    worktreeRoot !== null && slug.length > 0 ? `${worktreeRoot}/${record.name}_${slug}` : ''

  useEffect(() => {
    if (!targetTouched) setTarget(suggested)
  }, [suggested, targetTouched])

  const occupiedBy = useMemo(() => {
    if (mode !== 'existing' || existing.length === 0) return null
    return worktrees.find((worktree) => worktree.branch === `refs/heads/${existing}`)?.path ?? null
  }, [mode, existing, worktrees])

  const branchReady =
    mode === 'new' ? branchName.trim().length > 0 : existing.length > 0 && occupiedBy === null
  const ready = branchReady && target.trim().length > 0 && !busy

  const submit = (event?: FormEvent): void => {
    event?.preventDefault()
    if (!ready) return
    void (async () => {
      setBusy(true)
      setError(null)
      const path = target.trim()
      try {
        const start = base.trim()
        const result = await api.invoke(
          'git:worktreeAdd',
          mode === 'new'
            ? {
                gitDir: record.gitDir,
                path,
                newBranch: branchName.trim(),
                ...(start !== '' && start !== 'HEAD' ? { base: start } : {})
              }
            : { gitDir: record.gitDir, path, branch: existing }
        )
        notify({ message: t('worktree.created', { name: result.path.split('/').pop() ?? result.path }) })
        onCreated?.(result.path)
        onClose()
      } catch (failure) {
        setError(errorText(failure, t))
        setBusy(false)
      }
    })()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-black/40 pt-24" onMouseDown={onClose}>
      <form
        onSubmit={submit}
        className="h-fit w-full max-w-md overflow-hidden rounded-lg border border-line bg-panel p-4 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <h2 className="text-sm font-semibold text-ink">
          {t('worktree.createTitle', { name: record.name })}
        </h2>

        <div className="mt-3 flex items-center gap-4">
          <label className="flex items-center gap-1.5 text-xs text-ink">
            <input
              type="radio"
              name="gtd-worktree-mode"
              className="accent-accent"
              checked={mode === 'new'}
              onChange={() => {
                setMode('new')
                setError(null)
              }}
            />
            {t('worktree.newBranch')}
          </label>
          <label className="flex items-center gap-1.5 text-xs text-ink">
            <input
              type="radio"
              name="gtd-worktree-mode"
              className="accent-accent"
              checked={mode === 'existing'}
              onChange={() => {
                setMode('existing')
                setError(null)
              }}
            />
            {t('worktree.existingBranch')}
          </label>
        </div>

        {mode === 'new' ? (
          <>
            <label className="mt-3 block text-xs text-muted" htmlFor="gtd-worktree-branch">
              {t('worktree.branchName')}
            </label>
            <input
              id="gtd-worktree-branch"
              ref={nameRef}
              value={branchName}
              onChange={(event) => {
                setBranchName(event.target.value)
                setError(null)
              }}
              className="mt-1 w-full rounded border border-line bg-canvas px-2 py-1 font-mono text-sm text-ink outline-none focus:border-accent"
            />

            <label className="mt-3 block text-xs text-muted" htmlFor="gtd-worktree-base">
              {t('worktree.baseLabel')}
            </label>
            <input
              id="gtd-worktree-base"
              list="gtd-worktree-base-refs"
              value={base}
              onChange={(event) => setBase(event.target.value)}
              className="mt-1 w-full rounded border border-line bg-canvas px-2 py-1 font-mono text-sm text-ink outline-none focus:border-accent"
            />
            <datalist id="gtd-worktree-base-refs">
              <option value="HEAD" />
              {refs.map((ref) => (
                <option key={ref.fullName} value={ref.name}>
                  {t(`branches.kinds.${ref.kind}`)}
                </option>
              ))}
            </datalist>
          </>
        ) : (
          <>
            <label className="mt-3 block text-xs text-muted" htmlFor="gtd-worktree-existing">
              {t('worktree.branchLabel')}
            </label>
            <select
              id="gtd-worktree-existing"
              value={existing}
              onChange={(event) => {
                setExisting(event.target.value)
                setError(null)
              }}
              className="mt-1 w-full rounded border border-line bg-canvas px-2 py-1 font-mono text-sm text-ink outline-none focus:border-accent"
            >
              <option value="">—</option>
              {branches.map((ref) => {
                const owner = worktrees.find((worktree) => worktree.branch === `refs/heads/${ref.name}`)
                return (
                  <option key={ref.fullName} value={ref.name} disabled={owner !== undefined}>
                    {owner === undefined
                      ? ref.name
                      : `${ref.name} — ${t('worktree.occupied', { path: owner.path })}`}
                  </option>
                )
              })}
            </select>
            {occupiedBy !== null && (
              <p className="mt-1 text-xs break-words text-danger">
                {t('worktree.occupied', { path: occupiedBy })}
              </p>
            )}
          </>
        )}

        <label className="mt-3 block text-xs text-muted" htmlFor="gtd-worktree-path">
          {t('worktree.pathLabel')}
        </label>
        <input
          id="gtd-worktree-path"
          value={target}
          placeholder={`{worktreeRoot}/${record.name}_{branch-slug}`}
          onChange={(event) => {
            setTarget(event.target.value)
            setTargetTouched(true)
            setError(null)
          }}
          className="mt-1 w-full rounded border border-line bg-canvas px-2 py-1 font-mono text-sm text-ink outline-none focus:border-accent"
        />
        <p className="mt-1 text-xs text-muted">
          {t('worktree.pathHint', {
            worktreeRoot: worktreeRoot ?? '{worktreeRoot}',
            repo: record.name
          })}
        </p>

        {error !== null && <p className="mt-2 text-xs break-words text-danger">{error}</p>}

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
            disabled={!ready}
            className="rounded bg-accent px-3 py-1 text-sm text-white hover:opacity-90 disabled:opacity-50"
          >
            {t('dialogs.create')}
          </button>
        </div>
      </form>
    </div>
  )
}

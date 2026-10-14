import type { ResetMode } from '@gitreedesk/shared'
import { assertRefName } from './branches'
import { resetRepo } from './reset'
import { runGitOrThrow } from './run'
import { stashStore } from './stashes'

export type UndoKind = 'reset' | 'rebase' | 'stash-drop' | 'branch-delete'

/** What an operation-log row needs to restore the state before the operation. */
export interface UndoDescriptor {
  kind: UndoKind
  /** `reset`: which reset to reverse. */
  mode?: ResetMode
  /** Commit the branch pointed at before the operation (`reset`, `rebase`). */
  before?: string
  /** `branch-delete`: the deleted branch; `stash-drop`: the stash subject. */
  name?: string
  subject?: string
  /** Ref the operation acted on; recorded for display and restored state hints. */
  target?: string
}

export function encodeUndoState(descriptor: UndoDescriptor): string {
  return JSON.stringify(descriptor)
}

export function parseUndoState(raw: string | null | undefined): UndoDescriptor | null {
  if (raw === null || raw === undefined || raw.length === 0) return null
  try {
    const value = JSON.parse(raw) as Record<string, unknown>
    const kind = value.kind
    if (kind !== 'reset' && kind !== 'rebase' && kind !== 'stash-drop' && kind !== 'branch-delete') {
      return null
    }
    return {
      kind,
      mode:
        value.mode === 'soft' || value.mode === 'mixed' || value.mode === 'hard'
          ? value.mode
          : undefined,
      before: typeof value.before === 'string' ? value.before : undefined,
      name: typeof value.name === 'string' ? value.name : undefined,
      subject: typeof value.subject === 'string' ? value.subject : undefined,
      target: typeof value.target === 'string' ? value.target : undefined
    }
  } catch {
    return null
  }
}

export interface PerformUndoOptions {
  descriptor: UndoDescriptor
  /** Tip of the operation's backup ref; used when the descriptor is incomplete. */
  backupSha?: string | null
  signal?: AbortSignal
}

/** Reverses a recorded operation; each kind restores exactly what it replaced. */
export async function performUndo(repoPath: string, options: PerformUndoOptions): Promise<void> {
  const { descriptor } = options
  switch (descriptor.kind) {
    case 'reset': {
      if (descriptor.before === undefined) throw new Error('Undo state is missing the previous revision')
      await resetRepo(repoPath, {
        mode: descriptor.mode ?? 'mixed',
        target: descriptor.before,
        signal: options.signal
      })
      return
    }
    case 'rebase': {
      if (descriptor.before === undefined) throw new Error('Undo state is missing the previous revision')
      await resetRepo(repoPath, { mode: 'hard', target: descriptor.before, signal: options.signal })
      return
    }
    case 'stash-drop': {
      const sha = descriptor.before ?? options.backupSha ?? null
      if (sha === null || sha.length === 0) throw new Error('Undo state is missing the stash commit')
      await stashStore(repoPath, {
        sha,
        message: descriptor.subject ?? 'restored stash',
        signal: options.signal
      })
      return
    }
    case 'branch-delete': {
      const name = descriptor.name
      const sha = options.backupSha ?? descriptor.before ?? null
      if (name === undefined || name.length === 0) throw new Error('Undo state is missing the branch name')
      if (sha === null || sha.length === 0) throw new Error('Undo state is missing the branch commit')
      assertRefName(name)
      await runGitOrThrow(['branch', name, sha], { cwd: repoPath, signal: options.signal })
      return
    }
  }
}

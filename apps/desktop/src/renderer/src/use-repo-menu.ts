import { useTranslation } from 'react-i18next'
import type { RepoRecord } from '@gitreedesk/shared'
import { api } from './api'
import { useGraph } from './contexts/graph'
import { useOperations } from './contexts/operations-context'
import { useReposUi } from './contexts/repos'
import { useSubmodules } from './contexts/submodules'
import { useTerminal } from './contexts/terminal'
import { useTreeUi } from './contexts/tree'
import { useWorkspace } from './contexts/workspace'
import { notifyError } from './notify'
import { checkoutKey, isSubmoduleRecord, submoduleParentOf } from './tree/repos-model'
import type { ContextMenuItem } from './components/ContextMenu'

export interface RepoMenuTarget {
  /** Checkout key of the row (the repository path). */
  key: string
  record: RepoRecord
  /** Rows of a multi-row selection the target belongs to; omitted for a single row. */
  selection?: readonly { key: string; record: RepoRecord }[]
}

/**
 * The repository action menu, shared by the tree row context menu, the row
 * action button and the commit graph toolbar so the lists cannot drift apart.
 * The graph toolbar passes `includeGraph: false` because it already is the graph.
 */
export function useRepoMenu(): (
  target: RepoMenuTarget,
  options?: { includeGraph?: boolean }
) => ContextMenuItem[] {
  const { t } = useTranslation()
  const { descriptor, statuses } = useWorkspace()
  const repoUi = useReposUi()
  const operations = useOperations()
  const graph = useGraph()
  const tree = useTreeUi()
  const terminal = useTerminal()
  const { submodulesFor } = useSubmodules()
  const records = descriptor?.records ?? []

  const copyPath = (text: string): void => {
    void api.invoke('app:copyText', { text }).catch((error: unknown) => {
      notifyError(error instanceof Error ? error.message : String(error))
    })
  }

  const reveal = (path: string): void => {
    void api.invoke('fs:reveal', { path }).catch((error: unknown) => {
      notifyError(error instanceof Error ? error.message : String(error))
    })
  }

  const openInEditor = (path: string): void => {
    void api.invoke('editor:openInCode', { path }).catch((error: unknown) => {
      notifyError(error instanceof Error ? error.message : String(error))
    })
  }

  return (target, options) => {
    const includeGraph = options?.includeGraph !== false
    const record = target.record
    const selection = target.selection ?? []
    const inSelection = selection.some((entry) => entry.key === target.key)
    const paths = inSelection ? selection.map((entry) => entry.key) : [target.key]
    const picked = inSelection ? selection.map((entry) => entry.record) : [record]
    const syncTargets = picked.filter((candidate) => candidate.gitDir.length > 0)
    const pullable = syncTargets.filter((candidate) => candidate.kind !== 'bare')
    const status = statuses.get(record.gitDir)?.status ?? null
    const branch = status?.head.ref ?? null
    const pushable = record.kind !== 'bare' && branch !== null
    const canTarget = record.gitDir.length > 0
    const isWorktree = record.kind === 'worktree'
    const isSubmodule = isSubmoduleRecord(record)
    const submoduleParent = isSubmodule ? submoduleParentOf(record, records) : null
    const submodulePath =
      submoduleParent === null ? null : record.path.slice(submoduleParent.path.length + 1)
    const listed = submodulesFor(record)
    const hasSubmodules = listed !== null && listed.length > 0
    const drifted =
      submoduleParent !== null &&
      submodulePath !== null &&
      (submodulesFor(submoduleParent) ?? []).some(
        (submodule) => submodule.path === submodulePath && submodule.checkout === 'different'
      )
    const locked = isWorktree && record.worktreeLocked !== undefined && record.worktreeLocked !== null
    const prunable =
      isWorktree && record.worktreePrunable !== undefined && record.worktreePrunable !== null
    // A prunable row has no git dir of its own; prune runs from any live checkout of the repo.
    const pruneAnchor =
      canTarget && record.kind !== 'bare'
        ? record
        : (records.find(
            (candidate) =>
              candidate.id === record.id && candidate.gitDir.length > 0 && candidate.kind !== 'bare'
          ) ?? null)

    const submoduleItems: ContextMenuItem[] =
      isSubmodule && submoduleParent !== null && submodulePath !== null
        ? [
            {
              label: drifted ? t('menu.checkoutRecordedCommit') : t('menu.updateSubmodule'),
              onSelect: () => operations.updateSubmodule(submoduleParent, submodulePath)
            },
            {
              label: t('menu.deinitSubmodule'),
              onSelect: () => operations.deinitSubmodule(submoduleParent, submodulePath)
            },
            {
              label: t('menu.openAsRepository'),
              onSelect: () => {
                if (record.gitDir.length > 0) repoUi.setActiveKey(record.gitDir)
                tree.requestRepoFocus(record.path)
              }
            }
          ]
        : []

    return [
      // Branch.
      {
        label: t('menu.checkoutBranch'),
        disabled: !canTarget || record.kind === 'bare',
        onSelect: () => {
          repoUi.setActiveKey(record.gitDir)
          operations.openBranches(record)
        }
      },
      {
        label: t('menu.createBranch'),
        disabled: !canTarget || record.kind === 'bare',
        onSelect: () => {
          repoUi.setActiveKey(record.gitDir)
          operations.openCreateBranch(record)
        }
      },
      ...(includeGraph
        ? [
            {
              label: t('menu.openGraph'),
              disabled: !canTarget,
              onSelect: () => {
                repoUi.setActiveKey(record.gitDir)
                graph.openGraph(record)
              }
            }
          ]
        : []),
      // Sync.
      {
        label: syncTargets.length > 1 ? t('menu.fetchSelected') : t('menu.fetch'),
        divider: true,
        disabled: syncTargets.length === 0,
        onSelect: () => operations.fetchRepos(syncTargets)
      },
      {
        label: syncTargets.length > 1 ? t('menu.pullSelected') : t('menu.pull'),
        disabled: pullable.length === 0,
        onSelect: () => operations.pullRepos(pullable)
      },
      {
        label: t('menu.push'),
        disabled: !pushable,
        onSelect: () => {
          if (branch === null) return
          operations.pushBranch(record, branch, {
            hasUpstream: status !== null && status.upstream !== null
          })
        }
      },
      // Submodules.
      ...(submoduleItems.length > 0
        ? [{ ...(submoduleItems[0] as ContextMenuItem), divider: true }, ...submoduleItems.slice(1)]
        : []),
      {
        label: t('menu.addSubmodule'),
        divider: submoduleItems.length === 0,
        disabled: !canTarget || record.kind === 'bare',
        onSelect: () => {
          repoUi.setActiveKey(record.gitDir)
          operations.openAddSubmodule(record)
        }
      },
      {
        label: t('menu.updateSubmodules'),
        disabled: !canTarget || record.kind === 'bare' || !hasSubmodules,
        onSelect: () => operations.updateSubmodules(record)
      },
      {
        label: t('menu.syncSubmoduleUrls'),
        disabled: !canTarget || record.kind === 'bare' || !hasSubmodules,
        onSelect: () => operations.syncSubmoduleUrls(record)
      },
      // Remotes, tags, stashes, backups.
      {
        label: t('menu.remotes'),
        divider: true,
        disabled: !canTarget,
        onSelect: () => {
          repoUi.setActiveKey(record.gitDir)
          operations.openRemotes(record)
        }
      },
      {
        label: t('menu.tags'),
        disabled: !canTarget,
        onSelect: () => {
          repoUi.setActiveKey(record.gitDir)
          operations.openTags(record)
        }
      },
      {
        label: t('menu.stashCreate'),
        disabled: !canTarget || record.kind === 'bare',
        onSelect: () => {
          repoUi.setActiveKey(record.gitDir)
          operations.openStashCreate(record)
        }
      },
      {
        label: t('menu.stashes'),
        disabled: !canTarget || record.kind === 'bare',
        onSelect: () => {
          repoUi.setActiveKey(record.gitDir)
          operations.openStashes(record)
        }
      },
      {
        label: t('menu.restoreBackup'),
        disabled: !canTarget,
        onSelect: () => {
          repoUi.setActiveKey(record.gitDir)
          operations.openBackupRestore(record)
        }
      },
      // Worktrees.
      {
        label: t('menu.newWorktree'),
        divider: true,
        disabled: !canTarget || record.kind === 'bare',
        onSelect: () => {
          repoUi.setActiveKey(record.gitDir)
          operations.openCreateWorktree(record)
        }
      },
      {
        label: t('menu.removeWorktree'),
        disabled: !isWorktree || !canTarget || prunable,
        onSelect: () => operations.removeWorktree(record)
      },
      {
        label: t('menu.moveWorktree'),
        disabled: !isWorktree || !canTarget || prunable,
        onSelect: () => operations.moveWorktree(record)
      },
      {
        label: locked ? t('menu.unlockWorktree') : t('menu.lockWorktree'),
        disabled: !isWorktree || !canTarget || prunable,
        onSelect: () =>
          locked ? operations.unlockWorktree(record) : operations.lockWorktree(record)
      },
      {
        label: t('menu.pruneWorktrees'),
        disabled: pruneAnchor === null,
        onSelect: () => {
          if (pruneAnchor !== null) operations.pruneWorktrees(pruneAnchor)
        }
      },
      // Copy and open.
      {
        label: paths.length > 1 ? t('menu.copyPaths') : t('menu.copyPath'),
        divider: true,
        onSelect: () => copyPath(paths.join('\n'))
      },
      { label: t('menu.reveal'), onSelect: () => reveal(record.path) },
      { label: t('menu.openInEditor'), onSelect: () => openInEditor(record.path) },
      {
        label: t('menu.openTerminal'),
        disabled: prunable,
        onSelect: () => terminal.open(record.path)
      }
    ]
  }
}

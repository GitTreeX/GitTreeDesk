import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import {
  INVOKE_CHANNELS,
  type AppInfo,
  type AppOpenFolderRequest,
  type EditorOpenRequest,
  type EventChannel,
  type GitOpenMergeToolRequest,
  type IpcErrorInfo,
  type IpcResult,
  type KeybindingsChangedEvent,
  type SettingsChangedEvent
} from '@gitreedesk/shared'
import { invokeSchemas } from '@gitreedesk/shared/validate'
import type { InvokeHandlers } from '@gitreedesk/shared'
import type { KeybindingChange, SettingsChange } from '@gitreedesk/store'
import { buildEditorCommand } from './editor-command'
import { launchShell, nativePath, openInEditor } from './editor-launcher'
import { perfSnapshot, recordOp } from './perf-metrics'
import type { CommitMessageService, CommitMessageServiceEvent } from './services/commit-message'
import { ServiceError } from './services/errors'
import { StatusBatcher } from './services/status-batcher'
import type { TerminalService, TerminalServiceEvent } from './services/terminal'
import type { WorkspaceService, WorkspaceServiceEvent } from './services/workspace-service'

const STATUS_FLUSH_MS = 33

export interface EventBroadcaster {
  handle(event: WorkspaceServiceEvent): void
  handleCommitMessage(event: CommitMessageServiceEvent): void
  handleTerminal(event: TerminalServiceEvent): void
  dispose(): void
}

/** Maps service events onto renderer channels, batching status updates. */
export function createEventBroadcaster(): EventBroadcaster {
  const batcher = new StatusBatcher({
    intervalMs: STATUS_FLUSH_MS,
    onFlush: (root, updates) => {
      broadcast('git:statusChanged', { root, updates })
    }
  })

  return {
    handle(event) {
      switch (event.type) {
        case 'status':
          batcher.push(event.root, event.update)
          break
        case 'reposChanged':
          broadcast('workspace:reposChanged', {
            root: event.root,
            added: event.diff.added,
            removed: event.diff.removed,
            updated: event.diff.updated,
            stats: event.stats
          })
          break
        case 'commitOutput':
          broadcast('git:commitOutput', { root: event.root, gitDir: event.gitDir, chunk: event.chunk })
          break
        case 'submoduleOutput':
          broadcast('git:submoduleOutput', {
            root: event.root,
            gitDir: event.gitDir,
            path: event.path,
            chunk: event.chunk
          })
          break
        case 'treeChanged':
          broadcast('fs:changed', { root: event.root, paths: event.paths })
          break
        case 'issues':
          broadcast('workspace:issues', { root: event.root, issues: event.issues })
          break
        case 'degraded':
          broadcast('watcher:degraded', {
            root: event.root,
            kind: event.kind,
            dir: event.dir,
            degraded: event.degraded
          })
          break
        case 'settingsChanged':
          broadcast('settings:changed', toSettingsChangedEvent(event.change))
          break
        case 'keybindingsChanged':
          broadcast('keybindings:changed', toKeybindingsChangedEvent(event.change))
          break
      }
    },
    handleCommitMessage(event) {
      if (event.type === 'output') broadcast('commitmsg:output', event.payload)
      else broadcast('commitmsg:done', event.payload)
    },
    handleTerminal(event) {
      if (event.type === 'frame') broadcast('terminal:frame', { id: event.id, frame: event.frame })
      else broadcast('terminal:exited', { id: event.id, code: event.code })
    },
    dispose() {
      batcher.dispose()
    }
  }
}

export interface IpcBridge {
  dispose(): void
}

export interface IpcAppPaths {
  userDataDir: string
}

export function registerIpcHandlers(
  service: WorkspaceService,
  commitMessages: CommitMessageService,
  terminals: TerminalService,
  appPaths: IpcAppPaths
): IpcBridge {
  const handlers = createHandlers(service, commitMessages, terminals, appPaths)

  for (const channel of INVOKE_CHANNELS) {
    // Status reads report their own timing through the scheduler; keeping them out of the
    // op ring leaves room for the operations that actually spawn git processes.
    const timed = channel.startsWith('git:') ? channel !== 'git:status' : channel.startsWith('commitmsg:')
    ipcMain.handle(channel, async (_event, payload: unknown): Promise<IpcResult<unknown>> => {
      const parsed = invokeSchemas[channel].safeParse(payload)
      if (!parsed.success) {
        return {
          ok: false,
          error: { code: 'invalid-request', message: describeIssues(parsed.error.issues) }
        }
      }
      const started = timed ? performance.now() : 0
      try {
        const handler = handlers[channel] as (request: unknown) => unknown
        const value = await handler(parsed.data)
        if (timed) recordOp(channel, performance.now() - started, true)
        return { ok: true, value }
      } catch (error) {
        if (timed) recordOp(channel, performance.now() - started, false)
        return { ok: false, error: toErrorInfo(error) }
      }
    })
  }

  return {
    dispose() {
      for (const channel of INVOKE_CHANNELS) ipcMain.removeHandler(channel)
    }
  }
}

function createHandlers(
  service: WorkspaceService,
  commitMessages: CommitMessageService,
  terminals: TerminalService,
  appPaths: IpcAppPaths
): InvokeHandlers {
  return {
    'workspace:open': (request) => service.open(request.root),
    'workspace:close': () => service.close(),
    'workspace:recent': () => ({ workspaces: service.recent() }),
    'workspace:rescan': (request) => service.rescan(request.dirs, request.raiseBudget === true),
    'workspace:pick': () => pickWorkspaceFolder(),
    'workspace:removeRecent': (request) => service.removeRecent(request.root),
    'git:status': (request) => service.getStatus(request),
    'git:stage': (request) => service.gitStage(request),
    'git:unstage': (request) => service.gitUnstage(request),
    'git:discard': (request) => service.gitDiscard(request),
    'git:stageAll': (request) => service.gitStageAll(request),
    'git:unstageAll': (request) => service.gitUnstageAll(request),
    'git:ignore': (request) => service.gitIgnore(request),
    'git:diff': (request) => service.gitDiff(request),
    'git:applyHunk': (request) => service.gitApplyHunk(request),
    'git:commit': (request) => service.gitCommit(request),
    'git:headCommit': (request) => service.gitHeadCommit(request),
    'git:fileHistory': (request) => service.gitFileHistory(request),
    'git:refs': (request) => service.gitRefs(request),
    'git:branchCheckout': (request) => service.gitBranchCheckout(request),
    'git:checkoutDetach': (request) => service.gitCheckoutDetach(request),
    'git:branchCreate': (request) => service.gitBranchCreate(request),
    'git:branchRename': (request) => service.gitBranchRename(request),
    'git:branchDelete': (request) => service.gitBranchDelete(request),
    'git:branchSetUpstream': (request) => service.gitBranchSetUpstream(request),
    'git:remotes': (request) => service.gitRemotes(request),
    'git:remoteAdd': (request) => service.gitRemoteAdd(request),
    'git:remoteRemove': (request) => service.gitRemoteRemove(request),
    'git:remoteSetUrl': (request) => service.gitRemoteSetUrl(request),
    'git:fetch': (request) => service.gitFetch(request),
    'git:fetchMany': (request) => service.gitFetchMany(request),
    'git:pull': (request) => service.gitPull(request),
    'git:pullMany': (request) => service.gitPullMany(request),
    'git:push': (request) => service.gitPush(request),
    'git:tagCreate': (request) => service.gitTagCreate(request),
    'git:tagDelete': (request) => service.gitTagDelete(request),
    'git:tagPush': (request) => service.gitTagPush(request),
    'git:tagPushAll': (request) => service.gitTagPushAll(request),
    'git:tagDeleteRemote': (request) => service.gitTagDeleteRemote(request),
    'git:remoteTags': (request) => service.gitRemoteTags(request),
    'git:diffFiles': (request) => service.gitDiffFiles(request),
    'git:merge': (request) => service.gitMerge(request),
    'git:rebase': (request) => service.gitRebase(request),
    'git:rebasePlan': (request) => service.gitRebasePlan(request),
    'git:rebaseInteractive': (request) => service.gitRebaseInteractive(request),
    'git:opContinue': (request) => service.gitOpContinue(request),
    'git:opSkip': (request) => service.gitOpSkip(request),
    'git:opAbort': (request) => service.gitOpAbort(request),
    'git:cherryPick': (request) => service.gitCherryPick(request),
    'git:revert': (request) => service.gitRevert(request),
    'git:reset': (request) => service.gitReset(request),
    'git:conflictResolve': (request) => service.gitConflictResolve(request),
    'git:openMergeTool': (request) => openMergeToolEntry(service, request),
    'git:stashCreate': (request) => service.gitStashCreate(request),
    'git:stashList': (request) => service.gitStashList(request),
    'git:stashFiles': (request) => service.gitStashFiles(request),
    'git:stashDiff': (request) => service.gitStashDiff(request),
    'git:stashApply': (request) => service.gitStashApply(request),
    'git:stashPop': (request) => service.gitStashPop(request),
    'git:stashDrop': (request) => service.gitStashDrop(request),
    'git:log': (request) => service.gitLog(request),
    'git:graph': (request) => service.gitGraph(request),
    'git:activity': (request) => service.gitActivity(request),
    'git:commitDetails': (request) => service.gitCommitDetails(request),
    'git:editCommit': (request) => service.gitEditCommit(request),
    'git:oplog': (request) => service.gitOpLog(request),
    'git:oplogUndo': (request) => service.gitOpLogUndo(request),
    'git:backups': (request) => service.gitBackups(request),
    'git:restoreBackup': (request) => service.gitRestoreBackup(request),
    'git:worktrees': (request) => service.gitWorktrees(request),
    'git:worktreeAdd': (request) => service.gitWorktreeAdd(request),
    'git:worktreeMove': (request) => service.gitWorktreeMove(request),
    'git:worktreeRemove': (request) => service.gitWorktreeRemove(request),
    'git:worktreePrune': (request) => service.gitWorktreePrune(request),
    'git:worktreeLock': (request) => service.gitWorktreeLock(request),
    'git:worktreeUnlock': (request) => service.gitWorktreeUnlock(request),
    'git:submodules': (request) => service.gitSubmodules(request),
    'git:submoduleUpdate': (request) => service.gitSubmoduleUpdate(request),
    'git:submoduleSync': (request) => service.gitSubmoduleSync(request),
    'git:submoduleAdd': (request) => service.gitSubmoduleAdd(request),
    'git:submoduleDeinit': (request) => service.gitSubmoduleDeinit(request),
    'commitmsg:generate': (request) => commitMessages.generate(request),
    'commitmsg:cancel': (request) => commitMessages.cancel(request.generationId),
    'commitmsg:approveHost': (request) => commitMessages.approveHost(request.host),
    'commitmsg:setKey': (request) => commitMessages.setKey(request.key),
    'commitmsg:removeKey': () => commitMessages.removeKey(),
    'commitmsg:keyStatus': () => commitMessages.keyStatus(),
    'terminal:resolve': (request) => terminals.resolve(request),
    'terminal:create': (request) => terminals.createSession(request),
    'terminal:quickRun': (request) => terminals.quickRun(request),
    'terminal:sessions': () => terminals.sessions(),
    'terminal:attach': (request) => terminals.attach(request),
    'terminal:write': (request) => terminals.write(request),
    'terminal:resize': (request) => terminals.resize(request),
    'terminal:kill': (request) => terminals.kill(request),
    'terminal:dispose': (request) => terminals.disposeSession(request),
    'fs:readDir': (request) => service.readDir(request.path),
    'fs:readFile': (request) => service.readFileForEditor(request),
    'fs:stat': (request) => service.statPath(request),
    'fs:writeFile': (request) => service.writeFileForEditor(request),
    'workspace:listFiles': (request) => service.listFiles(request.limit),
    'fs:create': (request) => service.createEntry(request.parent, request.name, request.kind),
    'fs:rename': (request) => service.renameEntry(request.path, request.newName),
    'fs:duplicate': (request) => service.duplicateEntry(request.path, request.suffix),
    'fs:trash': (request) => trashEntry(service, request.path),
    'fs:reveal': (request) => revealEntry(service, request.path),
    'fs:openExternal': (request) => openExternalEntry(service, request.path),
    'fs:watch': (request) => service.watchDirectory(request.path),
    'fs:unwatch': (request) => service.unwatchDirectory(request.path),
    'editor:openInCode': (request) => openInCodeEntry(service, request),
    'app:copyText': (request) => {
      clipboard.writeText(request.text)
      return null
    },
    'settings:get': (request) => service.settingsGet(request),
    'settings:getAll': (request) => service.settingsGetAll(request.scope),
    'settings:getEffective': (request) => service.settingsGetEffective(request.keyPath),
    'settings:set': (request) => service.settingsSet(request),
    'settings:remove': (request) => service.settingsRemove(request),
    'keybindings:get': () => service.keybindingsGet(),
    'keybindings:set': (request) => service.keybindingsSet(request),
    'keybindings:reset': (request) => service.keybindingsReset(request),
    'trust:query': () => service.trustQuery(),
    'trust:grant': (request) => service.trustGrant(request),
    'ui-state:get': (request) => service.uiStateGet(request.key),
    'ui-state:set': (request) => service.uiStateSet(request.key, request.value),
    'ui-state:keys': (request) => service.uiStateKeys(request.prefix),
    'ui-state:delete': (request) => service.uiStateDelete(request.key),
    'app:info': () => appInfo(service),
    'app:perfStats': () => ({ ...perfSnapshot(), watchers: service.watcherStats() }),
    'app:openFolder': (request) => openAppFolder(appPaths, request)
  }
}

async function pickWorkspaceFolder(): Promise<{ path: string | null }> {
  const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const options = { properties: ['openDirectory' as const] }
  const result =
    window === undefined
      ? await dialog.showOpenDialog(options)
      : await dialog.showOpenDialog(window, options)
  if (result.canceled) return { path: null }
  return { path: result.filePaths[0] ?? null }
}

async function trashEntry(service: WorkspaceService, path: string): Promise<null> {
  const entry = await service.resolveEntry(path)
  try {
    await shell.trashItem(nativePath(entry))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new ServiceError('fs-failed', `Could not move to the Trash: ${message}`)
  }
  return null
}

async function revealEntry(service: WorkspaceService, path: string): Promise<null> {
  const entry = await service.resolveEntry(path)
  shell.showItemInFolder(nativePath(entry))
  return null
}

async function openExternalEntry(service: WorkspaceService, path: string): Promise<null> {
  const entry = await service.resolveEntry(path)
  const error = await shell.openPath(nativePath(entry))
  if (error.length > 0) {
    throw new ServiceError('fs-failed', `Could not open the file: ${error}`)
  }
  return null
}

async function openInCodeEntry(
  service: WorkspaceService,
  request: EditorOpenRequest
): Promise<{ ok: boolean }> {
  const entry = await service.resolveEntry(request.path)
  const { value } = await service.settingsGetEffective(['editor', 'command'])
  const command = typeof value === 'string' && value.trim().length > 0 ? value.trim() : 'code'
  return openInEditor(entry, request.line, command)
}

/** Launches the configured external merge tool on a conflicted file. */
async function openMergeToolEntry(
  service: WorkspaceService,
  request: GitOpenMergeToolRequest
): Promise<{ ok: boolean }> {
  const entry = await service.resolveEntry(request.path)
  const { value } = await service.settingsGetEffective(['merge', 'toolCommand'])
  const command = typeof value === 'string' ? value.trim() : ''
  if (command.length === 0) {
    throw new ServiceError(
      'merge-tool-missing',
      'No external merge tool is configured. Set merge.toolCommand in settings.'
    )
  }
  const ok = await launchShell(
    buildEditorCommand(command, entry, undefined, process.platform),
    dirname(entry)
  )
  if (!ok) throw new ServiceError('fs-failed', 'The merge tool command could not be started')
  return { ok }
}

declare const __APP_VERSION__: string

async function appInfo(service: WorkspaceService): Promise<AppInfo> {
  return {
    version: __APP_VERSION__,
    platform: process.platform,
    versions: {
      electron: process.versions.electron ?? '',
      chrome: process.versions.chrome ?? '',
      node: process.versions.node
    },
    gitVersion: await service.gitVersion()
  }
}

/** Opens the logs directory or the user-data directory in the OS file manager. */
async function openAppFolder(appPaths: IpcAppPaths, request: AppOpenFolderRequest): Promise<null> {
  const dir = request.kind === 'logs' ? join(appPaths.userDataDir, 'logs') : appPaths.userDataDir
  try {
    await mkdir(dir, { recursive: true })
  } catch {
    // the openPath error below reports a directory that cannot be reached
  }
  const error = await shell.openPath(nativePath(dir))
  if (error.length > 0) {
    throw new ServiceError('fs-failed', `Could not open the folder: ${error}`)
  }
  return null
}

function broadcast(channel: EventChannel, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue
    window.webContents.send(channel, payload)
  }
}

function toSettingsChangedEvent(change: SettingsChange): SettingsChangedEvent {
  if (change.value === undefined) {
    return { scope: change.scope, root: change.root, keyPath: [...change.keyPath], removed: true }
  }
  return {
    scope: change.scope,
    root: change.root,
    keyPath: [...change.keyPath],
    removed: false,
    value: change.value
  }
}

function toKeybindingsChangedEvent(change: KeybindingChange): KeybindingsChangedEvent {
  return change.keys === undefined
    ? { command: change.command, removed: true }
    : { command: change.command, keys: change.keys, removed: false }
}

function describeIssues(issues: readonly { path: PropertyKey[]; message: string }[]): string {
  return issues
    .map((issue) => {
      const path = issue.path.length === 0 ? '(request)' : issue.path.map(String).join('.')
      return `${path}: ${issue.message}`
    })
    .join('; ')
}

function toErrorInfo(error: unknown): IpcErrorInfo {
  if (error instanceof ServiceError) {
    return { code: error.code, message: error.message, details: error.details }
  }
  if (error instanceof Error) {
    console.error('[ipc] handler failed', error)
    return { code: 'internal', message: error.message }
  }
  console.error('[ipc] handler failed', error)
  return { code: 'internal', message: String(error) }
}

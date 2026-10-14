import type { CommandDefinition } from './registry'

export const COMMAND_IDS = {
  openFolder: 'workspace.openFolder',
  closeFolder: 'workspace.closeFolder',
  rescan: 'workspace.rescan',
  trust: 'workspace.trust',
  revokeTrust: 'workspace.revokeTrust',
  toggleSidebar: 'view.toggleSidebar',
  commandPalette: 'view.commandPalette',
  dismiss: 'view.dismiss',
  showExplorer: 'view.showExplorer',
  showRepos: 'view.showRepos',
  showScm: 'view.showScm',
  goToRepo: 'view.goToRepo',
  selectAllRepos: 'repos.selectAll',
  selectNoneRepos: 'repos.selectNone',
  stageSelected: 'scm.stageSelected',
  unstageSelected: 'scm.unstageSelected',
  discardSelected: 'scm.discardSelected',
  newFile: 'explorer.newFile',
  newFolder: 'explorer.newFolder',
  renameEntry: 'explorer.rename',
  deleteEntry: 'explorer.delete',
  revealEntry: 'explorer.reveal',
  copyPath: 'explorer.copyPath',
  openInEditor: 'explorer.openInEditor',
  saveFile: 'editor.save',
  closeTab: 'editor.closeTab',
  quickOpen: 'editor.quickOpen',
  cycleTheme: 'appearance.cycleTheme',
  toggleLocale: 'appearance.toggleLocale',
  checkoutBranch: 'git.checkoutBranch',
  createBranch: 'git.createBranch',
  openGraph: 'git.openGraph',
  mergeInto: 'git.mergeInto',
  rebaseCurrent: 'git.rebaseCurrent',
  fetchRepo: 'git.fetchRepo',
  fetchAll: 'git.fetchAll',
  pullRepo: 'git.pullRepo',
  pushBranch: 'git.pushBranch',
  manageRemotes: 'git.remotes',
  manageTags: 'git.tags',
  stashCreate: 'git.stashCreate',
  stashes: 'git.stashes',
  restoreBackup: 'git.restoreBackup',
  newWorktree: 'git.newWorktree',
  updateSubmodules: 'git.updateSubmodules',
  toggleOutput: 'view.toggleOutput'
} as const

/** Latest-value accessors: the commands read through this so they never go stale. */
export interface BuiltinContext {
  openFolder: () => void
  closeFolder: () => void
  rescan: () => void
  toggleSidebar: () => void
  showExplorer: () => void
  showRepos: () => void
  showScm: () => void
  goToRepo: () => void
  selectAllRepos: () => void
  selectNoneRepos: () => void
  cycleTheme: () => void
  toggleLocale: () => void
  trust: () => void
  revokeTrust: () => void
  togglePalette: () => void
  dismiss: () => void
  hasWorkspace: () => boolean
  isTrusted: () => boolean
  hasExplorerActions: () => boolean
  explorerHasCursor: () => boolean
  explorerNewFile: () => void
  explorerNewFolder: () => void
  explorerRename: () => void
  explorerDelete: () => void
  explorerReveal: () => void
  explorerCopyPath: () => void
  explorerOpenInEditor: () => void
  scmCanStage: () => boolean
  scmCanUnstage: () => boolean
  scmCanDiscard: () => boolean
  scmStageSelected: () => void
  scmUnstageSelected: () => void
  scmDiscardSelected: () => void
  editorCanSave: () => boolean
  editorSave: () => void
  editorHasTab: () => boolean
  editorCloseTab: () => void
  editorQuickOpen: () => void
  gitBranches: () => void
  gitCreateBranch: () => void
  gitOpenGraph: () => void
  gitMergeInto: () => void
  gitRebaseCurrent: () => void
  gitFetch: () => void
  gitFetchAll: () => void
  gitPull: () => void
  gitPush: () => void
  gitRemotes: () => void
  gitTags: () => void
  gitStashCreate: () => void
  gitStashes: () => void
  gitRestoreBackup: () => void
  gitNewWorktree: () => void
  gitUpdateSubmodules: () => void
  gitHasTarget: () => boolean
  gitHasRepos: () => boolean
  gitCanSync: () => boolean
  gitHasWorktree: () => boolean
  gitHasSubmodules: () => boolean
  gitHasGraph: () => boolean
  toggleOutput: () => void
}

export function createBuiltinCommands(get: () => BuiltinContext): CommandDefinition[] {
  return [
    {
      id: COMMAND_IDS.commandPalette,
      titleKey: 'commands.palette',
      categoryKey: 'commands.categories.view',
      hiddenInPalette: true,
      run: () => get().togglePalette()
    },
    {
      id: COMMAND_IDS.dismiss,
      titleKey: 'commands.dismiss',
      categoryKey: 'commands.categories.view',
      hiddenInPalette: true,
      run: () => get().dismiss()
    },
    {
      id: COMMAND_IDS.openFolder,
      titleKey: 'commands.openFolder',
      categoryKey: 'commands.categories.workspace',
      run: () => get().openFolder()
    },
    {
      id: COMMAND_IDS.closeFolder,
      titleKey: 'commands.closeFolder',
      categoryKey: 'commands.categories.workspace',
      enabled: () => get().hasWorkspace(),
      run: () => get().closeFolder()
    },
    {
      id: COMMAND_IDS.rescan,
      titleKey: 'commands.rescan',
      categoryKey: 'commands.categories.workspace',
      enabled: () => get().hasWorkspace(),
      run: () => get().rescan()
    },
    {
      id: COMMAND_IDS.toggleSidebar,
      titleKey: 'commands.toggleSidebar',
      categoryKey: 'commands.categories.view',
      enabled: () => get().hasWorkspace(),
      run: () => get().toggleSidebar()
    },
    {
      id: COMMAND_IDS.showExplorer,
      titleKey: 'commands.showExplorer',
      categoryKey: 'commands.categories.view',
      enabled: () => get().hasWorkspace(),
      run: () => get().showExplorer()
    },
    {
      id: COMMAND_IDS.showRepos,
      titleKey: 'commands.showRepos',
      categoryKey: 'commands.categories.view',
      enabled: () => get().hasWorkspace(),
      run: () => get().showRepos()
    },
    {
      id: COMMAND_IDS.showScm,
      titleKey: 'commands.showScm',
      categoryKey: 'commands.categories.view',
      enabled: () => get().hasWorkspace(),
      run: () => get().showScm()
    },
    {
      id: COMMAND_IDS.stageSelected,
      titleKey: 'commands.stageSelected',
      categoryKey: 'commands.categories.scm',
      enabled: () => get().scmCanStage(),
      run: () => get().scmStageSelected()
    },
    {
      id: COMMAND_IDS.unstageSelected,
      titleKey: 'commands.unstageSelected',
      categoryKey: 'commands.categories.scm',
      enabled: () => get().scmCanUnstage(),
      run: () => get().scmUnstageSelected()
    },
    {
      id: COMMAND_IDS.discardSelected,
      titleKey: 'commands.discardSelected',
      categoryKey: 'commands.categories.scm',
      enabled: () => get().scmCanDiscard(),
      run: () => get().scmDiscardSelected()
    },
    {
      id: COMMAND_IDS.goToRepo,
      titleKey: 'commands.goToRepo',
      categoryKey: 'commands.categories.view',
      enabled: () => get().hasWorkspace(),
      run: () => get().goToRepo()
    },
    {
      id: COMMAND_IDS.selectAllRepos,
      titleKey: 'commands.selectAllRepos',
      categoryKey: 'commands.categories.repos',
      enabled: () => get().hasWorkspace(),
      run: () => get().selectAllRepos()
    },
    {
      id: COMMAND_IDS.selectNoneRepos,
      titleKey: 'commands.selectNoneRepos',
      categoryKey: 'commands.categories.repos',
      enabled: () => get().hasWorkspace(),
      run: () => get().selectNoneRepos()
    },
    {
      id: COMMAND_IDS.newFile,
      titleKey: 'commands.newFile',
      categoryKey: 'commands.categories.explorer',
      enabled: () => get().hasExplorerActions(),
      run: () => get().explorerNewFile()
    },
    {
      id: COMMAND_IDS.newFolder,
      titleKey: 'commands.newFolder',
      categoryKey: 'commands.categories.explorer',
      enabled: () => get().hasExplorerActions(),
      run: () => get().explorerNewFolder()
    },
    {
      id: COMMAND_IDS.renameEntry,
      titleKey: 'commands.rename',
      categoryKey: 'commands.categories.explorer',
      enabled: () => get().hasExplorerActions() && get().explorerHasCursor(),
      run: () => get().explorerRename()
    },
    {
      id: COMMAND_IDS.deleteEntry,
      titleKey: 'commands.delete',
      categoryKey: 'commands.categories.explorer',
      enabled: () => get().hasExplorerActions() && get().explorerHasCursor(),
      run: () => get().explorerDelete()
    },
    {
      id: COMMAND_IDS.revealEntry,
      titleKey: 'commands.reveal',
      categoryKey: 'commands.categories.explorer',
      enabled: () => get().hasExplorerActions() && get().explorerHasCursor(),
      run: () => get().explorerReveal()
    },
    {
      id: COMMAND_IDS.copyPath,
      titleKey: 'commands.copyPath',
      categoryKey: 'commands.categories.explorer',
      enabled: () => get().hasExplorerActions() && get().explorerHasCursor(),
      run: () => get().explorerCopyPath()
    },
    {
      id: COMMAND_IDS.openInEditor,
      titleKey: 'commands.openInEditor',
      categoryKey: 'commands.categories.explorer',
      enabled: () => get().hasExplorerActions() && get().explorerHasCursor(),
      run: () => get().explorerOpenInEditor()
    },
    {
      id: COMMAND_IDS.saveFile,
      titleKey: 'commands.save',
      categoryKey: 'commands.categories.editor',
      enabled: () => get().editorCanSave(),
      run: () => get().editorSave()
    },
    {
      id: COMMAND_IDS.closeTab,
      titleKey: 'commands.closeTab',
      categoryKey: 'commands.categories.editor',
      enabled: () => get().editorHasTab(),
      run: () => get().editorCloseTab()
    },
    {
      id: COMMAND_IDS.quickOpen,
      titleKey: 'commands.quickOpen',
      categoryKey: 'commands.categories.editor',
      enabled: () => get().hasWorkspace(),
      run: () => get().editorQuickOpen()
    },
    {
      id: COMMAND_IDS.cycleTheme,
      titleKey: 'commands.cycleTheme',
      categoryKey: 'commands.categories.appearance',
      run: () => get().cycleTheme()
    },
    {
      id: COMMAND_IDS.toggleLocale,
      titleKey: 'commands.toggleLocale',
      categoryKey: 'commands.categories.appearance',
      run: () => get().toggleLocale()
    },
    {
      id: COMMAND_IDS.trust,
      titleKey: 'commands.trust',
      categoryKey: 'commands.categories.workspace',
      enabled: () => get().hasWorkspace() && !get().isTrusted(),
      run: () => get().trust()
    },
    {
      id: COMMAND_IDS.revokeTrust,
      titleKey: 'commands.revokeTrust',
      categoryKey: 'commands.categories.workspace',
      enabled: () => get().hasWorkspace() && get().isTrusted(),
      run: () => get().revokeTrust()
    },
    {
      id: COMMAND_IDS.checkoutBranch,
      titleKey: 'commands.checkoutBranch',
      categoryKey: 'commands.categories.git',
      enabled: () => get().gitHasTarget(),
      run: () => get().gitBranches()
    },
    {
      id: COMMAND_IDS.createBranch,
      titleKey: 'commands.createBranch',
      categoryKey: 'commands.categories.git',
      enabled: () => get().gitHasTarget(),
      run: () => get().gitCreateBranch()
    },
    {
      id: COMMAND_IDS.openGraph,
      titleKey: 'commands.openGraph',
      categoryKey: 'commands.categories.git',
      enabled: () => get().gitHasGraph(),
      run: () => get().gitOpenGraph()
    },
    {
      id: COMMAND_IDS.mergeInto,
      titleKey: 'commands.mergeInto',
      categoryKey: 'commands.categories.git',
      enabled: () => get().gitCanSync(),
      run: () => get().gitMergeInto()
    },
    {
      id: COMMAND_IDS.rebaseCurrent,
      titleKey: 'commands.rebaseCurrent',
      categoryKey: 'commands.categories.git',
      enabled: () => get().gitCanSync(),
      run: () => get().gitRebaseCurrent()
    },
    {
      id: COMMAND_IDS.fetchRepo,
      titleKey: 'commands.fetchRepo',
      categoryKey: 'commands.categories.git',
      enabled: () => get().gitHasRepos(),
      run: () => get().gitFetch()
    },
    {
      id: COMMAND_IDS.fetchAll,
      titleKey: 'commands.fetchAll',
      categoryKey: 'commands.categories.git',
      enabled: () => get().gitHasRepos(),
      run: () => get().gitFetchAll()
    },
    {
      id: COMMAND_IDS.pullRepo,
      titleKey: 'commands.pullRepo',
      categoryKey: 'commands.categories.git',
      enabled: () => get().gitCanSync(),
      run: () => get().gitPull()
    },
    {
      id: COMMAND_IDS.pushBranch,
      titleKey: 'commands.pushBranch',
      categoryKey: 'commands.categories.git',
      enabled: () => get().gitCanSync(),
      run: () => get().gitPush()
    },
    {
      id: COMMAND_IDS.manageRemotes,
      titleKey: 'commands.manageRemotes',
      categoryKey: 'commands.categories.git',
      enabled: () => get().gitHasTarget(),
      run: () => get().gitRemotes()
    },
    {
      id: COMMAND_IDS.manageTags,
      titleKey: 'commands.manageTags',
      categoryKey: 'commands.categories.git',
      enabled: () => get().gitHasTarget(),
      run: () => get().gitTags()
    },
    {
      id: COMMAND_IDS.stashCreate,
      titleKey: 'commands.stashCreate',
      categoryKey: 'commands.categories.git',
      enabled: () => get().gitHasWorktree(),
      run: () => get().gitStashCreate()
    },
    {
      id: COMMAND_IDS.stashes,
      titleKey: 'commands.stashes',
      categoryKey: 'commands.categories.git',
      enabled: () => get().gitHasWorktree(),
      run: () => get().gitStashes()
    },
    {
      id: COMMAND_IDS.restoreBackup,
      titleKey: 'commands.restoreBackup',
      categoryKey: 'commands.categories.git',
      enabled: () => get().gitHasTarget(),
      run: () => get().gitRestoreBackup()
    },
    {
      id: COMMAND_IDS.newWorktree,
      titleKey: 'commands.newWorktree',
      categoryKey: 'commands.categories.git',
      enabled: () => get().gitHasWorktree(),
      run: () => get().gitNewWorktree()
    },
    {
      id: COMMAND_IDS.updateSubmodules,
      titleKey: 'commands.updateSubmodules',
      categoryKey: 'commands.categories.git',
      enabled: () => get().gitHasSubmodules(),
      run: () => get().gitUpdateSubmodules()
    },
    {
      id: COMMAND_IDS.toggleOutput,
      titleKey: 'commands.toggleOutput',
      categoryKey: 'commands.categories.view',
      run: () => get().toggleOutput()
    }
  ]
}

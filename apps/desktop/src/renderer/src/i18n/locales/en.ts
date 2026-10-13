const en = {
  welcome: {
    tagline: 'Your multi-repository Git workbench',
    openFolder: 'Open folder…',
    dropHint: 'or drag a folder onto the window',
    recents: 'Recent workspaces',
    noRecents: 'No recent workspaces yet',
    removeFromList: 'Remove from list',
    opening: 'Opening…'
  },
  view: {
    explorer: 'Explorer',
    repos: 'Repos',
    scm: 'Source Control',
    options: 'View options'
  },
  activity: {
    tree: 'Explorer',
    scm: 'Source Control'
  },
  viewOptions: {
    badges: 'Badges',
    kindBadges: 'Repository kind',
    dirty: 'Uncommitted changes',
    sync: 'Ahead / behind counts',
    operation: 'Operation in progress',
    stash: 'Stash count',
    detached: 'Detached HEAD',
    showExternalWorktrees: 'Show external worktrees'
  },
  filters: {
    dirty: 'Only dirty',
    aheadBehind: 'Only ahead/behind',
    worktrees: 'Only worktrees'
  },
  repos: {
    empty: 'No repositories found',
    emptyHint: 'Adjust the workspace configuration or add repositories to this folder.',
    emptyFiltered: 'No repositories match the quick filters',
    includeInScm: 'Include in source control view',
    selectAll: 'Select all repositories',
    selectNone: 'Select no repositories'
  },
  explorer: {
    empty: 'This folder is empty',
    loadFailed: 'Could not read this folder',
    retry: 'Retry',
    errors: {
      invalidName: 'Enter a name without slashes'
    }
  },
  menu: {
    newFile: 'New File',
    newFolder: 'New Folder',
    openInEditor: 'Open in VS Code',
    reveal: 'Reveal in File Manager',
    revealInExplorer: 'Reveal in Explorer',
    copyPath: 'Copy Path',
    copyPaths: 'Copy Paths',
    rename: 'Rename',
    delete: 'Move to Trash'
  },
  dialogs: {
    cancel: 'Cancel',
    close: 'Close',
    create: 'Create',
    rename: 'Rename',
    nameLabel: 'Name',
    trashTitle: 'Move to trash?',
    trashBody: '“{{name}}” will be moved to the trash and can be restored from the file manager.'
  },
  tabs: {
    close: 'Close',
    closeOthers: 'Close Others',
    closeAll: 'Close All'
  },
  editor: {
    readOnlyBadge: 'Read-only',
    openInVscode: 'Open in VS Code',
    loading: 'Loading…',
    notFound: 'This file no longer exists.',
    binaryFile: 'This is a binary file ({{size}}) and cannot be shown as text.',
    openExternally: 'Open externally',
    tooLarge: 'This file is too large to open in the editor ({{size}}).',
    openReadOnly: 'Open anyway (read-only)',
    deletedOnDisk: 'This file was deleted on disk.',
    saveRecreate: 'Save (recreate file)',
    diskDiffTitle: 'Disk vs editor — {{name}}',
    diskVersion: 'On disk',
    editorVersion: 'In editor',
    conflictTitle: 'The file changed on disk',
    conflictBody: '“{{name}}” was changed on disk after you started editing. Choose which version to keep.',
    conflictOverwrite: 'Overwrite',
    conflictReload: 'Reload from Disk',
    conflictShowDiff: 'Show Diff',
    closePromptTitle: 'Save changes before closing?',
    closePromptOne: '“{{name}}” has unsaved changes.',
    closePromptMany: '{{count}} tabs have unsaved changes.',
    closePromptSave: 'Save',
    closePromptDiscard: 'Don’t Save'
  },
  diff: {
    loading: 'Loading diff…',
    sideBySide: 'Side by Side',
    inline: 'Inline',
    ignoreWhitespace: 'Ignore Whitespace',
    history: 'History',
    historyTitle: 'Commits touching this file',
    compareWith: 'Compare with…',
    copyPatch: 'Copy as Patch',
    patchCopied: 'Patch copied',
    outdated: 'The diff is out of date.',
    reload: 'Reload',
    binary: 'Binary file changed ({{old}} → {{new}}).',
    tooLarge: 'This diff is too large to render ({{old}} → {{new}}).',
    loadFull: 'Load Full Diff',
    missingSide: 'Not present on this side',
    noHistory: 'No commits touch this file yet',
    showMore: 'Show older commits…',
    hunk: {
      stage: 'Stage Hunk',
      unstage: 'Unstage Hunk',
      revert: 'Revert Hunk',
      copyPatch: 'Copy Hunk as Patch'
    }
  },
  quickPick: {
    placeholder: 'Go to repository…',
    noResults: 'No matching repositories'
  },
  quickOpen: {
    placeholder: 'Go to file…',
    loading: 'Loading files…',
    noResults: 'No matching files',
    truncated: 'File list was truncated; narrow the query to reach the rest.'
  },
  notify: {
    copyDetails: 'Copy details',
    dismiss: 'Dismiss',
    movedToTrash: 'Moved to trash: {{name}}'
  },
  overview: {
    title: 'Workspace',
    folder: 'Folder',
    repositories: 'Repositories',
    worktrees: 'Worktrees',
    submodules: 'With submodules',
    foldersScanned: 'Folders scanned'
  },
  scm: {
    groups: {
      conflicts: 'Merge Conflicts',
      staged: 'Staged Changes',
      unstaged: 'Changes',
      untracked: 'Untracked Files'
    },
    operation: {
      merge: 'Merging',
      rebase: 'Rebasing',
      'rebase-interactive': 'Rebasing (interactive)',
      'cherry-pick': 'Cherry-picking',
      revert: 'Reverting',
      bisect: 'Bisecting'
    },
    stage: 'Stage Changes',
    unstage: 'Unstage Changes',
    resolve: 'Mark as Resolved',
    discard: 'Discard Changes',
    ignore: 'Add to .gitignore',
    ignored: 'Added {{pattern}} to .gitignore',
    stageAll: 'Stage All Changes',
    unstageAll: 'Unstage All Changes',
    onlySelected: 'Only selected',
    onlySelectedTitle: 'Show changes only from selected repositories',
    showMore: 'Show {{count}} more…',
    empty: 'No pending changes',
    discardTitle: 'Discard changes?',
    discardBodyOne: 'Changes to “{{name}}” will be lost. This cannot be undone.',
    discardBodyMany: 'Changes to {{count}} files will be lost. This cannot be undone.'
  },
  commit: {
    messagePlaceholder: 'Commit message (Ctrl+Enter to commit)',
    action: 'Commit',
    amendAction: 'Amend',
    menu: 'More commit actions',
    menuCommit: 'Commit',
    stageAllCommit: 'Stage All & Commit',
    amendKeep: 'Amend · Keep Message',
    amendEdit: 'Amend · Edit Message',
    amendInclude: 'Amend · Include Working Tree',
    amending: 'Amending {{sha}}',
    cancelAmend: 'Cancel amend',
    signOff: 'Signed-off-by',
    signOffTitle: 'Append a Signed-off-by trailer to the commit message',
    hooksDisabled: 'Git hooks are disabled in this workspace',
    hooksDisabledTitle:
      'This workspace is not trusted, so Git hooks do not run. Trust the workspace to run them.',
    conflictHint: 'Resolve the conflicts before committing.',
    operationHint: '{{operation}} in progress — continue or abort it from the operation banner.',
    nothingStaged: 'No staged changes. Stage them first, or use “Stage All & Commit”.',
    done: 'Committed {{sha}}',
    outputTitle: 'Git output',
    amendPushedTitle: 'Amend a pushed commit?',
    amendPushedBody:
      'This commit is already on the remote. Amending replaces it, and pushing later will rewrite the remote history (force push). Others working on this branch may be affected.',
    amendPushedConfirm: 'Amend Anyway'
  },
  statusbar: {
    opening: 'Opening…',
    refreshing: 'Refreshing…',
    gitMissing: 'Git not found',
    gitOutdated: 'An older Git version is in use',
    degraded: 'Live updates are paused in some folders',
    theme: 'Theme: {{theme}}',
    themeSystem: 'System',
    themeLight: 'Light',
    themeDark: 'Dark',
    language: 'Language: {{language}}'
  },
  notices: {
    untrusted:
      'This workspace is in restricted mode: Git hooks and workspace terminal commands are disabled.',
    trust: 'Trust this workspace',
    budget:
      'Scanning stopped early to stay within the safety budget. Rescan with a larger budget to include everything.',
    raise: 'Raise limit and rescan',
    depth: 'Some folders were skipped at the depth limit. Raise the scan depth in workspace.json to look deeper.',
    degraded: 'Live updates are paused for {{dir}}.',
    issues: 'Scan issues'
  },
  trust: {
    title: 'Do you trust the authors of this workspace?',
    body: 'Git hooks and workspace terminal commands run code from this workspace. Trust it only if you know where it comes from. You can change this later.',
    accept: 'Trust this workspace',
    decline: 'Continue without trust'
  },
  palette: {
    placeholder: 'Type a command…',
    noResults: 'No matching commands'
  },
  commands: {
    openFolder: 'Open Folder…',
    closeFolder: 'Close Folder',
    rescan: 'Refresh Workspace',
    toggleSidebar: 'Toggle Tree Sidebar',
    showExplorer: 'Show Explorer',
    showRepos: 'Show Repositories',
    showScm: 'Show Source Control',
    stageSelected: 'Stage Selected Changes',
    unstageSelected: 'Unstage Selected Changes',
    discardSelected: 'Discard Selected Changes',
    goToRepo: 'Go to Repository…',
    selectAllRepos: 'Select All Repositories',
    selectNoneRepos: 'Select No Repositories',
    newFile: 'New File',
    newFolder: 'New Folder',
    rename: 'Rename',
    delete: 'Move to Trash',
    reveal: 'Reveal in File Manager',
    copyPath: 'Copy Path',
    openInEditor: 'Open in VS Code',
    cycleTheme: 'Change Theme',
    toggleLocale: 'Switch Language',
    trust: 'Trust This Workspace',
    revokeTrust: 'Revoke Trust',
    palette: 'Show All Commands',
    dismiss: 'Dismiss',
    save: 'Save File',
    closeTab: 'Close Editor Tab',
    quickOpen: 'Go to File…',
    categories: {
      workspace: 'Workspace',
      view: 'View',
      explorer: 'Explorer',
      repos: 'Repositories',
      scm: 'Source Control',
      appearance: 'Appearance',
      editor: 'Editor'
    }
  },
  badges: {
    dirty: 'Uncommitted changes',
    ahead: 'Ahead of upstream',
    behind: 'Behind upstream',
    stash: 'Stashes',
    operation: 'Operation in progress',
    detached: 'Detached HEAD',
    unborn: 'Unborn branch',
    worktree: 'Worktree',
    bare: 'Bare repository',
    submodule: 'Submodule',
    main: 'Main checkout',
    external: 'Outside the workspace'
  }
} as const

/** Shape of a translation tree: same keys as the source locale, free strings. */
type ResourceShape<T> = { [K in keyof T]: T[K] extends string ? string : ResourceShape<T[K]> }

export type TranslationResource = ResourceShape<typeof en>
export const enResource = en

import type { TranslationResource } from './en'

export const zhHansResource: TranslationResource = {
  welcome: {
    tagline: '多仓库 Git 工作台',
    openFolder: '打开文件夹…',
    dropHint: '或将文件夹拖入窗口',
    recents: '最近的工作区',
    noRecents: '暂无最近的工作区',
    removeFromList: '从列表中移除',
    opening: '正在打开…'
  },
  view: {
    explorer: '资源管理器',
    repos: '仓库',
    scm: '源代码管理',
    options: '视图选项'
  },
  activity: {
    tree: '资源管理器',
    scm: '源代码管理'
  },
  viewOptions: {
    badges: '徽标',
    kindBadges: '仓库类型',
    dirty: '未提交更改',
    sync: '领先/落后计数',
    operation: '操作进行中',
    stash: '贮藏计数',
    detached: '游离 HEAD',
    showExternalWorktrees: '显示外部工作树'
  },
  filters: {
    dirty: '仅未提交',
    aheadBehind: '仅领先/落后',
    worktrees: '仅工作树'
  },
  repos: {
    empty: '未找到仓库',
    emptyHint: '可调整工作区配置，或向该文件夹中添加仓库。',
    emptyFiltered: '没有仓库符合快速筛选条件',
    includeInScm: '纳入源代码管理视图',
    selectAll: '全选所有仓库',
    selectNone: '全不选'
  },
  explorer: {
    empty: '此文件夹为空',
    loadFailed: '无法读取此文件夹',
    retry: '重试',
    errors: {
      invalidName: '名称不能包含斜杠'
    }
  },
  menu: {
    newFile: '新建文件',
    newFolder: '新建文件夹',
    openInEditor: '在 VS Code 中打开',
    reveal: '在文件管理器中显示',
    revealInExplorer: '在资源管理器中显示',
    copyPath: '复制路径',
    copyPaths: '复制多个路径',
    rename: '重命名',
    delete: '移到回收站'
  },
  dialogs: {
    cancel: '取消',
    close: '关闭',
    create: '创建',
    rename: '重命名',
    nameLabel: '名称',
    trashTitle: '移到回收站？',
    trashBody: '“{{name}}” 将被移到回收站，可从文件管理器中还原。'
  },
  tabs: {
    close: '关闭',
    closeOthers: '关闭其他标签页',
    closeAll: '关闭全部标签页'
  },
  editor: {
    readOnlyBadge: '只读',
    openInVscode: '在 VS Code 中打开',
    loading: '正在加载…',
    notFound: '该文件已不存在。',
    binaryFile: '这是二进制文件（{{size}}），无法以文本方式显示。',
    openExternally: '用外部程序打开',
    tooLarge: '文件过大，无法在编辑器中打开（{{size}}）。',
    openReadOnly: '仍然打开（只读）',
    deletedOnDisk: '该文件已在磁盘上被删除。',
    saveRecreate: '保存（重新创建文件）',
    diskDiffTitle: '磁盘与编辑器 — {{name}}',
    diskVersion: '磁盘上的版本',
    editorVersion: '编辑器中的版本',
    conflictTitle: '文件已在磁盘上更改',
    conflictBody: '“{{name}}” 在你编辑期间被磁盘上的更改覆盖。请选择保留哪个版本。',
    conflictOverwrite: '覆盖磁盘文件',
    conflictReload: '从磁盘重新加载',
    conflictShowDiff: '显示差异',
    closePromptTitle: '关闭前保存更改？',
    closePromptOne: '“{{name}}” 有未保存的更改。',
    closePromptMany: '{{count}} 个标签页有未保存的更改。',
    closePromptSave: '保存',
    closePromptDiscard: '不保存'
  },
  diff: {
    loading: '正在加载差异…',
    sideBySide: '并排对比',
    inline: '行内对比',
    ignoreWhitespace: '忽略空白',
    history: '历史',
    historyTitle: '修改过此文件的提交',
    compareWith: '对比目标…',
    copyPatch: '复制为补丁',
    patchCopied: '补丁已复制',
    outdated: '差异已过期。',
    reload: '重新加载',
    binary: '二进制文件已更改（{{old}} → {{new}}）。',
    tooLarge: '差异过大，无法渲染（{{old}} → {{new}}）。',
    loadFull: '加载完整差异',
    missingSide: '此侧不存在',
    noHistory: '尚无提交修改过此文件',
    showMore: '显示更早的提交…',
    hunk: {
      stage: '暂存此片段',
      unstage: '取消暂存此片段',
      revert: '还原此片段',
      copyPatch: '复制片段为补丁'
    }
  },
  quickPick: {
    placeholder: '跳转到仓库…',
    noResults: '没有匹配的仓库'
  },
  quickOpen: {
    placeholder: '转到文件…',
    loading: '正在加载文件…',
    noResults: '没有匹配的文件',
    truncated: '文件列表已被截断，可用更精确的筛选查看其余文件。'
  },
  notify: {
    copyDetails: '复制详情',
    dismiss: '关闭',
    movedToTrash: '已移到回收站：{{name}}'
  },
  overview: {
    title: '工作区',
    folder: '文件夹',
    repositories: '仓库',
    worktrees: '工作树',
    submodules: '含子模块',
    foldersScanned: '已扫描文件夹'
  },
  scm: {
    groups: {
      conflicts: '合并冲突',
      staged: '已暂存的更改',
      unstaged: '更改',
      untracked: '未跟踪的文件'
    },
    operation: {
      merge: '正在合并',
      rebase: '正在变基',
      'rebase-interactive': '正在交互式变基',
      'cherry-pick': '正在拣选',
      revert: '正在还原',
      bisect: '正在二分查找'
    },
    stage: '暂存更改',
    unstage: '取消暂存更改',
    resolve: '标记为已解决',
    discard: '丢弃更改',
    ignore: '添加到 .gitignore',
    ignored: '已将 {{pattern}} 添加到 .gitignore',
    stageAll: '暂存全部更改',
    unstageAll: '取消暂存全部更改',
    onlySelected: '仅已选中',
    onlySelectedTitle: '仅显示已选中仓库的更改',
    showMore: '再显示 {{count}} 项…',
    empty: '没有待处理的更改',
    discardTitle: '丢弃更改？',
    discardBodyOne: '对“{{name}}”的更改将丢失，此操作无法撤销。',
    discardBodyMany: '{{count}} 个文件的更改将丢失，此操作无法撤销。'
  },
  commit: {
    messagePlaceholder: '提交信息（Ctrl+Enter 提交）',
    action: '提交',
    amendAction: '修订提交',
    menu: '更多提交操作',
    menuCommit: '提交',
    stageAllCommit: '暂存全部并提交',
    amendKeep: '修订 · 保留原提交信息',
    amendEdit: '修订 · 编辑提交信息',
    amendInclude: '修订 · 包含工作区中的更改',
    amending: '正在修订 {{sha}}',
    cancelAmend: '取消修订',
    signOff: '签署',
    signOffTitle: '在提交信息末尾添加 Signed-off-by 行',
    hooksDisabled: '此工作区未启用 Git 钩子',
    hooksDisabledTitle: '工作区未受信任，因此不会运行 Git 钩子。信任此工作区后即可运行。',
    conflictHint: '请先解决冲突再提交。',
    operationHint: '{{operation}}，请通过操作横幅继续或中止。',
    nothingStaged: '没有已暂存的更改。请先暂存，或使用“暂存全部并提交”。',
    done: '已提交 {{sha}}',
    outputTitle: 'Git 输出',
    amendPushedTitle: '要修订已推送的提交吗？',
    amendPushedBody:
      '该提交已在远端。修订会替换它，之后推送将改写远端历史（强制推送），可能影响其他使用该分支的人。',
    amendPushedConfirm: '仍要修订'
  },
  statusbar: {
    opening: '正在打开…',
    refreshing: '正在刷新…',
    gitMissing: '未找到 Git',
    gitOutdated: '当前 Git 版本较旧',
    degraded: '部分文件夹的实时更新已暂停',
    theme: '主题：{{theme}}',
    themeSystem: '跟随系统',
    themeLight: '浅色',
    themeDark: '深色',
    language: '语言：{{language}}'
  },
  notices: {
    untrusted: '当前工作区处于受限模式：Git 钩子与工作区终端命令已禁用。',
    trust: '信任此工作区',
    budget: '扫描在到达安全上限前提前停止。提高上限并重新扫描可覆盖全部内容。',
    raise: '提高上限并重新扫描',
    depth: '部分文件夹因深度限制被跳过。可在 workspace.json 中增大扫描深度。',
    degraded: '{{dir}} 的实时更新已暂停。',
    issues: '扫描问题'
  },
  trust: {
    title: '是否信任此工作区的作者？',
    body: 'Git 钩子与工作区终端命令会执行该工作区中的代码。仅在你了解其来源时信任。之后可随时更改。',
    accept: '信任此工作区',
    decline: '不信任，继续打开'
  },
  palette: {
    placeholder: '输入命令…',
    noResults: '没有匹配的命令'
  },
  commands: {
    openFolder: '打开文件夹…',
    closeFolder: '关闭文件夹',
    rescan: '刷新工作区',
    toggleSidebar: '切换目录树侧栏',
    showExplorer: '显示资源管理器',
    showRepos: '显示仓库视图',
    showScm: '显示源代码管理',
    stageSelected: '暂存选中的更改',
    unstageSelected: '取消暂存选中的更改',
    discardSelected: '丢弃选中的更改',
    goToRepo: '跳转到仓库…',
    selectAllRepos: '全选所有仓库',
    selectNoneRepos: '全不选',
    newFile: '新建文件',
    newFolder: '新建文件夹',
    rename: '重命名',
    delete: '移到回收站',
    reveal: '在文件管理器中显示',
    copyPath: '复制路径',
    openInEditor: '在 VS Code 中打开',
    cycleTheme: '切换主题',
    toggleLocale: '切换语言',
    trust: '信任此工作区',
    revokeTrust: '撤销信任',
    palette: '显示所有命令',
    dismiss: '关闭',
    save: '保存文件',
    closeTab: '关闭编辑器标签页',
    quickOpen: '转到文件…',
    categories: {
      workspace: '工作区',
      view: '视图',
      explorer: '资源管理器',
      repos: '仓库',
      scm: '源代码管理',
      appearance: '外观',
      editor: '编辑器'
    }
  },
  badges: {
    dirty: '有未提交的更改',
    ahead: '领先上游',
    behind: '落后上游',
    stash: '贮藏',
    operation: '操作进行中',
    detached: '游离 HEAD',
    unborn: '尚无提交的分支',
    worktree: '工作树',
    bare: '裸仓库',
    submodule: '子模块',
    main: '主检出',
    external: '位于工作区之外'
  }
}

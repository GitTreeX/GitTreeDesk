# GitTreeDesk — 规格说明书

> 状态：**草案 v0.1** · 2026-10-13
> 本文档以英文版 `spec.md` 为准，本文件为同步翻译；两者冲突时以英文版为准。

## 概述

### 问题背景

在包含几十到上百个仓库的大文件夹中做 Git 相关工作，目前被割裂在多个工具里，每个只覆盖一部分：

- **VSCode** 为*单仓库*优化。打开一个含 50+ 仓库的文件夹时，它会触发全工作区文件监听、逐仓库的 SCM provider、以及对所有"看起来像项目"的目录做 TypeScript 工程解析——"完整体验"本身就正是它卡的原因。
- **Git GUI**（SourceTree、Fork、GitKraken）单仓库操作体验好，但没有工作区优先的浏览、没有覆盖整个文件夹的文件树、没有内置编辑器，对散落在兄弟目录里的 worktree 支持也很弱。

GitTreeDesk 把这些有用的部分合进一个工具，并且把**工作区**——而不是仓库——作为工作单元。

### 产品定位

**GitTreeDesk 是工作区优先的多仓库 Git 工作台，不是通用 IDE。**

三条原则主导设计取舍：

1. **工作区优先。** 用户打开的文件夹就是一个工作区，它本身不必是 Git 仓库，里面可以是任意混合：任意深度嵌套的 Git 仓库、链接 worktree、submodule、普通文件夹。
2. **默认懒加载 + 增量。** 不需要就不扫描、不监听、不解析、不渲染；已知信息只做增量刷新，绝不从头重算。
3. **键盘优先、克制的 UI。** 每个操作都能从命令面板和快捷键触达；动画绝不能拖慢输入、焦点切换或键盘流。

### 范围

**目标（v1）：**

- 打开任意文件夹作为工作区；发现其中所有仓库、worktree、submodule；以带实时状态的树呈现
- 多仓库变更总览；由用户勾选展示哪些仓库、哪些变更类型
- Worktree 一等公民：自动识别、归组到主仓库下、支持从 UI 创建与删除
- 完整的 Git 操作流，对标 SourceTree：stage、commit、stash、branch、merge、rebase（含交互式）、cherry-pick、revert、reset、tag、remote、fetch/pull/push、submodule 更新、worktree 增删、提交元信息改写，都带安全网
- 原生提交图（Git Graph 等价物），逐仓库展示，可在提交上直接操作
- 代码查看与轻编辑：语法高亮、尽力而为的 TypeScript 提示、一键"在 VSCode 中打开"逃生口
- 变更列表与 diff：已暂存/未暂存/未跟踪/冲突，文本与图片 diff，hunk 级暂存
- 集成终端：多 Shell 配置、按目录级联配置、快捷命令
- 一键根据暂存区生成 commit message（离线启发式 + 可选 LLM）
- 现代化、可切换主题的 UI；深色模式一等公民（跟随系统或手动）；键盘友好
- 跨平台：Windows、macOS、Linux
- 英文优先，i18n 架构从第一天起就位

**非目标（v1）：**

- 扩展/插件平台、应用市场。
- 完整语言服务（工程级 TS/重构）。由"在 VSCode 中打开"逃生口覆盖。
- 托管平台集成（PR、issue、CI 状态）。*后续。*
- 远程开发、云同步、账号体系、遥测。
- VSCode 级的三方合并编辑器。v1 的冲突处理：ours/theirs 选择 + 带标记的编辑器打开 + 外部合并工具。
- 运行构建/测试/任务、调试器、问题面板。

### 参考场景（验收场景）

以一个代表性的工作区作为验收标的（示例已脱敏）：`acme/` —— 约 55 个 Git 仓库，分布在 2~3 层分组下（`app/`、`backend/`、`website/`……），链接 worktree 集中放在兄弟目录 `__worktree__/`（如 `mobile-app_worktree-feat-dark-mode`），混有非 Git 文件夹，根目录有噪声目录 `node_modules/`，并且至少有一个中文命名目录（`content/中文文档`）。

v1 验收标准：

- 打开该工作区后在性能预算内呈现完整树，并流式补充仓库状态，界面全程不被阻塞。
- 树中的每个仓库都可完整操作（全部 Git 操作）。
- `__worktree__` 中的条目归组显示在其主仓库下，而不是当作互不相关的文件夹。
- 中文目录名与仓库内的中文路径都能正确显示和操作。

### 术语表

| 术语 | 含义 |
|---|---|
| **Workspace（工作区）** | 用户打开的根文件夹，不要求是 Git 仓库。 |
| **Repository（仓库）** | 在工作区内发现 `.git`（目录或 gitdir 指针文件）的 Git 仓库。 |
| **Main worktree（主工作树）** | 仓库最初创建时所在的工作树。 |
| **Linked worktree（链接工作树）** | 通过 `git worktree add` 创建的附加工作树，可能位于工作区根之外。 |
| **Submodule（子模块）** | 通过 `.gitmodules` 注册的仓库，可能尚未初始化。 |
| **Git dir / common dir** | 链接 worktree 的 per-worktree git dir 与共享的 common dir 不同。仓库身份以 common dir 为准。 |
| **Group（分组）** | Repos 视图中的虚拟文件夹；可显式配置或取自首层路径段。 |
| **Badge（徽标）** | 仓库行旁的状态指示（dirty、ahead/behind、stash、进行中操作……）。 |
| **Operation state（操作态）** | 由 git dir 状态文件（`MERGE_HEAD`、`rebase-merge/`、`CHERRY_PICK_HEAD` 等）检测到的进行中 Git 操作。 |

---

## 关键决策（ADR）

决策条目及被否决的备选方案。v1 内生效；若要变更，需更新受影响的章节。

| 决策 | 理由 | 被否决的方案 |
|------|------|--------------|
| **自研 Electron 应用**（当前稳定版 Electron；主版本在 `package.json` 中锁定并按计划升级）。 | VSCode 的卡顿是架构性的（全工作区 watcher、逐仓库 SCM provider、TS 工程图）。自研外壳可以从一开始就按多仓库场景设计发现、监听与状态刷新。 | **Fork code-oss**：百万行级 fork，上游合并负担重，性能问题是架构性的、fork 内修不掉，且约 80% 代码与本产品无关。**VSCode 扩展**：治不了 watcher/扫描的根因，最多做交互验证。 |
| **Git 引擎 = 系统 `git` CLI**，以参数数组方式 spawn；解析 porcelain 输出。 | 正确性：worktree、submodule、LFS（filter）、credential helper、hooks 及边界行为与命令行 100% 一致——与 VSCode、SourceTree、Fork 同路线。性能靠并发池、index 指纹跳过与缓存。 | **isomorphic-git**：截至 2026-10 其命令索引缺 rebase、cherry-pick、worktree、submodule、hooks、LFS——直接否决 worktree 与 Git 操作需求；大仓库也慢。**libgit2 绑定**（nodegit/koffi）：worktree/submodule/filter 支持有缺口，hooks 不执行，各平台原生打包麻烦。**混合**（原生读 + CLI 写）：两套引擎，一致性成本翻倍；仅在实测证明必要时再评估。 |
| **git 可执行文件策略**：优先系统 Git（PATH 上的 `git`，设置中可覆盖）。要求 ≥ 2.23，低于 2.36 给出警告。启动时用 `git --version` 探测。Windows 额外探测 `%ProgramFiles%\Git\cmd\git.exe`。内置便携版 Git 属待定问题。 | Git GUI 用户本来就有 Git；内置便携版会带来几十 MB 体积与更新负担。版本下限覆盖 `git switch/restore`（2.23）与稳定的 porcelain 行为。 | 内置 Git for Windows / 自行发行 —— 后续再说，仅在真实用户撞到"没装 Git"时考虑。 |
| **渲染层技术栈**：React 19 + TypeScript、Vite、Tailwind CSS v4、Radix UI 原语（shadcn 模式、组件内置仓库）、Zustand 状态管理、TanStack Virtual 虚拟化、Lucide 图标。 | 热更新友好；Zustand 适合高频状态补丁；Radix 提供无障碍原语且不引入重型组件库。 | Ant Design / MUI：主题定制成本高、视觉语言显旧，与 UI 目标冲突。 |
| **编辑器 = Monaco**，本地打包（禁用 CDN loader——必须完全离线可用）。v1 的 TypeScript 提示使用 Monaco 内置 TS worker；tsserver/LSP 桥接属*后续*。`monaco-languageclient` 明确不是 v1 依赖。 | Monaco 是 VSCode 的编辑器内核：100+ 语言高亮、diff 编辑器、worker 中的 TS 语言服务。工程级 LSP 本身是大型子项目；v1 由"在 VSCode 中打开"按钮覆盖重度用户需求。 | CodeMirror 6：更轻但 TS 与 diff 能力弱。 |
| **终端 = node-pty + @xterm/xterm**，pty host 运行在 Electron `utilityProcess`（pty host 崩溃不得拖垮应用），数据经 `MessagePort` 流入渲染进程。 | 成熟组合（VSCode 终端栈同思路）。utilityProcess 隔离与 VSCode 的 pty host 同理。 | pty 跑在主进程：原生崩溃会杀掉窗口。 |
| **持久化拆分**：用户编写的配置存为 **JSON 文件**（可移植、可 diff、可提交）；**SQLite（better-sqlite3）只存可丢弃的缓存/索引**——删除它绝不可以丢用户数据。 | 用户可以检查/版本化自己的配置；缓存随时可重建。避免"把用户设置藏进二进制 DB"的经典错误。 | 全部塞 SQLite：配置不透明，不利于同步与手改。 |
| **监听策略**：不对整个工作区做递归监听。只监听：(a) 每个仓库的 git dir（限深），(b) 文件树中已展开的目录（LRU 上限），(c) 工作区根目录浅层（深度 2）用于发现新仓库。间隔轮询仅作兜底（默认 60 秒，可配置；watcher 健康时逐仓库关闭）。 | 工作区可能有几十万个目录；按仓库监听 git dir，成本只与仓库数相关，与工作区规模无关。这是让自研外壳兑现的核心性能决策。 | 全工作区递归监听（chokidar/@parcel/watcher 盖住根目录）：正是本产品要避免的 VSCode 失效模式。 |
| **提交信息生成**：先离线启发式流水线（仓库约定探测 + 暂存 diff 分析 → 可编辑草稿）；可选 LLM Provider（OpenAI 兼容端点）显式开启，密钥存 OS 钥匙串（`safeStorage`）。草稿始终可编辑；永不自动 commit。 | 零配置、零网络即可用；LLM 质量是增强而非依赖。隐私：只有用户主动开启时 diff 才离开本机。 | 纯 LLM：强依赖网络与密钥，离线体验差。纯模板：价值太低。 |
| **i18n**：`react-i18next`，英文原文即文案（keys-as-text），按命名空间拆分 locale JSON，日期/数字用 `Intl`。v1 内置 `en` + `zh-Hans`；新增语言是纯配置。任何用户可见字符串不得硬编码（lint 规则强制）。 | README 已定英文优先；架构必须让翻译是机械工作而非重构。 | 推迟 i18n：日后必然重写。 |
| **仓库身份 = git common dir 的 realpath。** 所有视图（Explorer、Repos、SCM、Graph）都以该 id 为主键，因此主工作树与其全部链接 worktree 是同一实体、对应多个工作树。 | worktree 归组可由身份定义自然导出，无任何按名字的启发式。 | 按路径定义身份：worktree 会被误当成互不相关的仓库。 |
| **破坏性操作的安全网。** 在 reset --hard、rebase、交互式 rebase、历史改写、stash drop、branch 删除、worktree 删除之前：创建 `refs/gitreedesk/backup/<op>/<yyyymmdd-hhmmss>` 指向当前 HEAD（或目标 ref），并记录操作日志（日志存 SQLite，backup ref 存仓库内）。每个受影响的 UI 操作提供**会话内及其后的撤销/回滚**。 | 历史改写是最危险的一类功能；没有撤销路径的 Git 工作台就是陷阱。backup ref 对常规工作流不可见（`refs/gitreedesk/*` 默认不出现在 ref 列表），成本极低。 | 不备份：不可接受。完整的 reflog UI：后续再细化。 |
| **不受信工作区门禁**：工作区首次打开时为*不受信*。不受信工作区不执行任何工作区配置的命令（快捷命令禁用），并借助 `-c core.hooksPath=<空目录>` 抑制 Git hooks；用户可授予信任，信任状态按工作区根记录在 SQLite。 | 打开陌生人的文件夹不能执行其 `post-checkout` hook 或终端命令。 | 一律信任：一类众所周知的漏洞。 |

---

## 架构

### 进程模型与包结构

```
┌─────────────────────────── Electron 应用 ──────────────────────────┐
│ 主进程                                                              │
│   WindowManager · 菜单/快捷键 · Updater · SettingsService           │
│   WorkspaceService（发现、注册表、状态调度）                          │
│   GitService（spawn 并发池、porcelain 解析、操作模型、备份）           │
│   WatcherService（@parcel/watcher；逐仓库 git dir + 已展开目录）      │
│   CommitMessageService（启发式 + LLM Provider）                     │
│   TrustStore · CacheDB（better-sqlite3，可丢弃）                     │
├─────────────────────────────────────────────────────────────────────┤
│ utilityProcess：PTY HOST（node-pty 会话，渲染层刷新后仍存活；         │
│   每个终端一条 MessagePort 通道）                                    │
├─────────────────────────────────────────────────────────────────────┤
│ Preload：contextBridge → 类型化 `window.gtd` API（zod 校验）         │
├─────────────────────────────────────────────────────────────────────┤
│ 渲染进程（React，沙箱，无 Node）：仅 UI                              │
│   Zustand stores（工作区/仓库状态/操作/终端/设置）                    │
│   Monaco（文件、diff）· 提交图（canvas + DOM 行）                     │
└─────────────────────────────────────────────────────────────────────┘
```

pnpm workspace 布局（`apps/*` + `packages/*`，版本由 catalog 统一管理）：

```
GitTreeDesk/
├── apps/
│   └── desktop/
│       ├── src/main/            # Electron 主进程：服务装配、IPC handler、菜单、信任、更新
│       ├── src/pty-host/        # node-pty 的 utilityProcess 入口
│       ├── src/preload/         # contextBridge API 面
│       ├── src/renderer/        # React 应用（Vite）
│       └── electron-builder.yml
├── packages/
│   ├── shared/                  # 跨进程类型、IPC 契约、zod schema、i18n key 类型
│   ├── git-core/                # git runner、porcelain 解析、操作模型、backup ref（纯 Node，不 import Electron；对真实临时仓库做单测）
│   ├── workspace-core/          # 发现、仓库注册表、状态调度、监听计划
│   ├── terminal-core/           # Shell 探测、级联配置解析、快捷命令
│   ├── commit-msg/              # 约定探测、离线草稿、LLM Provider
│   └── ui/                      # 共享 React 组件、设计 token、徽标集
├── docs/
└── scripts/                     # 开发编排、打包、fixture 工作区生成器
```

规则：`git-core`、`workspace-core`、`terminal-core`、`commit-msg` 不得 import Electron；主进程可 import 全部；渲染层只 import `shared` 与 `ui`。

### 仓库发现与身份

*范围：v1。*

算法（跑在主进程，分块执行以便 UI 流式上屏）：

1. 从工作区根做 BFS。在包含 `.git/`（目录）或 `.git`（文件 → 链接 worktree 或 submodule 指针）的目录剪枝，绝不下钻 `.git`。
2. 默认跳过：`node_modules`、`.git`、`.svn`、`.hg` 及 `.DS_Store` 类噪声；跳过规则 = 内置默认 ∪ 工作区配置 excludes。除非 `scan.followSymlinks = true`，否则不跟随符号链接。
3. 预算：默认 `scan.maxDepth = 8`、`scan.maxEntries = 200000` 个目录；超预算即停止发现并提示，可调高后继续。
4. 确认轮：候选目录在 git 工作池中逐个以 `git rev-parse --git-dir --show-toplevel --is-bare-repository --git-common-dir` 确认，结果写入注册表。
5. worktree 关联：对每个确认的仓库执行 `git worktree list --porcelain`，得到主工作树 + 链接 worktree（路径、分支、locked、prunable）。工作区内的链接 worktree 按 realpath 匹配并挂到父仓库；工作区外的仅在 `view.showExternalWorktrees` 开启时显示。
6. submodule 识别：含 `.gitmodules` 的仓库打标；submodule 状态仅在展开时惰性读取（`git submodule status`），初扫绝不执行。
7. 增量发现：浅层监听工作区根与一级目录；create/rename 事件只对该子树做局部的迷你扫描。

身份：`repoId` = realpath(git common dir)，worktree 目录移动后仍稳定；注册表保存 `relPath`、`gitDir`、`commonDir`、`kind`（`repository | worktree | bare`）、`parentRepoId`。

允许仓库嵌套在另一仓库的工作树内，并以父子形式展示；父仓库自身 `git status` 的行为（embedded repo 警告）如实呈现，不做猜测。

### Git 执行层（`git-core`）

*范围：v1。*

- 唯一原语：`runGit(args, { cwd, env, signal, onStdout }) → { code, stdout, stderr }`。只以参数数组 spawn——绝不拼接 shell；路径一律放在 `--` 之后。
- 每次调用的环境加固：只读命令用 `GIT_OPTIONAL_LOCKS=0`；`GIT_TERMINAL_PROMPT=0`（不挂起等凭据；认证失败转为结构化错误上抛 UI）；`LC_ALL=C`（输出稳定可解析）；`GIT_PAGER=cat`。Windows 上逐命令传 `-c core.longpaths=true`（不修改用户配置）。
- 并发池：每工作区默认 6 个并发进程，优先级队列——交互操作插队到后台状态刷新之前；后台任务可经 `AbortSignal` 取消（杀进程树）。
- 解析器与调用同层：`status --porcelain=v2 -z --branch`、`for-each-ref`、`log`（流式、NUL 分隔自定义格式）、`worktree list --porcelain`、`submodule status`、`stash list`、`rev-list --count`。全部解析器在含中文路径、空格、换行文件名的 fixture 仓库上做测试。
- 操作模型：每个写操作定义一次 `{ preconditions, command plan, backupRef?, conflictBehavior, postValidate }`，UI（右键菜单、提交图、命令面板）走同一条代码路径。冲突检测（退出码 + git dir 状态文件）统一处理。
- 凭据流：优先系统 credential helper / SSH agent；可选内置 askpass helper（`GIT_ASKPASS`）做安全弹窗（凭据绝不进日志）。push/pull 失败映射为类型化错误（认证 / 非快进 / 网络 / hook 拒绝）。
- hooks：由 Git 自身执行，输出流式进操作对话框；不受信工作区以 `core.hooksPath` 覆盖抑制。

### 状态模型与刷新生命周期

*范围：v1。*

每个仓库产出 `RepoStatus`：

```
head { ref, sha, detached, unborn } · upstream { ref, ahead, behind }
staged[] · unstaged[] · untracked[] · conflicted[]        （路径 + 变更种类；rename 已解析）
operation: none | merge | rebase | rebase-interactive | cherry-pick | revert | bisect
stashCount · worktrees[]（branch、path、locked/prunable） · submodulesPresent: bool
```

刷新规则：

1. 事件驱动优先；250–300 ms 防抖合并事件风暴（一次大 checkout 会产生数千事件）。
2. 廉价跳过：重跑 `git status` 前先 stat `index`（mtime + size）、`HEAD` 与操作态标记文件；无变化 ⇒ 复用缓存状态。
3. 未跟踪文件：默认 `--untracked-files=normal`；`all` 为逐仓库可选。未跟踪数量病态的仓库给上限列表 + "显示更多"，而不是卡死刷新。
4. 后台预热：打开工作区按优先级刷新（可见行 > 已展开节点 > 其余），以池并发执行；结果按批流式推送渲染层（节流 ≤ 30 次 UI 更新/秒）。
5. 兜底轮询（默认 60 秒，可配置；watcher 健康时默认关闭）覆盖网络盘与平台监听上限场景。

### 文件监听

*范围：v1。*

- 实现：`@parcel/watcher`（原生后端：ReadDirectoryChangesW / FSEvents / inotify），每个仓库一组订阅：
  - 该仓库的 git dir，`depth: 2`，关注：`HEAD`、`index`、`ORIG_HEAD`、`MERGE_HEAD`、`rebase-merge/**`、`rebase-apply/**`、`CHERRY_PICK_HEAD`、`REVERT_HEAD`、`refs/**`、`packed-refs`、`stash`、`BISECT_*`。
  - 工作树仅覆盖文件树中当前已展开的目录（LRU 上限约 2000 个被监听目录，折叠即释放），关注 create/delete/rename/change。
- 工作区根浅层监听（`depth: 2`）仅用于发现。
- 事件路由：git dir 的 index/HEAD/refs → 失效该仓库状态；工作树事件 → 失效 Explorer 对应子树，若可能影响脏状态则安排防抖后的状态刷新。
- 降级：watcher 报错 / 检测到网络文件系统时，该范围回退为带退避的间隔轮询；状态栏对受影响仓库给出低调的"轮询中"指示。
- 预算：监听总数有界（仓库数 × 1 + 已展开目录）；Linux 上超出 inotify 预算时，把最新的订阅降级为轮询并一次性告知。

### IPC 契约

*范围：v1。* 所有通道在 `packages/shared` 中定义类型，主进程侧用 zod 校验。命名 `domain:action`。请求走 `invoke`（promise）；流走事件通道（节流）；终端数据走专用 `MessagePort`。

| 通道 | 类型 | 签名（草案） |
|---|---|---|
| `workspace:open` | invoke | `(rootPath) → WorkspaceDescriptor` |
| `workspace:scan` | 事件流 | `discovered: RepoRecord[]`（分块）、`scan:done` |
| `workspace:reposChanged` | 事件 | 注册表 diff（added/removed/updated） |
| `git:status` | invoke | `(repoId, { refresh?: boolean }) → RepoStatus` |
| `git:statusChanged` | 事件（批量） | `{ repoId, status }[]` |
| `git:op:run` | invoke + 进度事件 | `(repoId, OpRequest) → OpResult`；`git:op:progress` 流 |
| `git:log:read` | invoke | `(repoId, LogQuery, page) → { commits, hasMore }` |
| `git:diff:read` | invoke | `(repoId, DiffRequest) → DiffPayload`（text/binary/image） |
| `fs:tree:read` | invoke | `(dirPath) → DirEntry[]` |
| `fs:file:read/write` | invoke | path + content/BLOB，含外部变更守卫 |
| `term:create/write/resize/dispose` | invoke + MessagePort | 已解析 profile 的会话 |
| `commitmsg:generate` | invoke + 流 | `(repoId, { provider }) → 流式草稿` |
| `settings:get/set/onDidChange` | invoke + 事件 | 分 scope（user/workspace） |
| `trust:query/grant` | invoke | 工作区信任状态 |

### 持久化

*范围：v1。*

**用户编写的 JSON**（写入时不做注释剥离；原子写入；带 `$schema` 获得编辑器自动补全）：

`.gitreedesk/workspace.json`（工作区根——可提交）：

```jsonc
{
  "$schema": "https://gitreedesk.dev/schemas/workspace.json",
  "name": "acme",
  "exclude": ["content/中文文档", "**/fixtures/**"],
  "scan": { "maxDepth": 8, "followSymlinks": false },
  "groups": [{ "name": "Backend", "match": ["backend/*"] }]
}
```

`.gitreedesk/terminal.json`（任意目录——级联，就近优先，见终端章节）。

`.gitreedesk/settings.json`（工作区级设置覆盖；用户级位于 `userData/settings.json`）。

`userData/keybindings.json`（用户快捷键覆盖）。

**SQLite 缓存**（`userData/cache.db`，schema 带版本、自动迁移；损坏 ⇒ 删除重建，绝不抛用户可见错误）：

```sql
CREATE TABLE workspaces   (id INTEGER PRIMARY KEY, root TEXT UNIQUE, name TEXT, last_opened_at INTEGER, trusted INTEGER);
CREATE TABLE repos        (id INTEGER PRIMARY KEY, workspace_id INT, rel_path TEXT, git_dir TEXT, common_dir TEXT,
                           kind TEXT, parent_repo_id INT NULL, name TEXT, UNIQUE(workspace_id, rel_path));
CREATE TABLE repo_cache   (repo_id INTEGER PRIMARY KEY, status_json TEXT, refs_json TEXT, updated_at INTEGER);
CREATE TABLE commits_cache(repo_id INT, sha TEXT, parents TEXT, author TEXT, ts INTEGER, subject TEXT, refs TEXT,
                           PRIMARY KEY(repo_id, sha));
CREATE TABLE ui_state     (key TEXT PRIMARY KEY, value TEXT);   -- 最近工作区/文件、展开节点、图偏好
CREATE TABLE oplog        (id INTEGER PRIMARY KEY, repo_id INT, op TEXT, backup_ref TEXT NULL, at INTEGER, undo_state TEXT);
```

### 安全与信任模型

*范围：v1。*

- 渲染层：`contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`、严格 CSP、`will-navigate`/`setWindowOpenHandler` 默认拒绝；外链一律在系统浏览器打开。
- 一切文件与 Git 访问都经主进程服务；渲染层传来的路径先解析、再校验落在工作区根内（或显式登记的外部 worktree 路径内）方可使用。
- Git 层与终端快捷命令中没有任何 shell 字符串拼接（只传参数数组）。快捷命令**永不自动执行**。
- 不受信工作区门禁管辖 hooks、快捷命令，以及（将来的）任务。
- LLM 提交信息生成默认关闭；启用需显式配置，且每次请求在 UI 与设置中展示"将暂存区 diff 发送至 \<host\>"披露。API key 用 `safeStorage`（OS 钥匙串）存储；Linux 无钥匙环时降级为仅会话内保存并明确告知，绝不落明文。
- 机密信息不出现在日志、崩溃报告或操作日志中。

### i18n、主题、键盘优先、动效

*范围：v1。*

- **i18n**：react-i18next；英文原文即源（`t('workspace.emptyState')` 配同目录 `locales/en/…json`）；按功能域拆分命名空间；展示层用 `Intl.DateTimeFormat`/`NumberFormat`；切换语言即时生效、无需重启；开发期提供伪语言（`en-XA`）撑长字符串以发现截断。lint 规则在 CI 拦截 JSX 中的字符串字面量。
- **主题**：三态 `system | light | dark`（默认 system，跟随 OS 实时变化）。设计 token 为 CSS 变量，由 Tailwind v4 消费；Monaco 明/暗主题对由同一组 token 生成，编辑区与外壳永不色调漂移。深色模式是设计起点，而非从浅色推导。
- **键盘优先**——不变量：所有功能可经命令面板触达；没有任何操作只能鼠标完成；焦点永不被抢（终端/编辑器/对话框焦点规则见 UX 蓝图）；动画 ≤ 150 ms、可中断、绝不阻塞焦点或输入；尊重 `prefers-reduced-motion`；焦点环全局可见。
- **无障碍基线**：Radix 原语；所有面板纳入 Tab 序；树/列表全部可方向键导航、Enter/Space 操作；状态用图标 + 颜色 + tooltip 三重表达（绝不只靠颜色）。

---

## 功能规格

### 工作区打开与最近列表

*范围：v1。* 欢迎页展示最近工作区（来自 `ui_state`）、"打开文件夹…"对话框、支持把文件夹拖入窗口。v1 为单实例单窗口。打开工作区：登记 SQLite → 如有缓存立即展示树 → 启动增量扫描 + 后台状态预热。首次打开出现信任提示。切换工作区原地完成（不重启）。关闭时仅保留当前工作区的监听状态，其他工作区释放。

### 树视图：Explorer 与 Repos

*范围：v1。*

同一注册表的两个协同视图：

- **Explorer 视图** —— 真实文件系统树：文件夹按原样展示，仓库带徽标（分支名或短 sha），worktree 文件夹带 worktree 图标。目录惰性读取；已展开目录监听。文件操作：新建文件/文件夹、重命名、删除（经 `shell.trashItem` 移入系统回收站——可逆）、在系统文件管理器中显示、复制路径、"在 VSCode 中打开"、"在此打开终端"、"对比选中的两个文件"。
- **Repos 视图** —— 逻辑视图：分组（配置的或按首层路径段派生），仓库为一级行，显示名称、当前分支/ref、徽标，并嵌套子节点：**链接 worktree**（带各自分支）与 **submodule**（含未初始化）显示在其主仓库下；工作区外的 worktree 在开启时以灰色 + 绝对路径显示。

徽标与视图选项：每种徽标可独立开关——`dirty 圆点`、`ahead/behind 计数`、`stash 数`、`进行中操作`、`detached HEAD`、`submodule 待处理`。快捷过滤："仅 dirty"、"仅 ahead/behind"、"仅 worktree"，外加逐仓库勾选集合，决定哪些仓库进入 SCM 视图及未来的聚合界面。仓库行支持多选做批量操作（批量 fetch、批量 pull、批量开终端）。

两个视图都用虚拟滚动（TanStack Virtual）与键盘导航（↑/↓、←/→ 折叠展开、Enter 打开、仅在 SCM 中 Space 切换 stage）。

### Worktree 一等公民

*范围：v1。*

- **展示**：链接 worktree 在 Repos 视图中嵌套于主仓库之下，标注 `<分支> @ <路径>`；主工作树带 "main" 标记。
- **创建**：对话框含源仓库、新建或已有分支选择器（选已有分支时做"已被其他工作树检出"拦截——Git 禁止同一分支出现在两个 worktree）、新分支的基底 ref、目标路径模板。默认模板：`{worktreeRoot}/{repo}_{branch-slug}`，其中 `branch-slug` 把 `/` 替换为 `-`（如 `__worktree__/mobile-app_worktree-feat-dark-mode`——`worktreeRoot` 默认 `<workspace>/__worktree__`，模板可配置）。新建的 `__worktree__` 根自动从发现噪声中排除，并归到父仓库下显示。
- **删除 / prune / lock / unlock** 全部暴露；**move** 属*后续*。脏工作树删除需 force（二次确认 + backup ref），prune 支持手动触发与 fetch 后触发。
- worktree 行完全可操作：每个 Git 功能都可在该 worktree 的仓库上下文与工作树中执行。

### Git 操作

*范围：v1。* 所有操作在 `git-core` 中定义一次，并在右键菜单、按钮、命令面板、提交图中以同一形态出现。每个破坏性操作都有 backup ref + 撤销入口。

**文件与暂存**

| 操作 | 说明 |
|---|---|
| Stage / unstage 文件 | 支持目录粒度 |
| Stage / unstage **hunk** | 以补丁方式作用于 index；入口在 diff 边栏与 SCM 行 |
| Discard 变更 | 已修改/重命名：从 index `restore`（确认——不可逆，对话框说明）；未跟踪文件：**移入系统回收站**（可逆） |
| Stage all / unstage all | 按仓库 |
| 加入 `.gitignore` | 未跟踪行右键菜单（追加规则并立即 stage） |

**Commit**

- 提交已暂存（消息框带生成按钮）、带 sign-off 提交、amend（保留消息 / 修改消息 / 并入工作区）、提交并推送。
- hook 输出（pre-commit/prepare-commit-msg）流式进提交面板；失败时保留消息；不受信工作区抑制 hooks。
- GPG 签名：*后续。*

**历史改写——修改指定提交的提交信息 / 作者 / 时间**

- HEAD 提交：`commit --amend` 配 `--author`、`--date`，以及（改提交时间）`GIT_COMMITTER_DATE` 环境变量。
- 任意更早的提交（或一批提交一次完成）：脚本化交互式 rebase——从目标提交的父提交开始 `rebase --interactive`，用 `GIT_SEQUENCE_EDITOR` 把目标行标为 `edit`（走序列文件，不需要 TTY），每次暂停时执行 `git commit --amend --author=… --date=… -m …`（非交互 `GIT_EDITOR`），随后 `rebase --continue`。前置条件：工作树干净（否则提供自动 stash），已创建 backup ref，分支已推送时强烈警告（"将改写已发布历史" + 显式确认）。完成后提供 Undo（回退到 backup ref）。
- 亦可在提交图右键菜单中对某提交执行。

**分支 / 远端 / 标签**

- 分支：创建（自任意 ref）、重命名、删除（未合并时警告 + backup；当前分支不可删）、checkout（脏工作树拦截并可自动 stash；detached HEAD 警告并提供"在此创建分支"捷径）、设置 upstream、与当前分支对比（打开 diff 范围）。
- 远端：增删改 URL、fetch（单仓库 / 全部仓库，可选 prune、可选跟 tag）、pull（策略按仓库配置，默认 `ff-only`，可选 `merge` / `rebase`）、push（选分支；推送对话框列出该仓库全部远端并默认预选默认远端，可勾选多个远端**一次推送到位**，各远端分别报告结果；发布新分支时 set-upstream，历史分叉时 `--force-with-lease` 走二次确认）、推送 tag。
- 标签：列表（本地/远端分组）、创建（附注/轻量）、删除、推送、checkout tag（detached）。

**Merge / rebase / cherry-pick / revert / reset / stash / submodule**

- 合并进当前分支：可选 `--no-ff`、`--squash`、`--ff-only`；冲突流程见下。
- Rebase：把当前分支 rebase 到指定 ref（自动 stash 可选）；交互式 rebase 提供列表编辑器（v1 用按钮调整顺序；行操作：pick / reword / edit / squash / fixup / drop；拖拽排序属*后续*）；continue / skip / abort。
- Cherry-pick：单提交或区间（`A..B`），可选 `--no-commit`；revert 同理。
- Reset：`--soft | --mixed | --hard` 到任意 ref（`--hard` 需 backup ref + 确认；对话框明确说明将丢失什么）。
- Stash：创建（消息、含未跟踪、keep-index、按路径子集）、列表可展开文件与 diff、apply / pop / drop（drop 前建 backup ref）、show。
- Submodule：每个 submodule 的状态（是否初始化、commit 漂移、脏）、**一键 "Update all"**（`submodule update --init --recursive --jobs <n>`，进度流式）、sync URLs、作为仓库打开（跳转 Repos 视图）；add/deinit 属*后续*。
- 冲突（统一流程）：进行中操作横幅（continue/abort/skip）、冲突文件列表，逐文件 **ours/theirs/both** 解决、"在编辑器中打开带标记内容"、启动外部合并工具（命令可配置）、标记已解决，以及 continue 前的校验（"仍有未解决冲突"清单）。

**进行中操作检测**会拦截互斥操作（如 merge 中不可 rebase），弹窗解释并给出合法操作。

### 提交图

*范围：v1，逐仓库。*

- 按仓库开为 tab（LRU 缓存约 5 个存活）。数据来自 `git log --all`（默认 refs 可配置），以自定义 NUL 分隔格式流式读取；泳道在客户端计算；渲染 = 虚拟化 DOM 行 + canvas 泳道层（目标：已加载 5000+ 行时 60 fps）。
- 分页：首页 1000 个提交；向下滚动按 2000 行分块加载更早历史；"超大仓库"模式限制窗口（`--skip/--max-count`，总数用 `rev-list --count`）。
- 行内容：泳道图、refs（本地/远端/tag/HEAD 用不同 chip）、subject、作者、相对时间、"incoming/outgoing" 标记（相对 upstream 与当前分支）。
- 过滤：refs 多选、作者、路径（v1 不做 rename 跟随）、日期区间、消息文本，以及"仅当前分支可达"。
- 提交详情侧栏：完整消息、作者 + 提交者（姓名/邮箱/日期）、带统计的文件列表；点击文件在编辑区打开该提交的 diff。
- 提交操作（右键菜单，复用操作模型）：checkout、在此创建分支/tag、cherry-pick、revert、reset 到此处*（soft/mixed/hard）*、复制 SHA / ref 名、把当前分支 rebase 到该提交、自此交互式 rebase、**修改提交信息 / 作者 / 时间**（F4 历史改写）、选择以对比（任意两个提交间 diff）。
- 跨仓库"活动"聚合属*后续*。

### 编辑器

*范围：v1。*

- Monaco 本地打包；标签页（打开编辑器列表、脏标记、关闭/关闭其他）；分屏属*后续*。
- 语言能力：内置语言高亮（按需懒加载语言贡献）；TypeScript/JavaScript 提示走内置 TS worker，配置尽力而为——就近 `tsconfig.json` 的 `compilerOptions` + stdlib；v1 不做 `node_modules` 类型解析（作为已知限制写入文档）。**"在 VSCode 中打开"**按钮（`code --goto <path>:<line>[:<col>]`，命令可配置；失败时回退到在系统文件管理器中显示）是工程级智能提示/重构的明确逃生口。
- 保存（Ctrl/Cmd+S）：原子写入；外部变更检测（聚焦时与保存前校验 mtime+hash）→ 冲突对话框（覆盖 / 重新加载 / 查看 diff）。超过 10 MB 的文件只读打开（需确认）；二进制文件给预览（图片）或提示外部打开。
- 仅保留最小化编辑设置：字号/字体、制表符宽度、插入空格、自动换行、minimap 开关。这不是 IDE：不做保存时格式化、不做任务、不做多根工作区、不做扩展。

### 变更列表与 diff

*范围：v1。*

- **SCM 视图**（活动栏）：按仓库分节——哪些仓库出现由 Repos 视图的逐仓库勾选决定；每节展示 已暂存 / 未暂存 / 未跟踪 / 冲突 分组（每组可见性可单独开关）、提交框（消息 + 生成 + commit/amend/stage-all），以及该仓库的进行中操作横幅。
- 文件行：状态图标（M/A/D/R/U/!/C）、已暂存与未暂存区分、悬停操作（stage/unstage/discard）、多选、点击 → diff。
- **Diff 视图**：Monaco diff 编辑器（并排 ⇄ 内联切换）、忽略空白开关、自动换行；rename 感知；二进制显示体积信息；图片给 2-up 前后对比预览（洋葱皮滑块属*后续*）；diff 边栏提供 hunk 操作：stage hunk / revert hunk；"与…对比"选择器（INDEX / HEAD / 任意 ref / 另一分支），可作用于单个文件或整个仓库范围。
- **文件历史**：单文件 `git log` 列表（rename 跟随属*后续*），点某版本打开该文件在该版本的 diff。
- 空态与骨架屏遵循 UX 蓝图。

### 终端

*范围：v1。*

- 会话：pty host 中的 node-pty，渲染层用 @xterm/xterm；多终端（标签），每个固定在某个工作目录（仓库根 / 任意文件夹 / 文件所在目录）；渲染层刷新后会话存活；Explorer、Repos、SCM、diff 视图均有"在此打开终端"。
- Profile：自动探测默认值——Windows：存在则 PowerShell 7（`pwsh`）、Windows PowerShell、`cmd`、Git Bash（取自探测到的 Git 安装）、已安装的 WSL 发行版；macOS/Linux：`$SHELL`，以及存在则 `bash`/`zsh`/`fish`。每个 profile：shell 路径、参数、env、cwd 模板、图标/颜色。完整环境：`{...process.env, ...profile.env, TERM, GITREEDESK_*}`（不把本工具命令自身的 `GIT_*` 泄漏给终端）。
- **级联配置**：`<任意目录>/.gitreedesk/terminal.json`；解析从工作区根逐层向下到目标目录，更深的文件按 key 覆盖；`profiles` 与 `quickCommands` 按 name 合并（更深者胜）。选择类配置的优先级：最近的文件 > 工作区设置 > 用户设置。

```jsonc
// app/.gitreedesk/terminal.json —— 仅对 app/** 生效
{
  "$schema": "https://gitreedesk.dev/schemas/terminal.json",
  "defaultProfile": "dev",
  "profiles": [{ "name": "dev", "shell": "pwsh", "args": ["-NoLogo"], "env": { "NODE_ENV": "development" } }],
  "quickCommands": [
    { "name": "pnpm dev", "command": "pnpm", "args": ["dev"], "cwd": "{repoRoot}" }
  ]
}
```

- 快捷命令：出现在终端工具栏、命令面板及按目录的选择器中；`cwd` 令牌 `{dir}` / `{repoRoot}` / `{workspaceRoot}`；以 argv 执行（需要管道时用 `shellCommand: true`，仍绝不自动执行）；不受信工作区整体禁用。
- 终端 UX：链接（URL → 浏览器；`path:line` → 编辑器）、多行粘贴警告、回滚行数设置、各平台 Cmd/Ctrl+C/V 语义。Shell integration（标签标题跟踪 cwd/运行中命令）属*后续*。

### 提交信息生成

*范围：v1，双模式。*

- 流水线：(1) 读取暂存 diff（name-status + numstat + 统一 hunk，带上限）；(2) 探测仓库约定——commitlint 配置文件、`.gitmessage` 模板、对最近 100 条非 merge subject 做风格推断（conventional commits 模式 `^(type)(\(scope\))?!?:`、前缀风格、平均长度、subject 语言）；(3) 离线草稿——由变更性质推断 type（文件模式 + diff 启发式）、由公共路径段推断 scope、由主体变更推断 subject；body 用分组 numstat 生成条目；带置信度：探测不到约定时产出中性、描述性的草稿而不是硬猜；(4) 可选 LLM Provider——OpenAI 兼容 base URL + 模型 + 密钥（`safeStorage`），流式写入提交框，可取消，严格超时（默认 30 秒），超时自动回落离线并提示；prompt = 约定画像 + 截断 diff + 明确的"只输出消息本身"指令。
- UX：提交框内的生成按钮（逐仓库）、"重新生成"、草稿偏弱时给变体选择；草稿始终可编辑且**永不自动 commit**；每个新 host 首次使用时确认并展示发送内容与去向。多仓库批量生成属*后续*。

### 命令面板与键位

*范围：v1。*

- 命令面板（Ctrl/Cmd+Shift+P）暴露全部动作并做上下文可用性判断；快速打开（Ctrl/Cmd+P）跨工作区找文件（遵守 excludes），`>` 模式进命令；"转到仓库"选择器（Ctrl/Cmd+R，模糊匹配）。
- 默认键位（v1 精选集；用户可在 `keybindings.json` 覆盖；"Keyboard Shortcuts" 参考页列出默认值与覆盖项；覆盖时做冲突检测）：

| 键位（Win/Linux / macOS） | 动作 |
|---|---|
| Ctrl+Shift+P / ⇧⌘P | 命令面板 |
| Ctrl+P / ⌘P | 快速打开文件 |
| Ctrl+R / ⌘R | 转到仓库 |
| Ctrl+Shift+G / ⇧⌘G | 聚焦 Source Control |
| Ctrl+` / ⌃` | 切换终端面板 |
| Ctrl+Enter / ⌘⏎ | 提交已暂存 |
| Space（SCM 内） | stage/unstage 选中文件 |
| Ctrl+Shift+F / ⇧⌘F | fetch 当前仓库（Repos 视图上下文 ⇒ 全部选中） |
| F2 | 重命名（按焦点：文件或分支） |
| Delete | 删除（文件 → 回收站；分支列表中删除分支） |
| Enter | 打开/确认；提交图中查看提交详情 |
| Alt+←/→ / ⌥←→ | 编辑器导航历史 |
| Esc | 关闭临时 UI；绝不关闭编辑器标签 |

### 设置

*范围：v1。*

- 设置页：可搜索，分组（Appearance、Editor、Git、Terminal、Commit message、Advanced），每项显示作用域（User / Workspace）与"复制到工作区"入口；修改原子写入 JSON 并即时生效。应用内置 JSON schema，手改文件也有自动补全。
- 作用域：`userData/settings.json`（用户）→ `.gitreedesk/settings.json`（工作区覆盖）→ 逐仓库覆盖表（如 `repos: { "backend/api-server": { pullStrategy: "rebase" } }`）。
- 关键设置组：appearance（主题模式、密度、强调色）、git（git 路径覆盖、并发数、轮询间隔、默认 pull 策略、未跟踪策略）、terminal（默认 profile）、commit message（Provider 预设、base URL、模型、temperature）、advanced（支持用日志级别）。

### 平台与打包

*范围：v1。*

- 目标：electron-builder——Windows（NSIS 安装包 + 便携 zip）、macOS（dmg + zip，arm64 + x64；公证需 Apple 账号——暂缓，未签名构建写入文档）、Linux（AppImage + deb）。
- CI：GitHub Actions 三平台矩阵；原生依赖（better-sqlite3、node-pty、@parcel/watcher）走 `electron-rebuild`，带预编译产物缓存；打包产物冒烟测试：启动应用并打开 fixture 工作区。
- 平台集成：macOS 原生菜单栏（应用菜单 + 编辑菜单标准剪贴板 role——macOS 上没有它 Cmd+C/V 根本不工作）；Windows/Linux 无边框窗口 + 自绘标题栏（可切换回原生边框）；macOS 上所有快捷键统一使用 Cmd。
- 数据目录：`%APPDATA%/GitTreeDesk`、`~/Library/Application Support/GitTreeDesk`、`~/.config/GitTreeDesk`（内含 `settings.json`、`keybindings.json`、`cache.db`、`logs/`）。
- 自动更新（electron-updater）属*后续*；v1 在 About 对话框提供手动下载页链接。

---

## UX 蓝图

布局（VSCode 式熟悉感，但更紧凑、键盘优先）：

```
┌ 标题栏：工作区名 · 窗口控制 ·（macOS 显示菜单）──────────────────────────┐
│ 活动 │ 主侧栏                        │ 编辑区（标签）                    │
│ 栏   │  ▸ Explorer                   │  • 文件  • diff  • 提交图        │
│ 树   │  ▸ Repos                      │  • 设置  • 键位参考              │
│ SCM  │  ▸ Source Control             │                                  │
│ 图   │  ▸ Graph                      ├─────────────────────────────────┤
│ 终端 │                               │ 次侧栏（提交/文件详情、仓库信息） │
│ ⚙    │                               │ ——可开关                        │
├──────┴───────────────────────────────┴─────────────────────────────────┤
│ 底部面板：Terminal │ Output（git 操作日志）          ——可折叠           │
├─────────────────────────────────────────────────────────────────────────┤
│ 状态栏：仓库 · 分支 · 同步 · 操作态 · 终端 · watcher · 主题             │
└─────────────────────────────────────────────────────────────────────────┘
```

交互规则：

- **状态**：每个异步界面都有 骨架 → 内容 → 空态（带主操作）→ 错误态（带重试 + "复制详情"）；等待超过约 800 ms 的加载不允许只有 spinner 没有文字。
- **焦点纪律**：打开对话框/面板绝不滚动或回流下方的树；通知（toast）绝不抢焦点；Esc 只关闭最上层的临时层。
- **动效策略**：token `--motion-fast: 120ms`、`--motion-base: 150ms`；只用淡入淡出/滑动（不做触发布局的动画）；列表虚拟化不带入场动画；`prefers-reduced-motion: reduce` ⇒ 0 ms。
- **徽标图例**（也放进入门引导）：● dirty · ↓n/↑n behind/ahead · ⚑ stash · ⟳ 操作进行中 · ⚯ worktree · ◇ submodule 待处理 · detached 标记。
- **密度**：默认舒适，可选紧凑；行高 紧凑 22 px / 舒适 28 px。
- **入门引导**：首次运行引导（打开文件夹、信任提示、快捷键卡片），可跳过，只展示一次。

## 里程碑

每个里程碑以可演示的成果收尾。规模为相对大小（S ≪ L），不是工期承诺。

| 里程碑 | 规模 | 交付 | 演示 |
|--------|------|------|------|
| 骨架 | S | pnpm workspace、Electron 外壳、IPC 契约 + zod、设置、主题（system/light/dark）、i18n 接线（en/zh-Hans）、信任提示、CI 矩阵桩 | 应用可打开，主题/语言实时切换 |
| 工作区与树 | M | 发现 + 注册表（SQLite）、Explorer + Repos 视图（虚拟化）、徽标 + 视图选项、watcher 骨架（git dir 监听）、状态模型 + 预热调度 | 50+ 仓库的工作区打开；完整树 ≤ 预算；状态流式上屏；中文路径正确 |
| 变更 & diff & 提交 | M | SCM 视图（多仓库、开关项）、hunk/文件级 stage、discard（未跟踪进回收站）、Monaco diff（并排/内联）、提交框、文件历史 | 在应用内完成完整的本地提交流程 |
| 核心 Git 操作 | L | 分支、远端、fetch/pull/push、merge/rebase（交互式）、cherry-pick、revert、reset、stash、tag、冲突流程、操作横幅、backup ref + 撤销 | 日常流程对标 SourceTree；端到端冲突解决 |
| Worktree 与 submodule | M | worktree 增删改查 + 归组 + 模板；submodule 状态 + 一键 "Update all"（流式）；工作区外 worktree 支持 | 从 UI 创建 worktree；一键修复工作区 submodule |
| 提交图 | L | 图 tab（泳道、虚拟化、分页）、过滤、提交详情、提交操作、**历史改写**（消息/作者/时间）带备份 + 撤销 | 修改旧提交的消息/作者/时间并撤销 |
| 编辑器与终端 | L | Monaco 标签 + 保存/冲突处理 + "在 VSCode 中打开"；pty host + xterm、profiles、级联 terminal.json、快捷命令、多标签 | 按目录生效的终端配置；快捷命令启动 |
| 提交信息生成 | M | 约定探测、离线草稿、LLM Provider（可选开启、流式、钥匙串）、设置 UI | 两种模式下从暂存 diff 一键出草稿 |
| 打磨与发布 | M | 键位速查、对照预算做性能收尾、三平台打包、About/更新页、入门引导 | 三个平台的可发布安装包 |

排序理由：变更与提交流程先于核心 Git 操作（先让提交流程可用，尽早验证操作模型设计）；提交图放在核心操作之后，因为图上的操作要复用它；编辑器/终端放在 Git 核心之后，因为期间由"在 VSCode 中打开"覆盖编辑需求。

## 性能预算

预算即 v1 的发布门槛，在参考场景上测量，硬件为中端 2024 笔记本、SSD，Windows 优先。

| 指标 | 预算 | 测量方式 |
|---|---|---|
| 冷启动 → 窗口可交互 | ≤ 2.0 s | 热启动（有缓存）；首次冷启 ≤ 4 s |
| 打开工作区 → 完整树首帧 | ≤ 3.0 s（有缓存注册表：立即） | 开发性能浮层 + CI 性能用例跑生成的 fixture 工作区 |
| 全部仓库状态预热（55 个仓库） | 后台 ≤ 15 s，UI 全程不阻塞 | 流式；可见优先 |
| 单仓库状态刷新（典型，< 5k 文件） | p50 ≤ 300 ms，p95 ≤ 800 ms | 性能浮层直方图 |
| 状态刷新跳过（无变化、指纹命中） | ≤ 5 ms | 仅 stat 路径 |
| 树/列表滚动 | 已加载 5000 行时 60 fps | CI 用例中的 devtools FPS 计量 |
| 提交图首页（1 万提交仓库） | ≤ 1.5 s 首帧 | 流式行 |
| 终端输入 → 回显 | p95 ≤ 50 ms | xterm.js marker 计时 |
| 内存（空闲，55 仓库） | 总 RSS ≤ 600 MB | 预热完成后测量 |
| 安装包体积 | ≤ 130 MB（win x64） | electron-builder 产物 |

预算不达标按 bug 处理，不算打磨项；开发性能浮层（可开关，显示扫描/状态/操作耗时与 watcher 数量）随 dev 构建发布。

## 风险与对策

| 风险 | 对策 |
|---|---|
| Windows 长路径（> 260 字符） | 逐命令 `-c core.longpaths=true`，Node fs 调用用 `\\?\` 前缀，文档说明嵌套过深时的应对 |
| Unicode/中文路径（如 `content/中文文档`） | porcelain 一律基于 `-z` NUL 输出解析并消除 `core.quotepath` 影响；测试 fixture 覆盖中文/空格/换行文件名 |
| 凭据弹窗挂起操作 | `GIT_TERMINAL_PROMPT=0` + 类型化认证错误 + 内置 askpass；SSH agent 透传 |
| 不受信工作区执行 Git hooks | 信任门禁 + `core.hooksPath` 抑制 |
| Linux inotify 监听上限 | 有界监听计划，优雅降级为轮询并一次性提示 |
| 单个巨型仓库主导开销 | 按仓库的未跟踪策略、状态上限、图的"超大仓库"窗口模式 |
| node-pty / better-sqlite3 与 Electron ABI 的原生构建 | CI 内 `electron-rebuild` + 预编译缓存；逐平台跑打包产物冒烟测试 |
| Monaco TS 提示是文件级而非工程级 | 产品口径明确，"在 VSCode 中打开"逃生口，LSP 桥接置于后续路线 |
| 历史改写破坏分支 | backup ref + 前置条件守卫 + 撤销；在 fixture 仓库上做集成测试 |
| Windows 杀软/文件锁占用 `.git` | EBUSY/EPERM 退避重试；面向用户的"另一进程占用该仓库"诊断 |
| Git 版本跨度（2.23…最新） | 启动版本探测 + 功能分级；低于 2.36 警告 |
| 大 checkout 的事件风暴 | 250–300 ms 防抖 + 合并；按仓库的刷新预算 |
| CRLF / attributes 意外 | 绝不自行归一化；尊重 `core.autocrlf`/`.gitattributes`（Git 自己处理）；diff 如实展示并带空白开关 |
| Linux 无钥匙环时 `safeStorage` 弱降级 | 仅会话内保存密钥 + 明确告知（绝不落明文） |

## 待定问题

- **内置便携版 Git**（Windows/macOS 零依赖安装）——等首批用户反馈后决定（v1 要求系统 Git）。
- **自动更新通道**与托管（GitHub Releases vs 对象存储）——机制本身属后续版本；v1 在 About 对话框提供下载页链接。

## 附录

### 用户级设置示例（`settings.json`）

```jsonc
{
  "appearance": { "theme": "system", "density": "comfortable" },
  "locale": "en",
  "git": {
    "path": null,                      // null = 自动探测
    "concurrency": 6,
    "pollIntervalSec": 60,
    "defaultPullStrategy": "ff-only",  // ff-only | merge | rebase
    "untrackedStrategy": "normal"      // normal | all（可按仓库覆盖）
  },
  "commitMessage": {
    "provider": "offline",             // offline | openai-compatible
    "baseUrl": null, "model": null, "temperature": 0.2
  },
  "editor": { "fontSize": 13, "fontFamily": null, "tabSize": 2, "minimap": false },
  "terminal": { "defaultProfile": null }
}
```

### IPC 通道草案

权威清单位于 `packages/shared/src/ipc.ts`。

### 默认键位

权威清单位于 `apps/desktop/src/renderer/src/keymap/defaults.ts`。

### 竞品笔记（UX 启发，非照搬）

- **GitKraken** —— 仓库分 tab 组织；我们的差异：用仓库树替代 tab。
- **Fork** —— diff 查看器的人机工程（hunk 点击区、图片 diff）；我们的差异：多仓库 SCM。
- **Tower** —— 多仓库 fetch/pull 批量操作；我们的差异：工作区优先发现。
- **GitButler** —— 诚实的"先预览后应用"操作 UX；借用：backup ref + 显式前置条件。
- **VSCode** —— 命令面板与键盘纪律；我们的差异：一切皆懒加载。

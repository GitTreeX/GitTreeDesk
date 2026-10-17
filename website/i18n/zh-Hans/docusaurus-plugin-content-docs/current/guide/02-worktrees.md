# 02 · Worktree

> 状态：✅ 已实现 · 范围：v1 · 工程参考：[`../spec.md`](../spec.md)

**Worktree** 是挂在同一个仓库上的附加工作目录——例如 `__worktree__/mobile-app_worktree-feat-dark-mode` 就是 `app/mobile-app` 在某个功能分支上的第二份检出。GitTreeDesk 把 worktree 当作一等公民：自动识别、归组、可从 UI 创建与删除。

## Worktree 如何展示

- 在 **Repos 视图**中，每个链接 worktree 嵌套在其主仓库下——一个仓库节点，多个工作树。worktree 行显示 `<分支> @ <路径>`；主工作树带 `main` 标记。
- 在 **Explorer 视图**中，worktree 文件夹就是普通文件夹，带 worktree 图标；与 worktree 打交道主要在 Repos 视图。
- 位于**工作区根之外**的 worktree 默认隐藏；在视图选项中开启 "显示外部 worktree" 后可见（灰色，显示绝对路径）。
- worktree 行在所有地方都等同于仓库行：徽标、变更、提交框、提交图、终端——第 03–11 页的每个操作都作用于该 worktree 的工作树与其分支。

## 创建 worktree

在仓库上右键 → **"新建 worktree…"**。对话框：

| 字段 | 行为 |
|---|---|
| 源仓库 | 从右键上下文预填 |
| 分支 | **新建分支**（输入名称）或**已有分支**（选择器）。已在其他 worktree 检出的分支会被拦截并给出明确提示——Git 不允许同一分支出现在两个 worktree。 |
| 基底 ref | 新建分支时的起点（默认：仓库当前 HEAD）。 |
| 目标路径 | 按路径模板预填（见下），可编辑。目录不存在时自动创建。 |

**路径模板**（默认与 `__worktree__` 惯例一致）：

```
{worktreeRoot}/{repo}_{branch-slug}
```

- `{worktreeRoot}` —— 默认 `<工作区>/__worktree__`，可在 设置 → Git → 工作树根目录 修改。
- `{branch-slug}` —— 分支名中的 `/` 替换为 `-`。
- 示例：仓库 `mobile-app` 上建分支 `worktree/feat-dark-mode` → `__worktree__/mobile-app_worktree-feat-dark-mode`。

新建的 `__worktree__` 文件夹会自动挂到其父仓库下（并从普通发现的噪声中排除）。创建完成后树会聚焦到新的 worktree 行。

## 移动、删除、prune、锁定

| 操作 | 行为 |
|---|---|
| **移动（Move）** | 移动或重命名文件夹（`git worktree move`），未提交的更改会一起带走。对话框默认给出 worktree 目录，重命名只需改最后一段路径；目标路径与当前路径相同时直接拒绝，不会调用 git。缺失的上级目录会自动创建；目标文件夹已存在时它成为父目录。已锁定的 worktree 会被拒绝，需先解锁；主检出从不提供移动。 |
| **删除（Remove）** | 脏 worktree 会被拒绝；出现"强制删除"并提供确认，且会先创建 backup ref（安全网，第 06 页）。只删除文件夹，不动分支。 |
| **Prune** | 清理文件夹已消失的 worktree 记录（`git worktree prune`）。可从仓库右键菜单手动触发，fetch 后也会自动执行。 |
| **Lock / Unlock** | 防止被 prune/删除（适用于可移除磁盘、长期实验）。锁定状态显示在行上。 |

## 边界情况

- 手动删掉文件夹的 worktree 仍会以灰色 "prunable" 显示，直到执行 prune。
- detached HEAD 上的 worktree 显示 `detached @ <短sha>`。
- worktree 文件夹绝不会被误认为独立仓库：仓库身份以共享的 git 目录为准，所以 `mobile-app` 与其全部 worktree 始终是一个节点、多个工作树。
- "在 worktree 中"打开终端或文件，使用的永远是该 worktree 的路径——绝不是主检出。

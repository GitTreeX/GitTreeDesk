# 11 · 终端

> 状态：✅ 已实现 · 范围：v1 · 工程参考：[`../spec.md`](../spec.md)

## 打开终端

- 从 Explorer、Repos、Source Control、diff 视图**"在此打开终端"**——终端按所选上下文启动：仓库根、任意文件夹，或文件所在目录。
- `` Ctrl+` `` 切换终端面板；面板工具栏的 **+** 按钮为当前仓库开一个终端。
- 终端以**标签**形式开在底部面板；每个标签显示其工作目录与 profile。同一仓库可开多个终端。
- 窗口重载**不会**丢失会话（会话运行在独立进程）。重载后终端重新接上，并回放最近输出——每个会话最后约 512 KB。

## Shell Profile

默认 profile 自动探测。默认 profile 与回滚行数在 **设置 → Terminal** 中调整；profile 的其他字段都在 `terminal.json`（级联配置文件）里编辑：

| 平台 | 探测到的 profile |
|---|---|
| Windows | PowerShell 7（`pwsh`，如已安装） · Windows PowerShell · `cmd` · Git Bash（取自探测到的 Git 安装） · 已安装的 WSL 发行版 |
| macOS / Linux | `$SHELL`（默认），以及存在则 `bash`、`zsh`、`fish` |

每个 profile 定义：shell 路径、启动参数、环境变量、cwd 模板，以及标签栏使用的图标/颜色。

## 按目录生效的配置 —— `.gitreedesk/terminal.json`

在工作区的任意层级创建此文件，即可为**该目录及其下所有内容**配置终端：

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

**解析规则**——可预测、显式：

- 从工作区根到目标目录逐层收集配置文件；**更深者按 key 覆盖**（类似 `.editorconfig`）。
- `profiles` 与 `quickCommands` **按 name 合并**——同名时更深层的定义获胜；新名字直接追加。
- 在 `app/mobile-app/src/` 打开终端时，会解析从工作区根一路到 `src/` 的所有 `.gitreedesk/terminal.json`；以工作区设置（`.gitreedesk/settings.json`）为基底、用户设置为最终兜底——每个 key 均由最近的文件获胜。

## 快捷命令

在 `terminal.json` 中定义（任意层级，同一套级联），出现在两处：终端工具栏菜单（按当前终端所在目录解析）与命令面板。

| 字段 | 含义 |
|---|---|
| `name` | 菜单中显示的标签 |
| `command` + `args` | 以 argv 执行——**不经 shell 解释** |
| `cwd` | 起始目录；令牌：`{dir}`（终端所在目录）、`{repoRoot}`、`{workspaceRoot}` |
| `shellCommand` | 为 `true` 时经 shell 执行整条命令（管道、`&&`、环境展开需要） |

**安全规则**（不可让步）：

- 快捷命令**永不自动执行**——只能显式点击或从命令面板调用。
- **不受信工作区**中快捷命令完全禁用（第 01 页）。
- 快捷命令就是 `.gitreedesk/` 下的普通文件——信任工作区之前，请像审查代码一样审查它们。

## 终端行为

- 链接：URL 在系统浏览器打开；`path:line`/`path:line:col` 在编辑器中打开该文件并定位到行。
- 粘贴多行内容会先警告（防止误执行粘贴进来的脚本）。
- 滚动缓冲行数可配置（默认 5 000 行）。`Ctrl/Cmd+C` 在有选区时复制，无选区时发送 SIGINT——遵循各平台标准终端语义。
- Shell integration（标签标题跟踪运行中的命令与 cwd）为 [Later]。

## 边界情况

- 配置的 profile 找不到 shell 可执行文件时置灰并提示"未找到"，无法打开。
- WSL profile 来自 `wsl.exe`，起始目录与其他 profile 一致；由 WSL 自己把 Windows 盘映射到 `/mnt/…`。

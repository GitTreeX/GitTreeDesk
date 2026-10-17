# 12 · 设置与键位

> 状态：✅ 已实现 · 范围：v1 · 工程参考：[`../spec.md`](../spec.md)

## 设置

设置页（活动栏 → ⚙）可搜索，按组划分：**Appearance、Editor、Git、Terminal、Commit message、Advanced**。每项设置显示其作用域（User / Workspace）并提供**"复制到工作区"**；修改即时生效，无需重启。

### 设置文件在哪

| 文件 | 作用域 | 说明 |
|---|---|---|
| 用户数据目录下的 `settings.json` | 用户（本机） | 主文件；可手改，借 JSON schema 获得自动补全 |
| `<工作区>/.gitreedesk/settings.json` | 工作区覆盖 | 可提交；按 key 覆盖用户文件 |
| `<目录>/.gitreedesk/terminal.json` | 目录子树 | 终端 profile + 快捷命令（第 11 页） |
| 用户数据目录下的 `keybindings.json` | 用户 | 快捷键覆盖（见下） |
| `<工作区>/.gitreedesk/workspace.json` | 工作区 | 仅发现与分组（第 01 页） |

解析顺序：**工作区 > 用户**（按 key）；按仓库的覆盖写在 workspace 文件的 `repos` 映射中。

### 设置参考（节选）

```jsonc
{
  "appearance": { "theme": "system", "density": "comfortable" },  // theme: system | light | dark
  "locale": "en",                                                 // en | zh-Hans
  "git": {
    "path": null,                    // null = 自动探测；自定义 Git 安装时填写
    "concurrency": 6,                // 并行 Git 进程数
    "pollIntervalSec": 60,           // watcher 不健康时的兜底轮询间隔
    "defaultPullStrategy": "ff-only", // ff-only | merge | rebase
    "untrackedStrategy": "normal"    // normal | all（支持按仓库覆盖）
  },
  "graph": { "windowSize": 10000 },  // 提交图加载到多少提交后停止（1000 – 200000）
  "commitMessage": {
    "provider": "offline",           // offline | openai-compatible
    "baseUrl": null, "model": null, "temperature": 0.2
  },
  "editor": { "fontSize": 13, "fontFamily": null, "tabSize": 2, "insertSpaces": true, "wordWrap": false, "minimap": false },
  "terminal": { "defaultProfile": null }
}
```

按仓库覆盖（写在工作区设置里）：

```jsonc
"repos": {
  "backend/api-server": { "pullStrategy": "rebase" },
  "website/marketing-site": { "untrackedStrategy": "all" }
}
```

## 键盘

所有功能都能从**命令面板**（`Ctrl/Cmd+Shift+P`）触达——输入即过滤动作；上下文相关的动作只在适用时出现。

### 默认快捷键（v1 完整清单）

| Windows / Linux | macOS | 动作 |
|---|---|---|
| Ctrl+Shift+P | ⇧⌘P | 命令面板 |
| Ctrl+P | ⌘P | 快速打开文件 |
| Ctrl+R | ⌘R | 转到仓库 |
| Ctrl+Shift+G | ⇧⌘G | 聚焦 Source Control |
| Ctrl+` | ⌃` | 切换终端面板 |
| Ctrl+Enter | ⌘⏎ | 提交已暂存内容 |
| Space | Space | 暂存/取消暂存选中文件（Source Control 内的上下文按键，不可通过 keybindings 改绑） |
| Ctrl+Shift+F | ⇧⌘F | fetch 当前仓库（Repos 视图内：所选仓库） |
| F2 | F2 | 重命名 Explorer 中聚焦的文件或文件夹 |
| Delete | Delete | 将 Explorer 中聚焦的文件或文件夹移入回收站 |
| Enter | Enter | 打开文件 / 切换树行展开；提交图中查看提交详情（上下文按键，不可改绑） |
| Alt+← / Alt+→ | ⌥← / ⌥→ | 编辑器导航历史 |
| Esc | Esc | 关闭最上层临时 UI（绝不关闭编辑器标签） |

### 自定义

- `keybindings.json` 可覆盖任意**已注册命令**（上面那些上下文按键不在其中）。"Keyboard Shortcuts" 标签（命令面板 → "Open keyboard shortcuts"）列出默认值与覆盖项，并在你绑定已占用的组合时**做冲突检测**。
- 快捷键覆盖在 v1 为按用户（非按工作区）。[Later]

## 主题与语言

- **主题**：`system`（默认，实时跟随系统）、`light`、`dark`——可从状态栏或命令面板切换。
- **语言**：v1 内置 `en`（默认）与 `zh-Hans`；切换即时生效、无需重启。所有用户可见文本（含对话框、徽标、tooltip）都经过翻译——不会出现半英半中的界面。

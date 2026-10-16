[English](README.md) | 简体中文

> 🚧 **WIP / 早期开发中**
>
> GitTreeDesk 尚处于早期开发阶段。功能、API、配置与项目结构可能随时变更，恕不另行通知。
> 目前尚未达到生产可用标准。欢迎反馈与尝试。

---

<p align="center">
  <img src="brand/svg/gitreedesk-icon.svg" alt="GitTreeDesk 图标" width="128" height="128"/>
</p>

<h1 align="center">GitTreeDesk</h1>

<p align="center">
  <em>面向 monorepo 与 worktree 的工作区优先多仓库 Git 工作台，基于 Electron 构建。</em>
</p>

GitTreeDesk 让你将**任意文件夹作为工作区打开**，自动发现其中的所有 Git 仓库与 worktree，并在同一棵树中统一管理。

## 为什么选择 GitTreeDesk

VSCode 在单仓库项目上表现出色，但当你在同一个大文件夹下管理 100+ 个 Git 仓库时，它就会变得缓慢而割裂：

- 文件监听器难以应对庞大的目录树
- 跨众多仓库的 Git 状态刷新缓慢
- 文件浏览与 Git 操作被拆散在不同的视图中
- worktree 工作流并非一等公民

GitTreeDesk 选择了另一条路：**不做通用 IDE，而是面向大量仓库的工作区优先 Git 工作台。**

## 核心特性

- 🌲 **工作区优先** — 打开任意文件夹，根目录无需是 Git 仓库。
- 🎯 **多仓库树** — 自动发现并浏览工作区中的所有 Git 仓库。
- 🌿 **worktree 感知** — 检测、展示、创建与移除 Git worktree。
- 🔀 **完整 Git 工作流** — 提交、分支、合并、变基、贮藏、拣选、获取、拉取、推送。
- 📊 **Git 图谱** — 可视化跨仓库的提交历史。
- ✏️ **Monaco 编辑器** — 语法高亮、TypeScript 提示与 diff 视图。
- 🌍 **英文优先的国际化** — 默认英文，架构已为 i18n 做好准备。
- 🌙 **深色模式** — 跟随系统主题或手动切换。
- 🚀 **性能优先** — 懒加载、增量更新与 SQLite 缓存。

## 运行要求

- Git **≥ 2.23**（建议 ≥ 2.36），默认从 `PATH` 读取；非标准路径可在设置中指定。
- Windows 10+ · macOS 11+ · Linux（AppImage 或 deb）。

## 下载

安装包与免安装压缩包发布在[发布页面](https://github.com/GitTreeX/GitTreeDesk/releases)：Windows 提供 NSIS `.exe` 安装器与免安装 `.zip`，macOS 提供 `.dmg`，Linux 提供 `.AppImage` 与 `.deb`。

macOS 构建暂未签名（公证能力后置），首次启动需要在 Gatekeeper 中手动选择"打开"。

## 从源码构建

需要 Node ≥ 22 与 pnpm 12（版本由 `packageManager` 字段锁定）。

```bash
pnpm install
pnpm build:native            # 在没有预编译产物的平台编译 node-pty（Linux）
pnpm dev                     # 开发模式，热更新
pnpm build && pnpm package:win   # 产物输出到 release/（另有 package:mac / package:linux）
pnpm smoke:packaged          # 启动打包后的应用并断言可以正常拉起
```

`pnpm typecheck` 与 `pnpm test` 覆盖整个 workspace；`pnpm fixture` 会生成性能预算所依据的多仓库大型工作区夹具。

## 文档

- [用户指南](docs/guide/README.zh-CN.md) — 逐个界面说明功能，每个特性一页
- [工程参考](docs/spec.zh-CN.md) — 架构、关键决策与性能预算
- [更新日志](CHANGELOG.zh-CN.md)

## 许可证

MIT — 见 [LICENSE](LICENSE)。

# 08 · Submodule

> 状态：✅ 已实现 · 范围：v1 · 工程参考：[`../spec.md`](../spec.md)

## Submodule 如何展示

- 含 `.gitmodules` 的仓库在任一 submodule 需要处理（未初始化或有漂移）时带 `◇` 徽标。
- Submodule 仓库嵌套显示在其父仓库下。已初始化的与普通仓库完全一致（第 03–11 页全部适用——它们本就是被父仓库钉住提交的普通仓库）。
- **未初始化**的 submodule（文件夹为空或不存在）以灰色显示，附"未初始化"提示与一键初始化操作。

## 每个 submodule 的状态

| 状态 | 含义 | 展示 |
|---|---|---|
| 同步 | 检出的提交与父仓库记录的一致 | 普通行 |
| **漂移** | 检出的提交与记录不符（有人移动了 pin，或本地更新过） | 警告提示 + "检出记录的提交"操作 |
| **脏** | submodule 内有未提交改动 | `●` 徽标（漂移单独汇报——脏不等于漂移） |
| 未初始化 | 从未克隆 | 灰色 + 初始化操作 |

## 操作

- **Update all**（仓库右键菜单，招牌操作）——执行 `git submodule update --init --recursive`，进度按 submodule 与嵌套层级流式展示。单个失败单独汇报，不中断其余部分。
- **更新此 submodule**——单个版本的更新。
- **检出记录的提交**——把漂移的 submodule 拉回父仓库 pin 的提交。
- **Sync URLs**——`.gitmodules` 里的远端地址变更后执行 `git submodule sync`。
- **作为仓库打开**——把该 submodule 聚焦为一个完整仓库节点（提交图、变更、自己的远端）。
- **Add / deinit**——[Later]。

## 说明

- `Update all` 的并发度遵循 `git.concurrency` 设置（第 12 页）；默认值调低以温和对待网络。
- submodule 的 fetch/push 使用它自己的远端与凭据；认证失败只对该 submodule 报类型化错误（排查见第 13 页）。
- 支持 submodule 套 submodule（`--recursive`）——嵌套深度在进度输出中展示。

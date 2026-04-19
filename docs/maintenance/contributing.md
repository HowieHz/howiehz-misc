---
publish: false
outline: deep
---

# 维护指南

本文档面向仓库维护者与代码贡献者。若你只是想为站点投稿或修正文稿，请阅读[投稿指南](/maintenance/submission)。

## 主要目录

- `docs/`：VitePress 文档站与在线工具页面。
- `packages/compat-finder/`：兼容性问题排查引擎与命令行工具包。

## 开发环境

### 安装依赖

先安装 Node.js 与 pnpm，然后在仓库根目录运行：

```bash
pnpm install
```

## 常用命令

### 文档站

- 启动支持热更新的文档站开发服务器：`pnpm docs:watch`
- 构建文档站：`pnpm docs:build`
- 构建文档站并启动预览服务器：`pnpm docs:preview`

### compat-finder 包

- 构建包：`pnpm compat-finder:build`
- 启动监听构建：`pnpm compat-finder:watch`
- 运行测试：`pnpm compat-finder:test`

### 仓库级检查

- 格式化：`pnpm fmt`
- 求疵与类型检查：`pnpm lint`
- 运行全部测试：`pnpm test`

### Changeset

- 生成发布变更记录：`pnpm changeset`
- 当改动会影响任一已发布工作区包时，需要补 changeset；仅修改文档站、公开内容页或不影响已发布包行为的内部整理时不需要补
- 运行后按提示选择受影响的已发布包，以及对应的语义化版本级别：`patch`、`minor` 或 `major`
- 将生成的 `.changeset/*.md` 与代码改动一起提交到 PR

## CI 检查

### 仓库通用检查

[`nodejs-ci.yml`](https://github.com/HowieHz/howiehz-misc/blob/main/.github/workflows/nodejs-ci.yml) 会在 PR 与 `main` 分支推送时运行，主要包括：

- `pnpm fmt`
- `pnpm lint`
- `pnpm test`

其中格式化与部分自动修正步骤会在 PR 中自动提交修复结果。

### PR 构建检查

- [`pr-docs-build.yml`](https://github.com/HowieHz/howiehz-misc/blob/main/.github/workflows/pr-docs-build.yml)：检查文档站是否可构建。
- [`pr-compat-finder-build.yml`](https://github.com/HowieHz/howiehz-misc/blob/main/.github/workflows/pr-compat-finder-build.yml)：检查 `compat-finder` 包是否可构建。

## 相关文档

如果你修改的是公开内容页或工具文档，请同时参考：

- [投稿指南](/maintenance/submission)
- 对应目录下的 `README.md`

## 发布说明

发布流程、版本规则与 release PR 行为见[发布说明](./releases.md)。

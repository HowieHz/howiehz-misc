---
publish: false
outline: deep
---

# 维护指南

本文档面向仓库维护者与代码贡献者。若你只是想为站点投稿或修正文稿，请阅读[投稿指南](/maintenance/submission)。

## 项目结构

- `docs/`：VitePress 文档站与在线工具页面。
- `packages/compat-finder/`：兼容性问题排查引擎与命令行工具包。

## 开发环境

### 安装依赖

先安装 Node.js 与 pnpm，然后在仓库根目录运行：

```bash
pnpm install
```

### 常用命令

#### 文档站

- 启动支持热更新的文档站开发服务器：`pnpm docs:watch`
- 构建文档站：`pnpm docs:build`
- 构建文档站并启动预览服务器：`pnpm docs:preview`

#### compat-finder 包

- 构建包：`pnpm compat-finder:build`
- 启动监听构建：`pnpm compat-finder:watch`
- 运行测试：`pnpm compat-finder:test`

#### 仓库级检查

- 格式化：`pnpm fmt`
- 求疵与类型检查：`pnpm lint`
- 运行全部测试：`pnpm test`

## 在 Markdown 中使用 Vue

VitePress 会把每个 Markdown 文件编译为 Vue 单文件组件，因此你可以在 Markdown 里直接使用组件、模板表达式与 `<script setup>` 逻辑。修改相关页面前，建议先阅读 [VitePress 官方文档](https://vitepress.dev/zh/guide/using-vue)。

请保持原始 HTML 模板块连续、规整，不要在 `<select>...</select>` 这类容器内部随意插入空行，否则在开发或构建阶段可能触发由 `vite:vue` / Vue SFC 编译器报出的模板解析错误。

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

## 贡献约定

### 与发布相关的改动

如果改动会影响已发布的 `compat-finder` 包，请在提交 PR 前运行：

```bash
pnpm changeset
```

随后：

1. 选择 `compat-finder`
2. 选择合适的语义化版本级别：`patch`、`minor` 或 `major`
3. 写清楚这次改动的发布说明
4. 将生成的 `.changeset/*.md` 一并提交

仅文档、站点内容或不影响发布包的改动，不需要添加 changeset。

### 文稿与工具页面

如果你修改的是公开内容页或工具文档，请同时参考：

- [投稿指南](/maintenance/submission)
- 对应目录下的 `README.md`

## 发布

发布流程、版本规则与 release PR 行为见[发布说明](./releases.md)。

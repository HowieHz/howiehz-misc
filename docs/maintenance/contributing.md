---
publish: false
outline: deep
---

# 维护指南

本文档面向仓库维护者与代码贡献者。若你只是想为站点投稿或修正文稿，请阅读[投稿指南](/maintenance/submission)。

## 工作区结构

### 工作区包

- `docs/`：VitePress 网站应用，包含文档和在线工具。
- `packages/compat-finder/`：发布到 npm 的兼容性排查库和命令行工具。
- `packages/graphwar-killer-wasm/`：供 Graphwar Killer 使用的私有 AssemblyScript / WASM 内核。
- `packages/graphwar-agent/`：为 Graphwar 官方客户端提供本机 HTTP API 的 Java Agent。

工作区关系：

```text
docs
├── 依赖 compat-finder
└── 依赖 graphwar-killer-wasm

graphwar-agent
└── 独立；构建产物通过 sync:public 同步到 docs/public/
```

各包的功能、用法和约束见对应目录内的 README。

### 仓库级目录

- `.changeset/`：Changesets 的版本与发布说明。
- `.github/`：GitHub Actions 工作流及 GitHub 项目配置。
- `scripts/`：格式化、测试等仓库级任务的编排脚本。
- `tsconfig/`：由各 TypeScript 工程共享的基础配置。

## 开发环境

### 安装依赖

先安装 Node.js 与 pnpm，然后在仓库根目录运行：

```bash
pnpm install
```

如果需要运行 Java 代码格式化或构建 `graphwar-agent`，还需要让 `java` / `javac` / `jar` 可在 `PATH` 中执行。推荐使用 JDK 21，CI 也使用 JDK 21。

## 常用命令

### 文档站

- 开发：`pnpm docs:watch`
- 构建：`pnpm docs:build`
- 预览：`pnpm docs:preview`

这三个命令都会先按工作区依赖图构建所需依赖；开发模式随后并行监听依赖与文档站。

### 包内命令

使用 `pnpm --filter PACKAGE SCRIPT` 运行包内脚本，例如 `pnpm --filter compat-finder test`。可用脚本：

- `compat-finder`：`cli`、`build`、`watch`、`test`
- `graphwar-killer-wasm`：`build`、`watch`、`test`
- `graphwar-agent`：`build`、`openapi:test`、`test`
- 构建 Agent 并同步到文档站：`pnpm --filter graphwar-agent build && pnpm --filter graphwar-agent sync:public`

### 仓库级检查

- 格式化：`pnpm fmt`。Java 文件使用 `google-java-format` 的 AOSP 风格，其余受支持文件使用 `oxfmt`；formatter jar 会缓存到 `.cache/google-java-format/`。
- 求疵与类型检查：`pnpm lint`
- 运行全部测试：`pnpm test`

`lint` 会先构建文档站依赖，再并行检查；`test` 会先构建一次共享 WASM，再并行运行各测试套件。

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

其中格式化与部分自动修正步骤会在 PR 分支位于本仓库时自动提交修复结果；PR 分支位于 Fork 仓库时，CI 只运行检查，若产生修复变更，会上传 `ci-autofix.patch`。贡献者可从 CI Job Summary 复制补丁链接，并在 PR 分支本地运行对应命令：

Linux / macOS：

```shell
curl -L -o ci-autofix.patch "<ci-autofix.patch 链接>" && git apply ci-autofix.patch
```

Windows PowerShell:

```powershell
Invoke-WebRequest -Uri "<ci-autofix.patch 链接>" -OutFile ci-autofix.patch; git apply ci-autofix.patch
```

### PR 构建检查

- [`pr-docs-build.yml`](https://github.com/HowieHz/howiehz-misc/blob/main/.github/workflows/pr-docs-build.yml)：检查文档站是否可构建。
- [`pr-compat-finder-build.yml`](https://github.com/HowieHz/howiehz-misc/blob/main/.github/workflows/pr-compat-finder-build.yml)：检查 `compat-finder` 包是否可构建。

## 相关文档

如果你修改的是公开内容页或工具文档，请同时参考：

- [投稿指南](/maintenance/submission)
- 对应目录下的 `README.md`

## 发布说明

发布流程、版本规则与 release PR 行为见[发布说明](./releases.md)。

---
publish: false
outline: deep
---

# 发布说明

## 发布对象

当前由本仓库通过 Changesets 管理发版的 npm 包包括：

- `compat-finder`

其包级更新日志维护在：

- [`packages/compat-finder/CHANGELOG.md`](https://github.com/HowieHz/howiehz-misc/blob/main/packages/compat-finder/CHANGELOG.md)

## 版本规则

`compat-finder` 使用语义化版本号 `MAJOR.MINOR.PATCH`。

- `patch`：修复 bug、文案调整、内部实现改进，且不引入破坏性变更。
- `minor`：新增向后兼容的能力，例如新增 CLI 参数、导出新 API。
- `major`：引入不向后兼容的变更，例如删除 API、修改 CLI 兼容行为或输出约定。

## 发布前准备

首次启用自动发布前，请确认：

1. GitHub 仓库已配置 `NPM_TOKEN` secret。
2. npm 账号具备发布 `compat-finder` 的权限。
3. `packages/compat-finder/package.json` 中的包名、入口与发布内容已确认无误。
4. `packages/compat-finder/README.md`、`README.zh.md` 与 `LICENSE` 已准备好，并确认允许随包发布。
5. 每个准备发布的包都已完成一次本地打包验证，例如 `pnpm --filter compat-finder pack` 或 `npm publish --dry-run`。

## 发布前检查清单

准备发版前，建议按顺序确认以下事项：

1. 准备合入本次版本的功能 PR 都已完成合并。
2. 每个需要发版的改动都已补充对应的 `.changeset/*.md` 文件。
3. 不需要发版的 PR 没有误加 changeset。
4. 每个待发布包的 `CHANGELOG.md` 没有被手工写入与 Changesets 输出冲突的版本段落。
5. 每个待发布包的 `package.json` 中发布入口、类型声明与发布内容仍与当前产物一致。
6. 本地已至少执行过一次：
   - `pnpm fmt`
   - `pnpm lint`
   - `pnpm test`
   - 对相关包执行 `pnpm --filter <package-name> pack`

## 发布方式概览

本仓库使用 Changesets 管理版本号与更新日志，并通过 [`release-compat-finder.yml`](https://github.com/HowieHz/howiehz-misc/blob/main/.github/workflows/release-compat-finder.yml) 自动驱动工作区包的 release PR 与 npm 发布。

整体流程分为两个阶段：

1. 常规 PR 合并到 `main`
   这一步不会立刻发 npm，而是先生成或更新 release PR。
2. release PR 合并到 `main`
   这一步才会执行真正的 npm 发布。

## 日常发布流程

### 提交可发布改动

若改动会影响任一已发布工作区包的行为，请运行：

```bash
pnpm changeset
```

生成 changeset 后，请：

1. 选择受影响的已发布包
2. 选择合适的版本级别：`patch`、`minor` 或 `major`
3. 写明这次改动对用户的影响
4. 将生成的 `.changeset/*.md` 文件与代码改动一起提交到 PR

以下类型的改动通常不需要 changeset：

- 仅修改文档站内容
- 仅修改仓库维护文档
- 不影响已发布包行为的内部整理

### 合并常规 PR 后

当带有 changeset 的 PR 合并到 `main` 后，[`release-compat-finder.yml`](https://github.com/HowieHz/howiehz-misc/blob/main/.github/workflows/release-compat-finder.yml) 会自动创建或更新一个 release PR。该 PR 会集中展示所有待发布工作区包的：

- `package.json` 版本号更新
- `CHANGELOG.md` 新增条目

如果同一阶段有多个 changeset 被陆续合入，工作流会继续更新同一个 release PR，而不是每次新建一个。

### 审查 release PR 时要看什么

合并 release PR 前，建议重点确认：

1. 版本号是否符合预期，没有误升或漏升。
2. `CHANGELOG.md` 中的条目是否准确、简洁、面向用户。
3. 是否只包含预期工作区包的发布变更。
4. 没有额外混入不应进版本提交的代码改动。

### 合并 release PR 后

release PR 合并到 `main` 后，同一工作流会自动执行：

1. 安装依赖
2. 运行 `pnpm changeset:publish`
3. 将新版本发布到 npm

在这一步里：

- `changeset version` 已经在 release PR 阶段完成
- 合并后的 publish 阶段只负责根据当前版本状态实际推送到 npm
- 成功后，npm 上会出现本次 release PR 所包含的全部新版本

## 本地验证

如果需要在本地模拟发布前的关键步骤，可按以下顺序执行：

### 生成 changeset

```bash
pnpm changeset
```

### 本地推进版本号与 changelog

```bash
pnpm changeset:version
```

这一步会消费当前 `.changeset/*.md` 文件，并更新对应包的：

- `package.json`
- `CHANGELOG.md`

### 检查打包内容

对每个准备发布的包分别执行：

```bash
pnpm --filter <package-name> pack
```

如果只想检查而不真正发布，可进一步运行：

```bash
npm publish --dry-run
```

### 手动发布

如确有需要，也可以手动执行：

```bash
pnpm changeset:publish
```

但正常情况下应优先使用 GitHub Actions 的自动发布流程，避免本地与 CI 状态不一致。

## 本地命令

以下命令主要用于本地验证或手动排查：

- 生成 changeset：`pnpm changeset`
- 本地推进版本号与 changelog：`pnpm changeset:version`
- 手动发布：`pnpm changeset:publish`
- 检查打包内容：`pnpm --filter compat-finder pack`

## 常见问题排查

### workflow 没有创建 release PR

优先检查：

1. 合并到 `main` 的 PR 是否真的带有 `.changeset/*.md`
2. `release-compat-finder.yml` 是否执行成功
3. 当前分支保护规则是否阻止机器人更新 release PR

### release PR 已创建，但没有发布 npm

这是预期行为。release PR 只是汇总版本号与 changelog，只有当该 PR 自己被合并到 `main` 后，工作流才会执行真正的 publish。

### 发布失败

优先检查：

1. `NPM_TOKEN` 是否存在且仍有效
2. npm 账号是否仍有对应包的发布权限
3. 当前版本号是否已在 npm 上存在
4. `prepack` 构建是否在 CI 环境内成功
5. `package.json` 中的发布入口与 `dist/` 内容是否匹配

## 维护约定

- 普通功能 PR 不应手动修改已发布包的 `package.json` `version`。
- 已发布包的 `CHANGELOG.md` 由 Changesets 维护，通常不应手写版本段落。
- 仅修改文档站或仓库元数据的 PR，不需要添加 changeset。

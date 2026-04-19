---
publish: false
outline: deep
---

# 发布说明

## 已发布包

本仓库当前通过 Changesets 管理发布的 npm 包如下：

- [compat-finder](https://www.npmjs.com/package/compat-finder)：[更新日志](https://github.com/HowieHz/howiehz-misc/blob/main/packages/compat-finder/CHANGELOG.md)

## 版本规则

均遵循语义化版本号 `MAJOR.MINOR.PATCH`。

- `patch`：修复 bug、文案调整、内部实现改进，且不引入破坏性变更。
- `minor`：新增向后兼容的能力，例如新增 CLI 参数、导出新 API。
- `major`：引入不向后兼容的变更，例如删除 API、修改 CLI 兼容行为或输出约定。

## 发布前检查清单

准备发版前，建议按顺序确认以下事项：

1. 准备合入本次版本的功能 PR 都已完成合并。
2. 与本次发布相关的 CI 检查已全部通过。

## 发布流程概览

本仓库使用 Changesets 管理版本号与更新日志，并通过 [`release-packages.yml`](https://github.com/HowieHz/howiehz-misc/blob/main/.github/workflows/release-packages.yml) 自动创建 release PR 并执行 npm 发布。

整体流程分为两个阶段：

1. 常规 PR 合并到 main 后，不会立即发布到 npm，而是先创建或更新 release PR。
2. release PR 合并到 main 后，才会真正执行 npm 发布。

## 构建来源验证

发布工作流采用 GitHub 推荐的 reusable workflow 路线：包构建、`npm pack` 打包、产物上传与 artifact attestation 签发都在复用构建工作流内完成。

在真正执行 npm 发布前，工作流会先使用 `gh attestation verify` 校验全部 `.tgz` 包产物，确认这些文件确实由指定的复用构建工作流生成并签名。只有校验通过后才会继续发布，以保证发布到 npm 的包产物来源可验证且未被篡改。

# 兼容性问题排查器

[![Open on npmx][npmx-version-src]][npmx-href]
[![npm downloads][npmx-downloads-src]][npmx-href]
[![CI][ci-src]][ci-href]

[English](./README.md) | 简体中文

compat-finder 是一个用于排查多个目标之间兼容性问题的库和命令行工具。

## 功能特点

- 用于插件、模组、扩展等目标集合的兼容性缩小范围排查
- 多数场景可直接使用简单会话 API，高级场景可接底层状态 API
- 内置 `binary-split` 和 `leave-one-out` 两种算法
- 作为 ESM 库时可用于浏览器和其他兼容 ESM 的运行时
- 作为 Node.js CLI 使用时支持英文和简体中文

## 文档

完整文档见 [howiehz.top/misc/compat-finder](https://howiehz.top/misc/compat-finder/)。

## 安装

```bash
npm install compat-finder
```

然后可以创建一个兼容性排查会话：

```ts
import { createCompatibilitySession } from "compat-finder";
```

也可以直接临时调用命令行工具：

```bash
npx compat-finder --help
```

## 用法

库使用示例：

```ts
import { createCompatibilitySession } from "compat-finder";

const session = createCompatibilitySession(["A", "B", "C", "D"]);

let step = session.current();

while (step.status === "testing") {
  const result = askUser(step.targets);

  if (result === "undo") {
    step = session.undo();
    continue;
  }

  step = session.answer(result === "issue");
}

console.log("最终结果：", step.targets);

function askUser(targets: readonly string[]): "issue" | "pass" | "undo" {
  console.log("当前需要测试：", targets);
  // 浏览器里可以来自 prompt()、按钮或表单。
  // Node.js 里可以来自 readline、测试脚本或你自己的 CLI。
  return "issue"; // 复现返回 "issue"，未复现返回 "pass"，撤销返回 "undo"。
}
```

命令行示例：

```bash
compat-finder next -c 4 --algorithm leave-one-out -n "A,B,C,D" -a "issue,pass"
```

完整文档见 [howiehz.top/misc/compat-finder](https://howiehz.top/misc/compat-finder/)。

## 相关项目

由 [HowieHz/plugin-compatibility-checking-tool](https://github.com/HowieHz/plugin-compatibility-checking-tool) 重构而来。

## 许可证

本项目基于 [MIT License](https://raw.githubusercontent.com/howiehz/howiehz-misc/HEAD/packages/compat-finder/LICENSE) 发布。

<!-- Badges -->

[npmx-version-src]: https://npmx.dev/api/registry/badge/version/compat-finder
[npmx-downloads-src]: https://npmx.dev/api/registry/badge/downloads-month/compat-finder
[npmx-href]: https://npmx.dev/compat-finder
[ci-src]: https://github.com/HowieHz/howiehz-misc/actions/workflows/nodejs-ci.yml/badge.svg
[ci-href]: https://github.com/HowieHz/howiehz-misc/actions/workflows/nodejs-ci.yml

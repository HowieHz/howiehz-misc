# 兼容性问题排查器

[![Open on npmx][npmx-version-src]][npmx-href]
[![npm downloads][npmx-downloads-src]][npmx-href]
[![CI][ci-src]][ci-href]

[English](./README.md) | 简体中文

compat-finder 是一个用于排查多个目标之间兼容性问题的库和命令行工具。

它帮助你用更少的测试轮次找出一个或多个不兼容目标。

## 为什么用 compat-finder

- **零运行时依赖**：轻量，安全。
- **高效排查算法**：默认算法采用二分法结合分治法的策略，通常只需较少测试轮次即可得出结果。
- **不只简单二分**：排查结果目标可以是一个或多个。
- **多种接入形式**：提供引导式 CLI、开箱即用的会话 API，以及适合自定义流程的高级 API。
- **适合多种运行环境**：发布产物为 ESM，可用于浏览器和其他兼容 ESM 的运行时。
- **本地化 CLI**：支持英文和简体中文。

## 文档

完整文档见 [howiehz.top/misc/compat-finder](https://howiehz.top/misc/compat-finder/)。

## 安装

```bash
npm install compat-finder
```

然后即可导入使用：

```ts
import { createCompatibilitySession } from "compat-finder";

const session = createCompatibilitySession(["A", "B"]);
```

如果你只是想先试一下 CLI，也可以不安装直接运行：

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

启动一轮引导式排查：

```bash
npx compat-finder interactive --count 4
```

根据已有回答计算下一步要测试的目标：

```bash
npx compat-finder next -c 3 -a "y,n"
```

预期会输出如下 JSON：

```json
{
  "status": "testing",
  "targetCount": 3,
  "targets": ["目标 2"]
}
```

如果你需要完整命令和 API 说明，可以继续阅读[完整文档](https://howiehz.top/misc/compat-finder/)。

## 在线版

在线体验：[兼容性问题排查器](https://howiehz.top/misc/tools/compatibility-test/)

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

# 快速上手

本页展示如何安装 `compat-finder`，并用最短路径开始使用库或 CLI。

## 环境要求

- 作为库使用：兼容 ESM 的运行时
- 作为 CLI 使用：Node.js `^20 || ^22 || >=24`

## 安装

使用你常用的包管理器安装 `compat-finder`：

::: code-group

```sh [npm]
npm install compat-finder
```

```sh [pnpm]
pnpm add compat-finder
```

```sh [yarn]
yarn add compat-finder
```

```sh [bun]
bun add compat-finder
```

```sh [deno]
deno add npm:compat-finder
```

```sh [vlt]
vlt install compat-finder
```

```sh [vp]
vp add compat-finder
```

:::

安装后即可导入并创建会话：

```ts
import { createCompatibilitySession } from "compat-finder";

const session = createCompatibilitySession(["A", "B"]);
```

如果你只是想快速试用 CLI，也可以不安装，直接运行：

::: code-group

```sh [npm]
npx compat-finder --help
```

```sh [pnpm]
pnpm dlx compat-finder --help
```

```sh [yarn]
yarn dlx compat-finder --help
```

```sh [bun]
bunx compat-finder --help
```

```sh [deno]
deno run npm:compat-finder --help
```

```sh [vlt]
vlx compat-finder --help
```

```sh [vp]
vp exec compat-finder
```

:::

## 库使用示例

下面的示例展示了一个最小可用的 `compat-finder` 会话：

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
  return "issue";
}
```

## CLI 使用示例

如果你更想直接从命令行开始，可以先试下面几个例子。

运行完整的交互式排查流程：

::: code-group

```sh [npm]
npx compat-finder interactive --count 4
```

```sh [pnpm]
pnpm dlx compat-finder interactive --count 4
```

```sh [yarn]
yarn dlx compat-finder interactive --count 4
```

```sh [bun]
bunx compat-finder interactive --count 4
```

```sh [deno]
deno run npm:compat-finder interactive --count 4
```

```sh [vlt]
vlx compat-finder interactive --count 4
```

```sh [vp]
vp exec compat-finder interactive --count 4
```

:::

根据已有回答计算下一步要测试的目标：

::: code-group

```sh [npm]
npx compat-finder next -c 3 -a "y,n"
```

```sh [pnpm]
pnpm dlx compat-finder next -c 3 -a "y,n"
```

```sh [yarn]
yarn dlx compat-finder next -c 3 -a "y,n"
```

```sh [bun]
bunx compat-finder next -c 3 -a "y,n"
```

```sh [deno]
deno run npm:compat-finder next -c 3 -a "y,n"
```

```sh [vlt]
vlx compat-finder next -c 3 -a "y,n"
```

```sh [vp]
vp exec compat-finder next -c 3 -a "y,n"
```

:::

预期会输出如下 JSON：

```json
{
  "status": "testing",
  "targetCount": 3,
  "targets": ["目标 2"]
}
```

## 下一步

- 了解如何[与 AI 协作](./ai)
- 前往[在线体验](./online-tool)
- 查看[命令行工具](./cli)了解完整命令和参数
- 查看[API 参考](./api)

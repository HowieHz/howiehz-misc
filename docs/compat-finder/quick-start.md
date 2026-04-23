# 快速开始

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

默认算法 `binary-split` 采用二分法结合分治法的策略。  
如果你想使用“每轮排除 1 个目标”的测试方式，可以把第二个参数传成 `{ algorithm: "leave-one-out" }`。

## 命令行示例

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

需要切换算法时：

::: code-group

```sh [npm]
npx compat-finder next -c 4 --algorithm leave-one-out -n "A,B,C,D" -a "issue,pass"
```

```sh [pnpm]
pnpm dlx compat-finder next -c 4 --algorithm leave-one-out -n "A,B,C,D" -a "issue,pass"
```

```sh [yarn]
yarn dlx compat-finder next -c 4 --algorithm leave-one-out -n "A,B,C,D" -a "issue,pass"
```

```sh [bun]
bunx compat-finder next -c 4 --algorithm leave-one-out -n "A,B,C,D" -a "issue,pass"
```

```sh [deno]
deno run npm:compat-finder next -c 4 --algorithm leave-one-out -n "A,B,C,D" -a "issue,pass"
```

```sh [vlt]
vlx compat-finder next -c 4 --algorithm leave-one-out -n "A,B,C,D" -a "issue,pass"
```

```sh [vp]
vp exec compat-finder next -c 4 --algorithm leave-one-out -n "A,B,C,D" -a "issue,pass"
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

- 继续阅读 [API 参考](./api)
- 查看 [命令行工具](./cli) 了解完整命令和参数

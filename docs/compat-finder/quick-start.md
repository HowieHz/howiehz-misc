# 快速开始

## 库使用示例

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

如果你想使用“每轮排除 1 个目标”的测试方式，可以把第二个参数传成 `{ algorithm: "leave-one-out" }`；默认算法仍然是 `binary-split`。

## 命令行示例

执行完整的交互式排查流程：

```bash
compat-finder interactive --count 4
```

执行单步排查并输出结果：

```bash
compat-finder next -c 3 -a "y,n"
```

需要切换算法时：

```bash
compat-finder next -c 4 --algorithm leave-one-out -n "A,B,C,D" -a "issue,pass"
```

预期输出为以下 JSON：

```json
{
  "status": "testing",
  "targetCount": 3,
  "targets": ["目标 2"]
}
```

## 下一步

- 查看 [API 参考](./api)
- 查看 [命令行工具](./cli)

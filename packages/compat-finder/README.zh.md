# 兼容性问题排查器

[English](./README.md) | 简体中文

在线体验：[兼容性问题排查器](https://howiehz.top/misc/tools/compatibility-test/)

compat-finder 是一个用于排查多个目标之间兼容性问题的引擎与命令行工具。

由 [HowieHz/plugin-compatibility-checking-tool](https://github.com/HowieHz/plugin-compatibility-checking-tool) 重构而来。

## 安装

使用包管理器安装：

```bash
pnpm add compat-finder
```

也可以直接临时调用命令行工具：

```bash
npx compat-finder --help
```

## 快速开始

### 命令行示例

执行完整的交互式排查流程：

```bash
compat-finder interactive --count 4
```

执行单步排查计算并输出结果：

```bash
compat-finder next -c 3 -a "y,n"
```

预期输出为以下 JSON：

```json
{
  "status": "testing",
  "targetCount": 3,
  "targets": ["目标 2"]
}
```

查看完整的[命令行工具](#命令行工具)文档了解命令和参数。

### 库使用示例

```ts
import {
  applyCompatibilityTestAnswer,
  createCompatibilityTestState,
  getCurrentCompatibilityTestStep,
  skipCachedCompatibilityTestSteps,
  takeTargetsFromRanges,
} from "compat-finder";

const targetNames = ["A", "B", "C", "D"];
const state = createCompatibilityTestState(targetNames.length);

let step = getCurrentCompatibilityTestStep(state);
while (step) {
  if (!step.requiresAnswer) {
    step = skipCachedCompatibilityTestSteps(state);
    continue;
  }

  const targets = takeTargetsFromRanges(step.promptTargetRanges, step.promptTargetCount);
  console.log(
    "当前需要测试：",
    targets.map((target) => targetNames[target - 1]),
  );

  const hasIssue = true;
  applyCompatibilityTestAnswer(state, hasIssue);
  step = getCurrentCompatibilityTestStep(state);
}

console.log(
  "最终结果：",
  state.resultTargets.map((target) => targetNames[target - 1]),
);
```

查看完整的 [API 参考](#api-参考) 了解导出的 API。

## 命令行工具

### 帮助

```bash
compat-finder --help
compat-finder --help interactive
compat-finder --help next
```

### 输出语言

CLI 文案可以通过命令行参数或环境变量设置输出语言。

优先级：

1. 命令行参数：`--locale` / `-l`
2. 环境变量：`COMPAT_FINDER_LOCALE`
3. 环境变量：`LC_ALL`
4. 环境变量：`LC_MESSAGES`
5. 环境变量：`LANG`
6. 默认值：`en`

支持的语言：

- `en`
- `zh-CN`

示例：

```bash
compat-finder --locale zh-CN --help
compat-finder -l zh-CN next -c 3 -a "y,n"
COMPAT_FINDER_LOCALE=zh-CN compat-finder next -c 3 -a "y,n"
```

### 子命令

#### `interactive`

启动交互式排查流程：

```bash
compat-finder interactive --count 4
compat-finder i -c 4 -n "A,B,C,D"
```

支持以下输入：

- `y` / `yes` / `issue` / `1`：表示“有兼容性问题”
- `n` / `no` / `pass` / `0`：表示“没有兼容性问题”
- `u` / `undo`：撤回上一步
- `q` / `quit`：退出

#### `next`

根据已有回答，计算当前下一步应测试的目标，或直接返回最终结果：

```bash
compat-finder next -c 3
compat-finder n -c 3 -a "y,n"
compat-finder next -c 4 -a "issue,pass,1,0" -n "A,B,C,D"
```

返回字段说明：

- `status`：`testing` 表示当前需要按 `targets` 列表进行测试；`complete` 表示已经得到最终结果
- `targetCount`：本轮排查的测试目标总数
- `targets`：`testing` 时表示当前需要测试的目标列表；`complete` 时表示最终结果列表

`answers` 支持以下取值：

- `y` / `yes` / `issue` / `1` / `true`：表示“有兼容性问题”
- `n` / `no` / `pass` / `0` / `false`：表示“没有兼容性问题”

示例 1：

```bash
compat-finder next -c 3 -a "y"
```

预期输出为以下 JSON：

```json
{
  "status": "testing",
  "targetCount": 3,
  "targets": ["目标 1"]
}
```

示例 2：

```bash
compat-finder next -c 3 -a "y,n"
```

预期输出为以下 JSON：

```json
{
  "status": "testing",
  "targetCount": 3,
  "targets": ["目标 2"]
}
```

示例 3：

```bash
compat-finder next -c 3 -a "y,n,n"
```

预期输出为以下 JSON：

```json
{
  "status": "complete",
  "targetCount": 3,
  "targets": ["目标 1", "目标 2"]
}
```

## API 参考

核心导出：

- `createCompatibilityTestState(targetCount)`：创建排查流程状态
- `getCurrentCompatibilityTestStep(state)`：获取当前步骤
- `applyCompatibilityTestAnswer(state, hasIssue)`：提交当前步骤的测试结果
- `skipCachedCompatibilityTestSteps(state)`：跳过已经命中的缓存步骤
- `takeTargetsFromRanges(ranges, limit)`：把范围结果展开成目标编号列表

## 在线版

在线版工具页面见 [compatibility-test](../../docs/tools/compatibility-test)。
